require('dotenv').config();
const { Worker } = require('bullmq');
const pool = require('./db');

const connection = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT || '6379')
};

const worker = new Worker('build-queue', async job => {
  const { buildId, repoUrl, commitHash } = job.data;
  console.log(`[Worker] Picked up job for buildId: ${buildId}, repoUrl: ${repoUrl}`);

  try {
    // 1. Update status to RUNNING
    await pool.query(
      "UPDATE builds SET status = 'RUNNING', started_at = NOW() WHERE id = $1",
      [buildId]
    );
    console.log(`[Worker] Build ${buildId} marked as RUNNING.`);

    // 2. Simulate 10 second build
    await new Promise(resolve => setTimeout(resolve, 10000));

    // 3. Randomly succeed or fail
    const isSuccess = Math.random() > 0.3; // 70% chance of success
    const finalStatus = isSuccess ? 'SUCCESS' : 'FAILED';

    await pool.query(
      "UPDATE builds SET status = $1, finished_at = NOW() WHERE id = $2",
      [finalStatus, buildId]
    );
    console.log(`[Worker] Build ${buildId} finished with status: ${finalStatus}`);

  } catch (err) {
    console.error(`[Worker] Error processing build ${buildId}:`, err);
    await pool.query(
      "UPDATE builds SET status = 'FAILED', finished_at = NOW() WHERE id = $1",
      [buildId]
    );
  }
}, { connection });

worker.on('completed', job => {
  console.log(`[Worker] Job ${job.id} has completed!`);
});

worker.on('failed', (job, err) => {
  console.log(`[Worker] Job ${job.id} has failed with ${err.message}`);
});

console.log("[Worker] Started and listening for jobs on build-queue...");
