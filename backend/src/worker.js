require('dotenv').config();
const { Worker } = require('bullmq');
const Docker = require('dockerode');
const simpleGit = require('simple-git');
const path = require('path');
const fs = require('fs').promises;
const pool = require('./db');
const { createWorkspace, cleanWorkspace } = require('./workspace');
const { updateGitHubStatus } = require('./utils/githubStatus');

// --- Terminal Styling Helpers (ANSI Colors) ---
const styles = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
  bgBlue: '\x1b[44m\x1b[37m',
  bgGreen: '\x1b[42m\x1b[30m',
  bgRed: '\x1b[41m\x1b[37m'
};

const getTimestamp = () => `${styles.dim}[${new Date().toISOString().split('T')[1].slice(0, 8)}]${styles.reset}`;
const logWorker = (msg) => console.log(`${getTimestamp()} ${styles.magenta}${styles.bright}[WORKER]${styles.reset} ${msg}`);
const logEngine = (msg) => `${getTimestamp()} ${styles.cyan}${styles.bright}[ENGINE]${styles.reset} ${msg}`;
const logSuccess = (msg) => console.log(`${getTimestamp()} ${styles.bgGreen} SUCCESS ${styles.reset} ${styles.green}${msg}${styles.reset}`);
const logError = (msg, err) => console.error(`${getTimestamp()} ${styles.bgRed} ERROR ${styles.reset} ${styles.red}${msg}${styles.reset}`, err || '');

// --- Core Setup ---
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

const saveLogs = async (buildId, logs) => {
  try {
    const res = await pool.query("SELECT id FROM build_logs WHERE build_id = $1", [buildId]);
    if (res.rows.length > 0) {
      await pool.query("UPDATE build_logs SET log_message = $1 WHERE build_id = $2", [logs, buildId]);
    } else {
      await pool.query("INSERT INTO build_logs (build_id, log_message) VALUES ($1, $2)", [buildId, logs]);
    }
  } catch (err) {
    logError(`Failed to save DB logs for build ${buildId}`, err);
  }
};

// --- Language Detection & Workflow Configuration ---
const detectProjectContext = async (workspacePath) => {
  // 1. Check for magnus-ci.json
  const configPath = path.join(workspacePath, 'magnus-ci.json');
  try {
    const data = await fs.readFile(configPath, 'utf8');
    const config = JSON.parse(data);
    if (!config.image || !config.run) {
      throw new Error("Invalid configuration: 'image' and 'run' fields are required in magnus-ci.json.");
    }
    return {
      language: 'custom',
      imageName: config.image,
      runCommand: config.run
    };
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw err;
    }
  }

  // Helper check for file existence
  const fileExists = async (filename) => {
    return fs.access(path.join(workspacePath, filename))
      .then(() => true)
      .catch(() => false);
  };

  // 2. Automated Fallbacks
  // Node.js
  if (await fileExists('package.json')) {
    return {
      language: 'Node.js',
      imageName: 'node:20-alpine',
      runCommand: 'npm install && npm test'
    };
  }

  // Go
  if (await fileExists('go.mod')) {
    return {
      language: 'Go',
      imageName: 'golang:1.21-alpine',
      runCommand: 'go test -v ./...'
    };
  }

  // Python
  if (await fileExists('requirements.txt') || await fileExists('pyproject.toml') || await fileExists('setup.py')) {
    const installCmd = await fileExists('requirements.txt') ? 'pip install -r requirements.txt && ' : '';
    return {
      language: 'Python',
      imageName: 'python:3.10-alpine',
      runCommand: `${installCmd}python -m unittest discover`
    };
  }

  // Java Maven
  if (await fileExists('pom.xml')) {
    return {
      language: 'Java (Maven)',
      imageName: 'maven:3.9-eclipse-temurin-17-alpine',
      runCommand: 'mvn test'
    };
  }

  // Java Gradle
  if (await fileExists('build.gradle')) {
    return {
      language: 'Java (Gradle)',
      imageName: 'gradle:8-jdk17-alpine',
      runCommand: 'gradle test'
    };
  }

  // C/C++ CMake
  if (await fileExists('CMakeLists.txt')) {
    return {
      language: 'C/C++ (CMake)',
      imageName: 'gcc:13',
      runCommand: 'mkdir -p build && cd build && cmake .. && make && ctest'
    };
  }

  // C/C++ Makefile
  if (await fileExists('Makefile')) {
    return {
      language: 'C/C++ (Make)',
      imageName: 'gcc:13',
      runCommand: 'make test'
    };
  }

  throw new Error("Could not auto-detect project language type. Please add a 'magnus-ci.json' file to configure your build environment.");
};

