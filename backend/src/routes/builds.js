const express = require("express");
const pool = require("../db");
const authenticateToken = require("../middleware/authMiddleware");

const router = express.Router();

// Get all builds associated with the logged-in user's repositories
router.get("/", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT b.*, r.name as repository_name FROM builds b JOIN repositories r ON b.repository_id = r.id WHERE r.user_id = $1 ORDER BY b.created_at DESC",
      [req.user.id]
    );
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
