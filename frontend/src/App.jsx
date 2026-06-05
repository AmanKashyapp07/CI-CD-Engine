import { useState, useEffect } from "react";
import "./App.css";

const API_BASE = "http://localhost:5001/api";

function App() {
  const [dbStatus, setDbStatus] = useState("checking");
  const [dbTime, setDbTime] = useState("");
  const [repos, setRepos] = useState([]);
  const [builds, setBuilds] = useState([]);
  const [repoName, setRepoName] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const checkHealth = async () => {
    try {
      const res = await fetch(`${API_BASE}/health`);
      const data = await res.json();
      if (data.status === "healthy") {
        setDbStatus("connected");
        setDbTime(data.time);
      } else {
        setDbStatus("disconnected");
      }
    } catch (err) {
      setDbStatus("disconnected");
    }
  };

  const fetchRepos = async () => {
    try {
      const res = await fetch(`${API_BASE}/repositories`);
      const data = await res.json();
      if (Array.isArray(data)) {
        setRepos(data);
      }
    } catch (err) {
      console.error("Failed to fetch repositories:", err);
    }
  };

  const fetchBuilds = async () => {
    try {
      const res = await fetch(`${API_BASE}/builds`);
      const data = await res.json();
      if (Array.isArray(data)) {
        setBuilds(data);
      }
    } catch (err) {
      console.error("Failed to fetch builds:", err);
    }
  };

  useEffect(() => {
    checkHealth();
    fetchRepos();
    fetchBuilds();

    const interval = setInterval(() => {
      checkHealth();
      fetchBuilds();
    }, 10000);

    return () => clearInterval(interval);
  }, []);

  const handleRegisterRepo = async (e) => {
    e.preventDefault();
    if (!repoName || !repoUrl) {
      setError("Please fill out all fields.");
      return;
    }

    setIsLoading(true);
    setError("");
    setMessage("");

    try {
      const res = await fetch(`${API_BASE}/repositories`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: repoName, github_url: repoUrl }),
      });

      const data = await res.json();
      if (res.ok) {
        setMessage("Repository registered successfully!");
        setRepoName("");
        setRepoUrl("");
        fetchRepos();
      } else {
        setError(data.error || "Failed to register repository.");
      }
    } catch (err) {
      setError("Server connection failed.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="app-container">
      <header className="dashboard-header">
        <div className="brand">
          <div className="logo-spark">⚡</div>
          <h1>Headless CI/CD Engine</h1>
        </div>
        <div className="status-badge-container">
          <span className={`status-dot ${dbStatus}`}></span>
          <span className="status-text">
            Database Status:{" "}
            <strong>
              {dbStatus === "connected"
                ? "Connected"
                : dbStatus === "disconnected"
                ? "Disconnected"
                : "Checking..."}
            </strong>
          </span>
          {dbTime && <span className="db-time">({new Date(dbTime).toLocaleTimeString()})</span>}
        </div>
      </header>

      <main className="dashboard-grid">
        {/* Left column - Connect Repo & List Repos */}
        <section className="dashboard-card form-section">
          <h2>Register Repository</h2>
          <p className="card-subtitle">Hook up a new GitHub repository for automated headless builds.</p>
          <form onSubmit={handleRegisterRepo} className="modern-form">
            <div className="form-group">
              <label htmlFor="repo-name">Repository Name</label>
              <input
                id="repo-name"
                type="text"
                value={repoName}
                onChange={(e) => setRepoName(e.target.value)}
                placeholder="my-awesome-app"
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="repo-url">GitHub Repository URL</label>
              <input
                id="repo-url"
                type="url"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                placeholder="https://github.com/username/my-awesome-app"
                required
              />
            </div>
            {error && <div className="error-message">{error}</div>}
            {message && <div className="success-message">{message}</div>}
            <button type="submit" disabled={isLoading} className="btn-primary">
              {isLoading ? "Registering..." : "Connect Repository"}
            </button>
          </form>

          <hr className="divider" />

          <h2>Registered Repositories</h2>
          <div className="repo-list">
            {repos.length === 0 ? (
              <p className="empty-text">No repositories connected yet.</p>
            ) : (
              repos.map((repo) => (
                <div key={repo.id} className="repo-item">
                  <div className="repo-info">
                    <span className="repo-name">{repo.name}</span>
                    <a
                      href={repo.github_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="repo-link"
                    >
                      {repo.github_url}
                    </a>
                  </div>
                  <span className="repo-id">ID: {repo.id}</span>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Right column - Build executions logs */}
        <section className="dashboard-card builds-section">
          <h2>Build Executions</h2>
          <p className="card-subtitle">Real-time status updates and execution tracking.</p>
          <div className="builds-list">
            {builds.length === 0 ? (
              <div className="empty-state">
                <span className="empty-icon">☕</span>
                <p>No builds triggered yet. Send a webhook to execute builds!</p>
              </div>
            ) : (
              builds.map((build) => (
                <div key={build.id} className="build-item">
                  <div className="build-header">
                    <span className="build-repo">{build.repository_name}</span>
                    <span className={`build-status-badge ${build.status.toLowerCase()}`}>
                      {build.status}
                    </span>
                  </div>
                  <div className="build-details">
                    <div>
                      <strong>Commit:</strong> <code>{build.commit_hash || "N/A"}</code>
                    </div>
                    <div>
                      <strong>Triggered:</strong> {new Date(build.created_at).toLocaleString()}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