// --- Test Summary Parser Helper ---
const extractTestSummary = (logs, defaultMsg) => {
  if (!logs) return defaultMsg;
  const cleanLogs = logs.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');

  const jestRegex = /Tests:\s+(?:(\d+)\s+failed,\s+)?(?:(\d+)\s+passed,\s+)?(\d+)\s+total/;
  const jestMatch = cleanLogs.match(jestRegex);
  if (jestMatch) {
    const failed = parseInt(jestMatch[1] || 0, 10);
    const passed = parseInt(jestMatch[2] || 0, 10);
    const total = parseInt(jestMatch[3] || 0, 10);
    if (failed > 0) return `${passed}/${total} passed (${failed} failed)`;
    return `${passed}/${total} passed`;
  }

  const pytestRegex = /==+\s+(?:(\d+)\s+failed,\s+)?(?:(\d+)\s+passed)?.*in\s+([\d.]+s)\s+==+/;
  const pytestMatch = cleanLogs.match(pytestRegex);
  if (pytestMatch) {
    const failed = parseInt(pytestMatch[1] || 0, 10);
    const passed = parseInt(pytestMatch[2] || 0, 10);
    if (failed > 0) return `${passed} passed, ${failed} failed`;
    return `${passed} passed`;
  }

  const junitRegex = /Tests run:\s*(\d+),\s*Failures:\s*(\d+),\s*Errors:\s*(\d+)/;
  const junitMatch = cleanLogs.match(junitRegex);
  if (junitMatch) {
    const run = parseInt(junitMatch[1] || 0, 10);
    const failures = parseInt(junitMatch[2] || 0, 10);
    const errors = parseInt(junitMatch[3] || 0, 10);
    const passed = run - failures - errors;
    if (failures > 0 || errors > 0) return `${passed}/${run} passed (${failures + errors} failed)`;
    return `${passed}/${run} passed`;
  }

  if (cleanLogs.includes('PASS') && cleanLogs.includes('ok')) {
    return 'All tests passed';
  }
  if (cleanLogs.includes('FAIL') && cleanLogs.includes('--- FAIL:')) {
    return 'Some tests failed';
  }

  return defaultMsg;
};

