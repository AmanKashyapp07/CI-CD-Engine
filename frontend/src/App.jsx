import { useState, useEffect, useCallback } from "react";
import "./App.css";

const API_BASE = "http://localhost:5001/api";

function App() {
  const [token, setToken] = useState(localStorage.getItem("token") || "");
  const [user, setUser] = useState(null);
  const [dbStatus, setDbStatus] = useState("checking");
  const [dbTime, setDbTime] = useState("");
  const [repos, setRepos] = useState([]);
  const [builds, setBuilds] = useState([]);
  const [repoName, setRepoName] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  // Check URL parameters for a new token redirect from GitHub callback
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const redirectToken = params.get("token");
    if (redirectToken) {
      localStorage.setItem("token", redirectToken);
      setToken(redirectToken);
      // Clean up URL query parameters
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  const handleLogout = () => {
    localStorage.removeItem("token");
    setToken("");
    setUser(null);
    setRepos([]);
    setBuilds([]);
  };

  const fetchWithAuth = useCallback(
    async (url, options = {}) => {
      const headers = {
        ...options.headers,
        Authorization: `Bearer ${token}`,
      };
      const res = await fetch(url, { ...options, headers });
      if (res.status === 401 || res.status === 403) {
        handleLogout();
        throw new Error("Session expired. Please login again.");
      }
      return res;
    },
    [token]
  );

  const checkHealth = useCallback(async () => {
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
  }, []);

  const fetchUser = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetchWithAuth(`${API_BASE}/auth/me`);
      const data = await res.json();
      if (res.ok) {
        setUser(data);
      } else {
        handleLogout();
      }
    } catch (err) {
      console.error(err);
      handleLogout();
    }
  }, [token, fetchWithAuth]);

  const fetchRepos = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetchWithAuth(`${API_BASE}/repositories`);
      const data = await res.json();
      if (Array.isArray(data)) {
        setRepos(data);
      }
    } catch (err) {
      console.error("Failed to fetch repositories:", err);
    }
  }, [token, fetchWithAuth]);

  const fetchBuilds = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetchWithAuth(`${API_BASE}/builds`);
      const data = await res.json();
      if (Array.isArray(data)) {
        setBuilds(data);
      }
    } catch (err) {
      console.error("Failed to fetch builds:", err);
    }
  }, [token, fetchWithAuth]);

  // Load user data and run checks when token changes
  useEffect(() => {
    checkHealth();
    if (token) {
      fetchUser();
      fetchRepos();
      fetchBuilds();
    }
  }, [token, checkHealth, fetchUser, fetchRepos, fetchBuilds]);

  // Regular intervals
  useEffect(() => {
    const interval = setInterval(() => {
      checkHealth();
      if (token) {
        fetchBuilds();
      }
    }, 10000);

    return () => clearInterval(interval);
  }, [token, checkHealth, fetchBuilds]);

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
      const res = await fetchWithAuth(`${API_BASE}/repositories`, {
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

  const initiateGithubLogin = () => {
    window.location.href = `${API_BASE}/auth/github`;
  };

  // If not logged in, render the login landing page
  if (!token || !user) {
    return (
      <div className="app-container login-layout">
        <header className="dashboard-header">
          <div className="brand">
            <div className="logo-spark">⚡</div>
            <h1>Headless CI/CD Engine</h1>
          </div>
          <div className="status-badge-container">
            <span className={`status-dot ${dbStatus}`}></span>
            <span className="status-text">
              Database Status: <strong>{dbStatus === "connected" ? "Connected" : "Disconnected"}</strong>
            </span>
          </div>
        </header>

        <main className="login-panel">
          <h2>Continuous Integration Sandbox</h2>
          <p>
            An isolated environment to programmatically orchestrate multi-threaded background build queues,
            run container test-suites, and multiplex output streams.
          </p>
          <button onClick={initiateGithubLogin} className="btn-primary btn-github">
            <span className="github-icon-svg">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
              </svg>
            </span>
            Sign in with GitHub
          </button>
        </main>
      </div>
    );
  }

  // Render the authenticated developer dashboard
  return (
    <div className="app-container">
      <header className="dashboard-header">
        <div className="brand">
          <div className="logo-spark">⚡</div>
          <h1>Headless CI/CD Engine</h1>
        </div>
        <div className="header-right">
          <div className="user-profile">
            <img src={user.avatar_url} alt={user.username} className="user-avatar" />
            <span className="username">{user.username}</span>
            <button onClick={handleLogout} className="btn-logout">
              Logout
            </button>
          </div>
          <div className="status-badge-container">
            <span className={`status-dot ${dbStatus}`}></span>
            <span className="status-text">
              Database: <strong>{dbStatus === "connected" ? "Connected" : "Disconnected"}</strong>
            </span>
            {dbTime && <span className="db-time">({new Date(dbTime).toLocaleTimeString()})</span>}
          </div>
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
