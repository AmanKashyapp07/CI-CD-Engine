const express = require("express");
const pool = require("../db");
const authenticateToken = require("../middleware/authMiddleware");

const router = express.Router();

// Get all repositories associated with the logged-in user
router.get("/", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM repositories WHERE user_id = $1 ORDER BY created_at DESC",
      [req.user.id]
    );
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

const normalizeUrl = (url) => {
  if (!url) return url;
  return url.trim().toLowerCase().replace(/\.git$/, "").replace(/\/$/, "");
};

// Register a repository for the logged-in user
router.post("/", authenticateToken, async (req, res) => {
  const { name, github_url } = req.body;
  if (!name || !github_url) {
    return res.status(400).json({ error: "name and github_url are required" });
  }
  const normalizedUrl = normalizeUrl(github_url);
  try {
    const result = await pool.query(
      "INSERT INTO repositories (name, github_url, user_id) VALUES ($1, $2, $3) RETURNING *",
      [name, normalizedUrl, req.user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