// --- Worker Loop ---
const worker = new Worker('build-queue', async job => {
  const { buildId, repoUrl, commitHash } = job.data;
  
  let owner = '';
  let repoName = '';
  try {
    const parts = repoUrl.split('/');
    repoName = parts.pop().replace('.git', '');
    owner = parts.pop();
  } catch (e) {}
  
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const targetUrl = `${frontendUrl}/`;

  console.log(`\n${styles.bright}${styles.blue}┌────────────────────────────────────────────────────────┐${styles.reset}`);
  logWorker(`🚀 Job Picked Up | ${styles.bright}Build ID: ${buildId}${styles.reset}`);
  logWorker(`📂 Repo: ${styles.dim}${repoUrl}${styles.reset} @ [${styles.yellow}${commitHash.slice(0, 7)}${styles.reset}]`);
  console.log(`${styles.bright}${styles.blue}└────────────────────────────────────────────────────────┘${styles.reset}`);

  let workspacePath = '';
  let container = null;
  let buildLogs = '';

  try {
    // 1. Update status to RUNNING
    await pool.query(
      "UPDATE builds SET status = 'RUNNING', started_at = NOW() WHERE id = $1",
      [buildId]
    );
    logWorker(`Build status forced to ${styles.yellow}RUNNING${styles.reset}.`);
    
    await updateGitHubStatus(owner, repoName, commitHash, 'pending', 'Build started', targetUrl);

    // 2. Create local workspace
    workspacePath = await createWorkspace(buildId);
    buildLogs += logEngine(`Created workspace path: ${styles.dim}${workspacePath}${styles.reset}\n`);
    await saveLogs(buildId, buildLogs);

    // 3. Git Clone & Checkout
    buildLogs += logEngine(`Cloning repository... 📥\n`);
    await saveLogs(buildId, buildLogs);
    const git = simpleGit();
    await git.clone(repoUrl, workspacePath);
    buildLogs += logEngine(`${styles.green}✔ Repository cloned successfully.${styles.reset}\n`);
    await saveLogs(buildId, buildLogs);

    buildLogs += logEngine(`Checking out commit: ${styles.yellow}${commitHash}${styles.reset}\n`);
    await saveLogs(buildId, buildLogs);
    const repoGit = simpleGit(workspacePath);
    await repoGit.checkout(commitHash);
    buildLogs += logEngine(`${styles.green}✔ Target commit successfully isolated.${styles.reset}\n`);
    await saveLogs(buildId, buildLogs);

    // 4. Detect environment configuration
    buildLogs += logEngine(`Detecting project language and build environment...\n`);
    await saveLogs(buildId, buildLogs);
    
    const { language, imageName, runCommand } = await detectProjectContext(workspacePath);
    
    buildLogs += logEngine(`Detected context: ${styles.green}${language}${styles.reset} environment. Selected container: ${styles.yellow}${imageName}${styles.reset}\n`);
    buildLogs += logEngine(`Configured test command: ${styles.dim}${runCommand}${styles.reset}\n`);
    await saveLogs(buildId, buildLogs);

    // 5. Pull Docker image if not exists
    let imageExists = false;
    try {
      await docker.getImage(imageName).inspect();
      imageExists = true;
    } catch (inspectErr) {
      // Not found locally
    }

    if (!imageExists) {
      logWorker(`Docker image ${imageName} missing locally. Pulling from hub...`);
      buildLogs += logEngine(`Pulling base layer image: ${styles.magenta}${imageName}${styles.reset}...\n`);
      await saveLogs(buildId, buildLogs);
      await pullImage(imageName);
      buildLogs += logEngine(`${styles.green}✔ Base layer cached successfully.${styles.reset}\n`);
      await saveLogs(buildId, buildLogs);
    }

    // 6. Create isolated Docker Container
    logWorker(`Spawning sandbox container for pipeline execution...`);
    buildLogs += logEngine(`Configuring runtime container context...\n`);
    await saveLogs(buildId, buildLogs);

    container = await docker.createContainer({
      Image: imageName,
      Cmd: ['/bin/sh', '-c', runCommand],
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

    let lastLogSave = Date.now();
    logStream.on('data', (chunk) => {
      const output = chunk.toString();
      buildLogs += output;
      process.stdout.write(output);
      if (Date.now() - lastLogSave > 1000) {
        saveLogs(buildId, buildLogs).catch(() => {});
        lastLogSave = Date.now();
      }
    });

    // Start container
    await container.start();
    logWorker(`Sandbox runtime container online.`);

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

    buildLogs += `\n` + logEngine(`Container execution exited with code: ${exitCode === 0 ? styles.green : styles.red}${exitCode}${styles.reset}\n`);
    logWorker(`Runtime session killed. Status Code: ${exitCode}`);

    // Update status to SUCCESS or FAILED based on exit code
    const finalStatus = exitCode === 0 ? 'SUCCESS' : 'FAILED';
    await pool.query(
      "UPDATE builds SET status = $1, finished_at = NOW() WHERE id = $2",
      [finalStatus, buildId]
    );

    const githubState = exitCode === 0 ? 'success' : 'failure';
    const defaultMsg = `Build ${finalStatus.toLowerCase()}`;
    const testSummary = extractTestSummary(buildLogs, defaultMsg);
    const description = testSummary !== defaultMsg ? `${language}: ${testSummary}` : defaultMsg;
    await updateGitHubStatus(owner, repoName, commitHash, githubState, description, targetUrl);

    await saveLogs(buildId, buildLogs);

  } catch (err) {
    logError(`Build pipeline broken down at ID: ${buildId}`, err.message);
    buildLogs += `\n` + logEngine(`${styles.red}❌ Operational breakdown: ${err.message}${styles.reset}\n`);

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

    await updateGitHubStatus(owner, repoName, commitHash, 'error', 'Build error', targetUrl);

    await saveLogs(buildId, buildLogs);
  } finally {
    if (workspacePath) {
      logWorker(`Pruning operational file tree workspace...`);
      await cleanWorkspace(buildId);
    }
  }
}, { connection });

// --- Global Worker Events ---
worker.on('completed', job => {
  logSuccess(`Job #${job.id} has fully executed and finished context routines.`);
});

worker.on('failed', (job, err) => {
  logError(`Job #${job.id} emitted standard failure trap event:`, err.message);
});

worker.on('error', err => {
  logError(`Worker queue error:`, err);
});

// --- Startup Banner ---
console.clear();
console.log(`
${styles.cyan}${styles.bright} ┌────────────────────────────────────────────────────────┐
 │ 🚀  CI/CD PIPELINE ENGINE WORKER ONLINE                │
 │     Listening to queue: ${styles.yellow}build-queue${styles.cyan}                   │
 └────────────────────────────────────────────────────────┘${styles.reset}
`);