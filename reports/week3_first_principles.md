# Week 3 First Principles Report: Programmatic Sandboxed Code Execution

This report explains the fundamental concepts, systems-level mechanics, and architectural design choices of the isolated code execution engine implemented in Week 3. 

---

## 🛠️ The Core Problem: Secure & Isolated Arbitrary Code Execution

In any CI/CD system, developers submit code to be compiled, installed, and tested. This introduces two critical engineering challenges:
1.  **Security**: User-submitted code is inherently untrusted. Run without constraints, a malicious repository could execute root-level commands (`rm -rf /`), access host system files, or hijack server resources for cryptomining.
2.  **Concurrency & Clean States**: Multiple builds can run at the same time. If they run on the same shared host operating system, they will conflict over local dependencies, open ports, and file systems.

To solve this from **first principles**, we designed an architecture that isolates the build environment on two layers: the **filesystem layer** and the **operating system/process layer**.

---

## 1. Filesystem Layer: Ephemeral Workspaces

Instead of cloning and building inside the root project directory, we instantiate a dedicated, short-lived folder for every build.

```
backend/
  └── temp_builds/
        ├── 11/         <-- Ephemeral workspace for Build 11
        │    ├── package.json
        │    └── index.js
        └── 12/         <-- Ephemeral workspace for Build 12
```

### The Mechanism
1.  **Creation**: When a job is picked up by the worker, `workspace.js` runs `fs.mkdir` to create `backend/temp_builds/${buildId}`.
2.  **Git Checkout**: We use `simple-git` (which wraps the native Git CLI) to perform:
    ```bash
    git clone <repo_url> <workspace_path>
    git checkout <commit_hash>
    ```
    This fetches the exact state of the repository at the time the webhook was triggered.
3.  **Destruction**: In the `finally` block of our worker execution loop, we run `fs.rm` with `{ recursive: true, force: true }` on the workspace directory. Regardless of whether the build succeeded, failed, or timed out, the directory is deleted to prevent disk space leaks.

---

## 2. Process Layer: The Unix Socket & Docker Daemon

Instead of running commands like `npm test` using Node.js's `child_process.exec` directly on the host server, we delegate command execution to a containerized environment.

```
+------------------+                    +---------------------+
|  Backend Worker  | ---[Write/Read]--->| /var/run/docker.sock |
+------------------+                    +---------------------+
                                                   |
                                                   v
                                        +---------------------+
                                        |    Docker Daemon    |
                                        +---------------------+
                                                   |
                                          (Creates Container)
                                                   v
                                        +---------------------+
                                        | Docker Container    |
                                        | (node:20-alpine)    |
                                        |                     |
                                        |  - Mounts workspace |
                                        |  - Runs npm test    |
                                        +---------------------+
```

### The Docker Unix Domain Socket (`/var/run/docker.sock`)
On Unix-based operating systems, processes communicate using Unix Domain Sockets (IPC) instead of network ports. The Docker Daemon (`dockerd`) listens on `/var/run/docker.sock`. 
*   Our worker process uses **`dockerode`**, which establishes a stream connection to this socket.
*   Every instruction we write (e.g. creating a container) translates to a REST API call sent over this local socket to the Docker Engine.

---

## 3. Container Sandboxing: Programmatic Binds & Auto-Reclamation

To run code, we pull and spin up a lightweight container image: `node:20-alpine` (a highly minimal Linux distribution with Node.js and NPM preloaded).

### Bind Mount Configuration
To expose the checked-out source code to the container, we configure a **Bind Mount**:
```javascript
HostConfig: {
  Binds: [`${workspacePath}:/app`],
  AutoRemove: true
}
```
*   `Binds`: Maps the absolute directory path on our host machine (`workspacePath`) to the `/app` folder inside the container. The container sees this code as its local filesystem.
*   `AutoRemove: true`: Instructs the Docker Engine to automatically destroy the container metadata and filesystem overlays the moment it stops. This prevents "zombie containers" from cluttering the host's memory and storage.

---

## 4. Input/Output Multiplexing (Log Streaming)

To capture what happens during the build, we attach to the container's standard output streams:
1.  We set `Tty: true` in the container configuration. This allocates a pseudo-TTY, which merges `stdout` (normal logs) and `stderr` (error logs) into a single, cohesive terminal stream, matching what developers see in their local terminal.
2.  Before calling `container.start()`, we attach to the container:
    ```javascript
    const logStream = await container.attach({ stream: true, stdout: true, stderr: true });
    logStream.on('data', (chunk) => { buildLogs += chunk.toString(); });
    ```
    This actively appends incoming command outputs directly into our `buildLogs` variable in real-time.

---

## 5. Timeout Safeguards (Race Constraints)

If a developer writes an infinite loop in their tests (e.g. `while(true) {}`), the build container would run forever, consuming 100% CPU and blocking the worker pool. 

To prevent this resource starvation, we construct an asynchronous **Race Condition** using JavaScript Promises:

```javascript
const timeoutPromise = new Promise((_, reject) => {
  setTimeout(() => reject(new Error("Build timed out")), 120000); // 2 minutes
});

const exitCode = await Promise.race([
  container.wait(),
  timeoutPromise
]);
```
*   If `container.wait()` resolves first, the build succeeded or failed normally.
*   If `timeoutPromise` rejects first, the worker interrupts execution, falls into the `catch` block, issues `container.stop()` to force-terminate the container, and sets the build status to `FAILED` with a timeout log.

---

## 6. State Machine Resolution

After execution concludes, the worker queries the exit status of the main process within the container.
*   **Exit Code `0`**: Standard unix convention indicating success. The worker updates the build status to `SUCCESS`.
*   **Exit Code `non-zero`** (e.g., `1`): Indicates a crash, syntax error, or failing test. The worker updates the build status to `FAILED`.
*   Finally, the accumulated log stream (`buildLogs`) is written into the `build_logs` database table associated with the `buildId`, ready to be loaded by the user interface.
