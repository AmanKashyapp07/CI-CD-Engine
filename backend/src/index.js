const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
dotenv.config();

const pool = require("./db");

const healthRoutes = require("./routes/health");
const repositoryRoutes = require("./routes/repositories");
const buildRoutes = require("./routes/builds");
const webhookRoutes = require("./routes/webhooks");
const authRoutes = require("./routes/auth");

const app = express();
const PORT = process.env.PORT || 5001;

app.use(cors());

// Configure JSON parser to extract rawBody for signature verification
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);

// Routes
app.use("/api/health", healthRoutes);
app.use("/api/repositories", repositoryRoutes);
app.use("/api/builds", buildRoutes);
app.use("/api/webhooks", webhookRoutes);
app.use("/api/auth", authRoutes);

app.listen(PORT, () => {
  console.log(`Backend server is running on http://localhost:${PORT}`);
  //write database connection health check log
  pool.query("SELECT NOW()")
    .then(result => {
      console.log(`Database connection successful. Current time: ${result.rows[0].now}`);
    })
    .catch(error => {
      console.error("Database connection failed:", error);
    });
});
