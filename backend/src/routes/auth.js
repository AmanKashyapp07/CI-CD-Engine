const express = require("express");
const jwt = require("jsonwebtoken");
const pool = require("../db");
const authenticateToken = require("../middleware/authMiddleware");

const router = express.Router();

const CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
const JWT_SECRET = process.env.JWT_SECRET || "aman123";
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

// Route to initiate GitHub login
router.get("/github", (req, res) => {
  const githubAuthUrl = `https://github.com/login/oauth/authorize?client_id=${CLIENT_ID}&scope=read:user`;
  res.redirect(githubAuthUrl);
});

// GitHub callback handler
router.get("/github/callback", async (req, res) => {
  const { code } = req.query;

  if (!code) {
    return res.status(400).json({ error: "Missing OAuth authorization code" });
  }

  try {
    // 1. Exchange OAuth code for Access Token
    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
      }),
    });

    const tokenData = await tokenResponse.json();

    if (tokenData.error) {
      console.error("GitHub access token exchange error:", tokenData.error_description);
      return res.status(400).json({ error: tokenData.error_description });
    }

    const accessToken = tokenData.access_token;

    // 2. Retrieve user details using the access token
    const userResponse = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `token ${accessToken}`,
        "User-Agent": "CI-CD-Engine-Backend",
      },
    });

    const userData = await userResponse.json();

    const githubId = String(userData.id);
    const username = userData.login;
    const avatarUrl = userData.avatar_url;

    // 3. Find or create user in PostgreSQL
    let userId;
    const existingUser = await pool.query("SELECT id FROM users WHERE github_id = $1", [githubId]);

    if (existingUser.rows.length > 0) {
      userId = existingUser.rows[0].id;
      // Optionally update username or avatar if changed
      await pool.query(
        "UPDATE users SET username = $1, avatar_url = $2 WHERE id = $3",
        [username, avatarUrl, userId]
      );
    } else {
      const newUser = await pool.query(
        "INSERT INTO users (github_id, username, avatar_url) VALUES ($1, $2, $3) RETURNING id",
        [githubId, username, avatarUrl]
      );
      userId = newUser.rows[0].id;
    }

    // 4. Generate JWT Session Token
    const jwtToken = jwt.sign({ id: userId, username }, JWT_SECRET, {
      expiresIn: "7d",
    });

    // 5. Redirect back to frontend dashboard with token
    res.redirect(`${FRONTEND_URL}?token=${jwtToken}`);
  } catch (error) {
    console.error("OAuth error:", error);
    res.status(500).json({ error: "Authentication failed" });
  }
});

// Get currently logged-in user profile
router.get("/me", authenticateToken, (req, res) => {
  res.json({
    id: req.user.id,
    username: req.user.username,
    avatar_url: req.user.avatar_url,
  });
});

module.exports = router;
