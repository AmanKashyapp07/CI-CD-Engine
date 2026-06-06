# Comprehensive Manual Testing & Verification Guide

This document provides a set of manual test cases to verify the core functionalities implemented during Weeks 1, 2, and 3. These tests bypass automated scripts where possible, allowing you to manually verify the database state, container creation, filesystem cleanup, and gateway responses.

---

## 🛠️ Step 0: Ensure Services are Active

Open three terminal windows and start the core engine services:

```bash
# Terminal 1: Ingestion API Gateway
cd backend && npm run dev

# Terminal 2: Asynchronous Job Worker
cd backend && node src/worker.js

# Terminal 3: Redis Server
redis-cli ping  # Must return PONG
```

---

## 🧪 Test Suite 1: Webhook Ingestion & Cryptographic Verification

This verifies the HMAC SHA-256 signature verification and fast $O(1)$ gateway response times.

### Test Case 1.1: Valid Signature (Authorized Request)
1. Ensure `GITHUB_WEBHOOK_SECRET=aman123` is configured in `backend/.env`.
2. Run the webhook simulator script:
   ```bash
   node backend/src/test_webhook.js
   ```
3. **Verification**:
   * **Terminal output**: Should print `Response Status: 202` and a JSON response body containing the `buildId`.
   * **Latency check**: The request should complete in under 50ms (since it returns immediately without waiting for the build).

### Test Case 1.2: Invalid Signature (Unauthorized Spoof Attack)
1. Open `backend/src/test_webhook.js` and modify the secret configuration line temporarily:
   ```javascript
   const secret = "wrong-secret-123";
   ```
2. Execute the webhook simulator:
   ```bash
   node backend/src/test_webhook.js
   ```
3. **Verification**:
   * **Terminal output**: Should print `Response Status: 401`.
   * **JSON Body**: Should contain `{ "error": "Invalid signature. Verification failed." }`.

### Test Case 1.3: Missing Signature Header (Bypass Check)
1. Open `backend/src/test_webhook.js` and force it to send signature-less headers:
   * Comment out the code block that attaches the `X-Hub-Signature-256` header (lines 24-31).
2. Execute:
   ```bash
   node backend/src/test_webhook.js
   ```
3. **Verification**:
   * **Terminal output**: Should print `Response Status: 401`.
   * **JSON Body**: `{ "error": "No signature header found (x-hub-signature-256)" }`.

---

## 🧪 Test Suite 2: URL Normalization Verification

This verifies that duplicate or weirdly formatted repository URLs are sanitized before entering the system.

### Test Case 2.1: Sanitization Casing and Suffixes
1. Open `backend/src/test_webhook.js` and edit the repository `clone_url` to contain caps, trailing slashes, and a `.git` suffix:
   ```javascript
   clone_url: "HTTPS://GITHUB.COM/amankashyap/Mock-Repo.git/"
   ```
2. Run the simulator:
   ```bash
   node backend/src/test_webhook.js
   ```
3. **Verification**:
   * Connect to your PostgreSQL database:
     ```bash
     psql -d <your_database_name> -c "SELECT github_url FROM repositories WHERE name = 'mock-repo';"
     ```
   * **Expected output**: The saved URL must be cleanly formatted as:
     `https://github.com/amankashyap/mock-repo`

---

## 🧪 Test Suite 3: Local Filesystem Workspace Sandboxing

This verifies that the worker creates clean workspaces and deletes them completely after container exit (resource reclamation).

### Test Case 3.1: Workspace Creation & Deletion
1. Open the backend directory in your file explorer or another terminal and monitor the `backend/temp_builds` directory:
   ```bash
   watch -n 0.5 ls -R backend/temp_builds
   ```
2. Run the webhook simulator:
   ```bash
   node backend/src/test_webhook.js
   ```
3. **Verification**:
   * During the build process, a subdirectory matching the `buildId` (e.g. `temp_builds/12/`) should appear. Inside, you should see the cloned repository code.
   * Immediately after the worker log prints `[Worker] Job <id> has completed!`, the subdirectory `temp_builds/12/` must be deleted recursively. The `temp_builds/` directory should be empty.

