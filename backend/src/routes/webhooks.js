const express = require("express");
const crypto = require("crypto");
const pool = require("../db");
const buildQueue = require("../queue");

const router = express.Router();

// Webhook payload signature validation middleware
const verifyGithubSignature = (req, res, next) => {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  
  // If no secret is configured, bypass verification (useful for local testing)
  if (!secret) {
    console.warn("WARNING: GITHUB_WEBHOOK_SECRET is not set. Skipping webhook signature verification.");
    return next();
  }

  const signature = req.headers["x-hub-signature-256"];
  if (!signature) {
    return res.status(401).json({ error: "No signature header found (x-hub-signature-256)" });
  }

  if (!req.rawBody) {
    return res.status(400).json({ error: "Missing raw request body for verification" });
  }

  try {
    const hmac = crypto.createHmac("sha256", secret);
    const digest = Buffer.from("sha256=" + hmac.update(req.rawBody).digest("hex"), "utf8");
    const checksum = Buffer.from(signature, "utf8");

    if (checksum.length !== digest.length || !crypto.timingSafeEqual(digest, checksum)) {
      return res.status(401).json({ error: "Invalid signature. Verification failed." });
    }

    next();
  } catch (error) {
    console.error("Signature verification error:", error);
    return res.status(500).json({ error: "Internal signature verification error" });
  }
};

// POST route for handling GitHub webhooks
router.post("/github", verifyGithubSignature, async (req, res) => {
  const eventType = req.headers["x-github-event"];
  const payload = req.body;

  // We are mainly interested in 'push' events for triggering builds
  if (eventType !== "push") {
    return res.status(200).json({ message: `Webhook received. Ignored event type: ${eventType}` });
  }

  try {
    const repository = payload.repository;
    const commitHash = payload.after; // The SHA of the commit that triggered the webhook

    if (!repository || !repository.clone_url) {
      return res.status(400).json({ error: "Missing repository information in payload" });
    }

    const repoName = repository.name;
    const githubUrl = repository.clone_url;
    
    const normalizeUrl = (url) => {
      if (!url) return url;
      return url.trim().toLowerCase().replace(/\.git$/, "").replace(/\/$/, "");
    };
    
    const normalizedUrl = normalizeUrl(githubUrl);

    // 1. Find or create the repository in the database
    let repoId;
    const repoResult = await pool.query(
      "SELECT id FROM repositories WHERE github_url = $1",
      [normalizedUrl]
    );

    if (repoResult.rows.length > 0) {
      repoId = repoResult.rows[0].id;
    } else {
      const insertRepoResult = await pool.query(
        "INSERT INTO repositories (name, github_url) VALUES ($1, $2) RETURNING id",
        [repoName, normalizedUrl]
      );
      repoId = insertRepoResult.rows[0].id;
    }

    // 2. Log the webhook event
    await pool.query(
      "INSERT INTO webhook_events (repository_id, event_type, payload) VALUES ($1, $2, $3)",
      [repoId, eventType, JSON.stringify(payload)]
    );

    // 3. Create a pending build trace
    const buildResult = await pool.query(
      "INSERT INTO builds (repository_id, commit_hash, status) VALUES ($1, $2, 'PENDING') RETURNING id",
      [repoId, commitHash]
    );

    const buildId = buildResult.rows[0].id;

    // Add job to the queue
    await buildQueue.add("run-build", {
      buildId: buildId,
      repoUrl: normalizedUrl,
      commitHash: commitHash
    });

    // 4. Return 202 Accepted immediately with build info
    res.status(202).json({
      message: "Build triggered successfully",
      buildId: buildId,
      status: "PENDING",
    });
  } catch (error) {
    console.error("Webhook ingestion error:", error);
    res.status(500).json({ error: "Failed to process webhook event" });
  }
});

module.exports = router;
