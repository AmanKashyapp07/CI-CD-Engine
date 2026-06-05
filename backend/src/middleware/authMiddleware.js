const jwt = require("jsonwebtoken");
const pool = require("../db");

const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "Access token required" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "aman123");
    
    // Check database to ensure user still exists
    const userResult = await pool.query("SELECT * FROM users WHERE id = $1", [decoded.id]);
    if (userResult.rows.length === 0) {
      return res.status(403).json({ error: "User no longer exists" });
    }

    req.user = userResult.rows[0];
    next();
  } catch (err) {
    console.error("JWT Verification error:", err.message);
    return res.status(403).json({ error: "Invalid or expired token" });
  }
};

module.exports = authenticateToken;