---

## 🧪 Test Suite 4: Programmatic Container Sandboxing & Runtimes

This verifies that the engine runs tests inside isolated Docker containers and captures correct exit signals.

### Test Case 4.1: Success Paths (Passing Tests)
1. Configure `backend/mock-repo/package.json` test script to succeed:
   ```json
   "scripts": {
     "test": "echo 'Succeeding!' && exit 0"
   }
   ```
2. Git commit the change in `mock-repo`:
   ```bash
   cd backend/mock-repo && git commit -am "force success" && cd ..
   ```
3. Update `after` in `test_webhook.js` with the new commit hash:
   ```bash
   cd backend/mock-repo && git rev-parse HEAD
   ```
4. Run `node src/test_webhook.js`.
5. **Verification**:
   * **Worker logs**: Should show `Container for build X exited with code: 0`.
   * **Database**: Query the builds table:
     ```bash
     psql -d <your_database_name> -c "SELECT status, started_at, finished_at FROM builds ORDER BY id DESC LIMIT 1;"
     ```
     *Status must be `SUCCESS`.*

### Test Case 4.2: Failure Paths (Failing Tests)
1. Configure `backend/mock-repo/package.json` test script to fail:
   ```json
   "scripts": {
     "test": "echo 'Crashing tests!' && exit 1"
   }
   ```
2. Git commit in `mock-repo` and extract commit hash:
   ```bash
   cd backend/mock-repo && git commit -am "force failure" && git rev-parse HEAD
   ```
3. Update `after` in `test_webhook.js` and execute `node src/test_webhook.js`.
4. **Verification**:
   * **Worker logs**: Should show `Container for build X exited with code: 1`.
   * **Database**: Query builds table. *Status must be `FAILED`*.

### Test Case 4.3: Missing Project Requirements (Early Failure)
1. Delete `package.json` inside the temp repository or configure `test_webhook.js` to point to a folder/repo containing no `package.json`.
2. Run `node src/test_webhook.js`.
3. **Verification**:
   * **Worker logs**: Should instantly output `Error processing build X: package.json not found in repository root. A valid Node.js project is required.`
   * The worker should skip container creation entirely and clean up the workspace immediately.
   * **Database**: Query builds table. *Status must be `FAILED`*.

### Test Case 4.4: Hard Timeouts (Prevention of CPU Starvation)
1. Configure `backend/mock-repo/package.json` test script to run an infinite wait script:
   ```json
   "scripts": {
     "test": "node -e 'setInterval(() => console.log(\"stuck...\"), 1000)'"
   }
   ```
2. Commit in `mock-repo` and extract commit hash:
   ```bash
   cd backend/mock-repo && git commit -am "force hang" && git rev-parse HEAD
   ```
3. Temporarily update the timeout value in `backend/src/worker.js` (line 110) from `120000` (2 minutes) to `10000` (10 seconds) to speed up testing:
   ```javascript
   // Change 120000 to 10000
   ```
4. Restart the worker task.
5. Run `node src/test_webhook.js`.
6. **Verification**:
   * **Worker logs**: Should show `Error processing build X: Error: Build timed out after 2 minutes.` (or 10 seconds).
   * **Docker check**: Run `docker ps` to ensure the container is terminated and removed. It should not be running.
   * **Database**: Query builds table. *Status must be `FAILED`*.

---

## 🧪 Test Suite 5: Log Stream Persistences

This verifies that standard output streams are successfully captured and saved.

### Test Case 5.1: Log Extraction Check
1. Trigger any build run using the webhook simulator.
2. Query the build logs table:
   ```bash
   psql -d <your_database_name> -c "SELECT log_message FROM build_logs ORDER BY id DESC LIMIT 1;"
   ```
3. **Verification**:
   * The output log message must contain:
     * `[CI/CD Engine] Created workspace at ...`
     * `[CI/CD Engine] Cloning repository: ...`
     * `[CI/CD Engine] Checked out commit ... successfully.`
     * Running output of the container execution (e.g. `npm install` progress or `Mock tests executed successfully!`).
     * `[CI/CD Engine] Container exited with code: 0` (or `1`).
