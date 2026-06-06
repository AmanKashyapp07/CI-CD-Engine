# Step-by-Step Tutorial: Observing Docker in Action

This tutorial explains how to visually observe, inspect, and verify the Docker integration in your CI/CD Engine. Since Docker containers spin up and clean up in a few seconds, it can be hard to "see" them in action. 

This guide will show you how to slow down the execution process so you can visually verify the container sandbox using both the terminal and Docker Desktop.

---

## 🏗️ Step 1: Open Docker Desktop
1. Launch **Docker Desktop** on your Mac.
2. Ensure the green indicator in the bottom-left corner of Docker Desktop is active (showing "Engine Running").
3. Click on the **Containers** tab in the sidebar. This is where you will visually watch the container appear and disappear.

---

## ⏳ Step 2: Slow Down the Build (For Visual Inspection)
Normally, your mock repository tests run in less than a second. To give yourself enough time to inspect the running container, let's configure your mock project to sleep for **30 seconds** during the test run.

1. Open `/Users/amankashyap/Documents/ci-cd-engine/backend/mock-repo/package.json` and change the `test` script:
   ```json
   "scripts": {
     "test": "echo 'Sleeping for 30s...' && sleep 30 && echo 'Mock tests finished!' && exit 0"
   }
   ```
2. Save the file.
3. Open a terminal and commit the change inside your mock repository:
   ```bash
   cd /Users/amankashyap/Documents/ci-cd-engine/backend/mock-repo
   git commit -am "add 30s sleep to tests"
   git rev-parse HEAD
   ```
4. Copy the commit hash printed (e.g., `5a1b2c3d...`).
5. Open `/Users/amankashyap/Documents/ci-cd-engine/backend/src/test_webhook.js` and update the `after` field with this new commit hash.

---

## 🚀 Step 3: Trigger the Build
1. In one terminal, ensure your worker is running:
   ```bash
   cd /Users/amankashyap/Documents/ci-cd-engine/backend
   node src/worker.js
   ```
2. In a second terminal, trigger the webhook:
   ```bash
   node src/test_webhook.js
   ```

---

## 🐳 Step 4: Watch the Container Run

Now you have 30 seconds to inspect the sandbox environment using either Docker Desktop or your terminal:

### Option A: Check Docker Desktop (Visual GUI)
1. Keep the **Docker Desktop -> Containers** tab open.
2. As soon as you trigger the build, you will see a new container spawn (it will have a random name like `peaceful_curie` or `serene_hawking` and run the `node:20-alpine` image).
3. Click on the container name.
4. You will see the container's live log output:
   ```text
   Sleeping for 30s...
   ```

### Option B: Check Terminal (CLI)
1. Open a new terminal window and run:
   ```bash
   docker ps
   ```
2. **Expected Output**: You will see your running container listed:
   ```text
   CONTAINER ID   IMAGE             COMMAND                  STATUS         PORTS     NAMES
   a7b1c2d3e4f5   node:20-alpine    "/bin/sh -c 'npm ins…"   Up 5 seconds             peaceful_curie
   ```

---

## 🔎 Step 5: Verify the Isolated Filesystem Mount

While the container is sleeping (during the 30-second window), you can inspect its filesystem to prove it is isolated and has access to your workspace code.

1. Open your terminal and run:
   ```bash
   docker exec -it <CONTAINER_NAME_OR_ID> ls -la /app
   ```
   *(Replace `<CONTAINER_NAME_OR_ID>` with the running container name from `docker ps` e.g., `peaceful_curie`)*
2. **Expected Output**:
   ```text
   total 16
   drwxr-xr-x    3 root     root            96 Jun  5 19:12 .
   drwxr-xr-x    1 root     root          4096 Jun  5 19:12 ..
   drwxr-xr-x    7 root     root           224 Jun  5 19:12 .git
   -rw-r--r--    1 root     root           118 Jun  5 19:12 package.json
   ```
This proves that the code cloned onto your Mac host (`temp_builds/`) has been successfully mounted into the isolated Linux sandbox at `/app`.

---

## 🧹 Step 6: Verify Auto-Reclamation & Clean up
1. Wait for the 30 seconds to elapse.
2. In the worker terminal, you will see:
   `[Worker] Container for build X exited with code: 0`
   `[Worker] Cleaning up workspace for build X...`
3. Check **Docker Desktop**: The container will disappear from the list (thanks to the `AutoRemove: true` parameter).
4. Run `docker ps` in your terminal: The container is no longer there.
5. List the `temp_builds` directory:
   ```bash
   ls -la /Users/amankashyap/Documents/ci-cd-engine/backend/temp_builds
   ```
   The build folder has been completely deleted.
