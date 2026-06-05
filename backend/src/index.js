const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const pool = require("./db");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5001;

app.use(cors());
app.use(express.json());

// Database connection health check endpoint
app.get("/api/health", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.json({
      status: "healthy",
      database: "connected",
      time: result.rows[0].now,
    });
  } catch (error) {
    console.error("Database connection error:", error);
    res.status(500).json({
      status: "unhealthy",
      database: "disconnected",
      error: error.message,
    });
  }
});

// Basic route to get all repositories
app.get("/api/repositories", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM repositories ORDER BY created_at DESC");
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// Basic route to register a repository
app.post("/api/repositories", async (req, res) => {
  const { name, github_url } = req.body;
  if (!name || !github_url) {
    return res.status(400).json({ error: "name and github_url are required" });
  }
  try {
    const result = await pool.query(
      "INSERT INTO repositories (name, github_url) VALUES ($1, $2) RETURNING *",
      [name, github_url]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// Basic route to get all builds
app.get("/api/builds", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT b.*, r.name as repository_name FROM builds b JOIN repositories r ON b.repository_id = r.id ORDER BY b.created_at DESC"
    );
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Backend server is running on http://localhost:${PORT}`);
});
