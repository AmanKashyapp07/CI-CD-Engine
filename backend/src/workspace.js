const fs = require('fs').promises;
const path = require('path');

const BASE_TEMP_DIR = path.join(__dirname, '../temp_builds');

async function createWorkspace(buildId) {
  const workspacePath = path.join(BASE_TEMP_DIR, String(buildId));
  await fs.mkdir(workspacePath, { recursive: true });
  return workspacePath;
}

async function cleanWorkspace(buildId) {
  const workspacePath = path.join(BASE_TEMP_DIR, String(buildId));
  try {
    await fs.rm(workspacePath, { recursive: true, force: true });
  } catch (error) {
    console.error(`[Workspace] Failed to clean workspace for build ${buildId}:`, error);
  }
}

module.exports = {
  createWorkspace,
  cleanWorkspace,
  BASE_TEMP_DIR
};
