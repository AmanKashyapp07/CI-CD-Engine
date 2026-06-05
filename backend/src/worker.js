require('dotenv').config();
const { Worker } = require('bullmq');
const Docker = require('dockerode');
const simpleGit = require('simple-git');
const path = require('path');
const fs = require('fs').promises;
const pool = require('./db');
const { createWorkspace, cleanWorkspace } = require('./workspace');

const docker = new Docker({ socketPath: '/var/run/docker.sock' });
const connection = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT || '6379')
};

const pullImage = (imageName) => {
  return new Promise((resolve, reject) => {
    docker.pull(imageName, (err, stream) => {
      if (err) return reject(err);
      docker.modem.followProgress(stream, (err, res) => {
        if (err) return reject(err);
        resolve(res);
      });
    });
  });
};

const worker = new Worker('build-queue', async job => {
  const { buildId, repoUrl, commitHash } = job.data;
  console.log(`[Worker] Picked up job for buildId: ${buildId}, repoUrl: ${repoUrl}`);

  let workspacePath = '';
  let container = null;
  let buildLogs = '';

  try {
    // 1. Update status to RUNNING
    await pool.query(
      "UPDATE builds SET status = 'RUNNING', started_at = NOW() WHERE id = $1",
      [buildId]
    );
    console.log(`[Worker] Build ${buildId} marked as RUNNING.`);

    // 2. Create local workspace
    workspacePath = await createWorkspace(buildId);
    buildLogs += `[CI/CD Engine] Created workspace at ${workspacePath}\n`;

    // 3. Git Clone & Checkout
    buildLogs += `[CI/CD Engine] Cloning repository: ${repoUrl} ...\n`;
    const git = simpleGit();
    await git.clone(repoUrl, workspacePath);
    buildLogs += `[CI/CD Engine] Repository cloned successfully.\n`;

    buildLogs += `[CI/CD Engine] Checking out commit: ${commitHash} ...\n`;
    const repoGit = simpleGit(workspacePath);
    await repoGit.checkout(commitHash);
    buildLogs += `[CI/CD Engine] Checked out commit ${commitHash} successfully.\n`;

    // 4. Validate package.json
    const packageJsonExists = await fs.access(path.join(workspacePath, 'package.json'))
      .then(() => true)
      .catch(() => false);

    if (!packageJsonExists) {
      throw new Error("package.json not found in repository root. A valid Node.js project is required.");
    }

    // 5. Pull Docker image node:20-alpine if not exists
    const imageName = 'node:20-alpine';
    let imageExists = false;
    try {
      await docker.getImage(imageName).inspect();
      imageExists = true;
    } catch (inspectErr) {
      // Not found locally
    }

    if (!imageExists) {
      console.log(`[Worker] Image ${imageName} not found locally. Pulling...`);
      buildLogs += `[CI/CD Engine] Docker image ${imageName} not found locally. Pulling from Docker Hub...\n`;
      await pullImage(imageName);
      buildLogs += `[CI/CD Engine] Docker image ${imageName} pulled successfully.\n`;
    }

    // 6. Create isolated Docker Container
    console.log(`[Worker] Creating container for build ${buildId}...`);
    buildLogs += `[CI/CD Engine] Spawning isolated sandboxed container...\n`;

    container = await docker.createContainer({
      Image: imageName,
      Cmd: ['/bin/sh', '-c', 'npm install && npm test'],
      WorkingDir: '/app',
      HostConfig: {
        Binds: [`${workspacePath}:/app`],
        AutoRemove: true
      },
      Tty: true
    });

    // Attach stream to capture stdout/stderr logs
    const logStream = await container.attach({
      stream: true,
      stdout: true,
      stderr: true
    });

    logStream.on('data', (chunk) => {
      buildLogs += chunk.toString();
    });

    // Start container
    await container.start();
    console.log(`[Worker] Container started for build ${buildId}.`);

    // 7. Implement timeout race condition (max 2 minutes)
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error("Build timed out after 2 minutes."));
      }, 120000);
    });

    const exitCode = await Promise.race([
      container.wait().then(res => res.StatusCode),
      timeoutPromise
    ]);
    clearTimeout(timeoutId);

    buildLogs += `\n[CI/CD Engine] Container exited with code: ${exitCode}\n`;
    console.log(`[Worker] Container for build ${buildId} exited with code: ${exitCode}`);

    // Update status to SUCCESS or FAILED based on exit code
    const finalStatus = exitCode === 0 ? 'SUCCESS' : 'FAILED';
    await pool.query(
      "UPDATE builds SET status = $1, finished_at = NOW() WHERE id = $2",
      [finalStatus, buildId]
    );

    // Save build logs to database
    await pool.query(
      "INSERT INTO build_logs (build_id, log_message) VALUES ($1, $2)",
      [buildId, buildLogs]
    );

  } catch (err) {
    console.error(`[Worker] Error processing build ${buildId}:`, err);
    buildLogs += `\n[CI/CD Engine] Build Failed. Error: ${err.message}\n`;

    // Force stop container if it was running and threw an error (like timeout)
    if (container) {
      try {
        await container.stop();
      } catch (stopErr) {
        // Container might already be stopped/removed
      }
    }

    await pool.query(
      "UPDATE builds SET status = 'FAILED', finished_at = NOW() WHERE id = $1",
      [buildId]
    );

    await pool.query(
      "INSERT INTO build_logs (build_id, log_message) VALUES ($1, $2)",
      [buildId, buildLogs]
    );
  } finally {
    // Clean up temporary workspace
    if (workspacePath) {
      console.log(`[Worker] Cleaning up workspace for build ${buildId}...`);
      await cleanWorkspace(buildId);
    }
  }
}, { connection });

worker.on('completed', job => {
  console.log(`[Worker] Job ${job.id} has completed!`);
});

worker.on('failed', (job, err) => {
  console.log(`[Worker] Job ${job.id} has failed with ${err.message}`);
});

console.log("[Worker] Started and listening for jobs on build-queue...");
