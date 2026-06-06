# Guide to Testing All Features

This guide details how to verify and test every feature implemented in the CI/CD Engine so far, including user authentication, repository registration, URL normalization, webhook signature verification, asynchronous queueing, and UI rendering.

---

## 🛠️ Prerequisites & Setup

Ensure the following dependencies and services are running locally before starting the tests:

1. **Redis Server**: Start a local Redis instance on port `6379`.
   ```bash
   redis-cli ping # Should return PONG
   ```
2. **PostgreSQL Database**: Ensure your database is running and credentials in `backend/.env` are correct.
3. **Environment Variables (`backend/.env`)**:
   ```env
   GITHUB_WEBHOOK_SECRET=aman123
   GITHUB_CLIENT_ID=<Your_Github_OAuth_Client_ID>
   GITHUB_CLIENT_SECRET=<Your_Github_OAuth_Client_Secret>
   JWT_SECRET=aman123
   FRONTEND_URL=http://localhost:5173
   REDIS_HOST=127.0.0.1
   REDIS_PORT=6379
   ```

---

## 🚀 Step 1: Start Backend, Frontend, and Workers

Open three separate terminals to run all components of the system:

1. **Terminal 1: Start Backend Gateway**
   ```bash
   cd backend
   npm run dev
   ```
   *Expected Output:*
   `Backend server is running on http://localhost:5001`
   `Database connection successful.`

2. **Terminal 2: Start Background worker**
   ```bash
   cd backend
   node src/worker.js
   ```
   *Expected Output:*
   `[Worker] Started and listening for jobs on build-queue...`

3. **Terminal 3: Start React Frontend**
   ```bash
   cd frontend
   npm run dev
   ```
   *Expected Output:*
   `Vite dev server running at http://localhost:5173`

---

## 🔐 Feature 1: GitHub Authentication (OAuth 2.0)

1. Open your browser and navigate to `http://localhost:5173`.
2. Since you are unauthenticated, you should be presented with a premium dark-themed **Login Page** with a **"Login with GitHub"** button.
3. Click **"Login with GitHub"**.
4. You will be redirected to GitHub to authorize the application. 
5. Once authorized, you will be redirected back to the dashboard (`http://localhost:5173/?token=...`).
6. **Verify JWT Persistence**: Open Developer Tools (F12) -> Application -> Local Storage. Verify that a `token` exists.
7. **Verify Session Details**: Ensure your GitHub profile picture and username are displayed in the header.

---

## 📁 Feature 2: Repository Registration & Normalization

1. On the dashboard, locate the **"Add Repository"** section.
2. Enter a GitHub repository name (e.g., `magnus-test`) and its URL:
   * Try entering it with a `.git` suffix: `https://github.com/amankashyap/magnus-test.git`
   * Or with a trailing slash: `https://github.com/amankashyap/magnus-test/`
3. Click **"Register Repository"**.
4. **Verify Normalization**: 
   * Check the dashboard to see if the repository is listed.
   * Query the database (or examine payload network logs) to verify that the URL was normalized to lowercase and stripped of `.git` and trailing slashes: `https://github.com/amankashyap/magnus-test`.
5. **Verify Multi-Tenancy / Protection**:
   * Add a repository while logged in.
   * Open a private window or log out, sign in with a different GitHub account (if available), and verify that you cannot see repositories registered by the first user.

---

## 🛡️ Feature 3: Webhook Verification & Async Queueing

Since we cannot expose a local address to GitHub easily without tools like `ngrok`, we will use the built-in webhook simulator script `test_webhook.js` to simulate GitHub's payload signature validation and delivery:

1. Open a terminal and run the test script:
   ```bash
   node backend/src/test_webhook.js
   ```
2. **How this script works internally**:
   * It signs the payload using `HMAC SHA-256` with the secret configured in `.env` (`aman123`).
   * It sends a POST request with the signature header `x-hub-signature-256` to `http://localhost:5001/api/webhooks/github`.
3. **Verify Gateway Response**:
   * The terminal output of `test_webhook.js` should show:
     ```json
     Response Status: 202
     Response Body: {
       "message": "Build triggered successfully",
       "buildId": <id>,
       "status": "PENDING"
     }
     ```
   * The gateway returns `202 Accepted` **immediately**, confirming that it did not block the request while executing the build.

---

## ⚙️ Feature 4: Background Worker Execution & DB Updates

Immediately after triggering the webhook in Step 3, monitor your terminals and dashboard:

1. **Monitor Worker (Terminal 2)**:
   * Within milliseconds, you should see:
     `[Worker] Picked up job for buildId: <id>, repoUrl: <repoUrl>`
     `[Worker] Build <id> marked as RUNNING.`
   * The worker will then pause for 10 seconds (simulating build/test execution).
   * After 10 seconds, it will print:
     `[Worker] Build <id> finished with status: SUCCESS` (or `FAILED`)
     `[Worker] Job <job_id> has completed!`

2. **Monitor Frontend Dashboard (`http://localhost:5173`)**:
   * When the build is first triggered, the build table/list should show the build status as **PENDING**.
   * When the worker picks up the job, the status on the UI should update to **RUNNING** (with a subtle pulsing animation indicating build activity).
   * After the 10-second simulation completes, the UI should display the final state (**SUCCESS** in green or **FAILED** in red), along with the duration computed from `started_at` and `finished_at`.

---

## 🧪 Edge Cases to Test

1. **Invalid Webhook Signature**:
   * Modify the secret in `backend/.env` (e.g., change `GITHUB_WEBHOOK_SECRET` to something else) and run `node backend/src/test_webhook.js`.
   * The endpoint should reject the request with `401 Unauthorized`.
2. **Missing Token**:
   * Try querying the repositories endpoint directly without authorization:
     ```bash
     curl -i http://localhost:5001/api/repositories
     ```
   * It should reject the request with a `401 Unauthorized` response.
3. **URL Normalization Match**:
   * Ensure that registering a repository as `https://github.com/AmanKashyap/magnus-test.git` still correctly triggers builds when the webhook payload arrives with `https://github.com/amankashyap/magnus-test`. They must normalize and match perfectly.
