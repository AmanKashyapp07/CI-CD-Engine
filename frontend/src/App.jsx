import { useState, useEffect, useCallback } from "react";

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

  // Status Badge Class Generator - Updated for modern Cyan/Emerald look
  const getStatusBadgeClass = (status) => {
    switch (status.toLowerCase()) {
      case "pending":
        return "bg-amber-500/10 text-amber-300 border border-amber-500/30 shadow-[0_0_10px_rgba(245,158,11,0.2)]";
      case "running":
        return "bg-cyan-500/10 text-cyan-300 border border-cyan-500/30 shadow-[0_0_10px_rgba(6,182,212,0.2)] animate-pulse";
      case "success":
        return "bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 shadow-[0_0_10px_rgba(16,185,129,0.2)]";
      case "failed":
        return "bg-rose-500/10 text-rose-300 border border-rose-500/30 shadow-[0_0_10px_rgba(244,63,94,0.2)]";
      default:
        return "bg-zinc-500/10 text-zinc-300 border border-zinc-500/30";
    }
  };

  // If not logged in, render the login landing page
  if (!token || !user) {
    return (
      <div className="min-h-screen bg-[#050505] text-zinc-100 flex flex-col items-center justify-center p-6 relative overflow-hidden font-sans selection:bg-cyan-500/30">
        {/* Ambient Background Glows */}
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-cyan-600/20 blur-[150px] rounded-full pointer-events-none"></div>
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-emerald-600/10 blur-[150px] rounded-full pointer-events-none"></div>

        <header className="w-full max-w-5xl flex justify-between items-center mb-16 z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-emerald-500 flex items-center justify-center shadow-lg shadow-cyan-500/25">
              <svg className="w-5 h-5 text-zinc-950" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <h1 className="text-xl font-bold tracking-tight text-white">
              Magnus<span className="text-cyan-400">CI</span>
            </h1>
          </div>
          <div className="flex items-center gap-3 bg-white/5 border border-white/10 px-4 py-2 rounded-full backdrop-blur-md">
            <span className="relative flex h-2.5 w-2.5">
              {dbStatus === "connected" && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>}
              <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${dbStatus === "connected" ? "bg-emerald-500" : "bg-rose-500"}`}></span>
            </span>
            <span className="text-sm font-medium text-zinc-300">
              System {dbStatus === "connected" ? "Operational" : "Offline"}
            </span>
          </div>
        </header>

        <main className="z-10 w-full max-w-lg flex flex-col items-center">
          <div className="text-center mb-10">
            <h2 className="text-4xl md:text-5xl font-extrabold mb-6 tracking-tight text-transparent bg-clip-text bg-gradient-to-br from-white via-zinc-200 to-zinc-500 pb-2">
              Ship Code <br/> at Light Speed.
            </h2>
            <p className="text-zinc-400 text-lg leading-relaxed max-w-md mx-auto">
              Orchestrate multi-threaded backgrounds, run containerized tests, and stream real-time execution logs with our headless engine.
            </p>
          </div>

          <div className="w-full bg-white/[0.03] border border-white/[0.08] p-8 rounded-3xl backdrop-blur-xl shadow-2xl shadow-black/50">
            <button
              onClick={initiateGithubLogin}
              className="group relative flex items-center justify-center gap-3 w-full py-4 rounded-xl font-semibold bg-white text-zinc-950 hover:bg-zinc-200 transition-all duration-300 active:scale-[0.98] overflow-hidden"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/0 via-cyan-500/10 to-cyan-500/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700"></div>
              <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
              </svg>
              Continue with GitHub
            </button>
            <p className="text-center text-xs text-zinc-500 mt-6 flex items-center justify-center gap-1.5">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              Secure enterprise-grade authentication
            </p>
          </div>
        </main>
        
        {/* Decorative Grid Overlay */}
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImdyaWQiIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTSAwIDEwIEwgNDAgMTAgTSAxMCAwIEwgMTAgNDAiIGZpbGw9Im5vbmUiIHN0cm9rZT0icmdiYSgyNTUsIDI1NSwgMjU1LCAwLjAyKSIgc3Ryb2tlLXdpZHRoPSIxIi8+PC9wYXR0ZXJuPjwvZGVmcz48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSJ1cmwoI2dyaWQpIi8+PC9zdmc+')] pointer-events-none opacity-40 z-0"></div>
      </div>
    );
  }

  // Render the authenticated developer dashboard
  return (
    <div className="min-h-screen bg-[#050505] text-zinc-200 font-sans selection:bg-cyan-500/30 relative overflow-hidden">
      {/* Ambient background styling */}
      <div className="fixed top-[-25%] right-[-10%] w-[60%] h-[60%] bg-cyan-600/10 blur-[180px] rounded-full pointer-events-none"></div>
      <div className="fixed bottom-[-20%] left-[-10%] w-[50%] h-[50%] bg-emerald-600/10 blur-[150px] rounded-full pointer-events-none"></div>

      {/* Header Navbar */}
      <header className="sticky top-0 z-50 border-b border-white/[0.08] bg-[#050505]/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-6 h-20 flex justify-between items-center">
          <div className="flex items-center gap-3">
             <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-emerald-500 flex items-center justify-center shadow-lg shadow-cyan-500/20">
              <svg className="w-4 h-4 text-zinc-950" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <h1 className="text-xl font-bold tracking-tight text-white hidden sm:block">
              Magnus<span className="text-cyan-400">CI</span>
            </h1>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="hidden md:flex items-center gap-2 bg-white/[0.03] border border-white/[0.08] px-3.5 py-1.5 rounded-full text-xs font-medium">
              <span className="relative flex h-2 w-2">
                {dbStatus === "connected" && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>}
                <span className={`relative inline-flex rounded-full h-2 w-2 ${dbStatus === "connected" ? "bg-emerald-500" : "bg-rose-500"}`}></span>
              </span>
              <span className="text-zinc-300">
                DB {dbStatus === "connected" ? "Online" : "Offline"}
              </span>
              {dbTime && <span className="text-zinc-500 ml-1 border-l border-white/10 pl-2">{new Date(dbTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
            </div>

            <div className="h-6 w-px bg-white/10 mx-1 hidden sm:block"></div>

            <div className="flex items-center gap-3 bg-white/[0.03] border border-white/[0.08] pl-2 pr-4 py-1.5 rounded-full hover:bg-white/[0.06] transition-colors cursor-pointer group">
              <img src={user.avatar_url} alt={user.username} className="w-7 h-7 rounded-full border border-white/10 group-hover:border-cyan-400 transition-colors" />
              <span className="text-sm font-medium text-zinc-200">{user.username}</span>
              <button onClick={handleLogout} className="text-zinc-500 hover:text-rose-400 transition-colors ml-2" title="Logout">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-10 grid grid-cols-1 lg:grid-cols-12 gap-8 relative z-10">
        
        {/* Left column - Connect Repo & List Repos */}
        <section className="lg:col-span-7 flex flex-col gap-8">
          
          {/* Register Card */}
          <div className="bg-white/[0.02] border border-white/[0.08] rounded-3xl p-8 backdrop-blur-xl shadow-xl">
            <div className="mb-8">
              <h2 className="text-2xl font-bold text-white mb-2 flex items-center gap-2">
                <svg className="w-5 h-5 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                </svg>
                Connect Repository
              </h2>
              <p className="text-zinc-400 text-sm">Configure a new GitHub source to trigger automated CI pipelines.</p>
            </div>
            
            <form onSubmit={handleRegisterRepo} className="flex flex-col gap-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="flex flex-col gap-2.5">
                  <label htmlFor="repo-name" className="text-xs font-semibold uppercase tracking-wider text-zinc-400 ml-1">Project Name</label>
                  <input
                    id="repo-name"
                    type="text"
                    value={repoName}
                    onChange={(e) => setRepoName(e.target.value)}
                    placeholder="my-awesome-app"
                    className="bg-[#09090b] border border-white/10 rounded-xl px-4 py-3.5 text-sm font-medium text-white placeholder:text-zinc-600 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50 transition-all shadow-inner"
                    required
                  />
                </div>
                <div className="flex flex-col gap-2.5">
                  <label htmlFor="repo-url" className="text-xs font-semibold uppercase tracking-wider text-zinc-400 ml-1">Repository URL</label>
                  <input
                    id="repo-url"
                    type="url"
                    value={repoUrl}
                    onChange={(e) => setRepoUrl(e.target.value)}
                    placeholder="https://github.com/user/repo"
                    className="bg-[#09090b] border border-white/10 rounded-xl px-4 py-3.5 text-sm font-medium text-white placeholder:text-zinc-600 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50 transition-all shadow-inner"
                    required
                  />
                </div>
              </div>
              
              <div className="flex items-center justify-between mt-2">
                <div className="flex-1 mr-4">
                  {error && <div className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 px-4 py-3 rounded-xl flex items-center gap-2"><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>{error}</div>}
                  {message && <div className="text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-4 py-3 rounded-xl flex items-center gap-2"><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>{message}</div>}
                </div>
                
                <button type="submit" disabled={isLoading} className="whitespace-nowrap px-8 py-3.5 rounded-xl font-semibold bg-cyan-600 text-white hover:bg-cyan-500 active:scale-[0.98] transition-all shadow-[0_0_20px_rgba(8,145,178,0.25)] hover:shadow-[0_0_25px_rgba(8,145,178,0.4)] disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none disabled:hover:bg-cyan-600 flex items-center gap-2">
                  {isLoading ? (
                    <><svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Hooking...</>
                  ) : "Create Hook"}
                </button>
              </div>
            </form>
          </div>

          {/* Repositories List Card */}
          <div className="bg-white/[0.02] border border-white/[0.08] rounded-3xl p-8 backdrop-blur-xl shadow-xl flex-1">
            <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
              <svg className="w-5 h-5 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
              Active Workspaces
            </h2>
            
            <div className="flex flex-col gap-3">
              {repos.length === 0 ? (
                <div className="text-center py-10 border border-dashed border-white/10 rounded-2xl bg-white/[0.01]">
                  <p className="text-zinc-500 text-sm">No repositories connected.</p>
                </div>
              ) : (
                repos.map((repo) => (
                  <div key={repo.id} className="group flex justify-between items-center p-4 bg-white/[0.02] border border-white/[0.05] rounded-2xl hover:border-cyan-500/30 hover:bg-white/[0.04] transition-all">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-full bg-cyan-500/10 flex items-center justify-center text-cyan-400 group-hover:bg-cyan-500 group-hover:text-zinc-950 transition-colors">
                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                          <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
                        </svg>
                      </div>
                      <div className="flex flex-col">
                        <span className="font-semibold text-zinc-200">{repo.name}</span>
                        <a href={repo.github_url} target="_blank" rel="noopener noreferrer" className="text-xs text-zinc-500 hover:text-cyan-400 transition-colors mt-0.5 max-w-[200px] sm:max-w-xs truncate">
                          {repo.github_url}
                        </a>
                      </div>
                    </div>
                    <div className="hidden sm:flex bg-[#09090b] px-3 py-1.5 rounded-lg border border-white/5">
                      <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">ID: {repo.id}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

        {/* Right column - Build executions logs */}
        <section className="lg:col-span-5 h-full">
          <div className="bg-white/[0.02] border border-white/[0.08] rounded-3xl p-8 backdrop-blur-xl shadow-xl h-full flex flex-col">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <svg className="w-5 h-5 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
                </svg>
                Execution Logs
              </h2>
              {builds.some(b => b.status.toLowerCase() === 'running') && (
                <span className="flex h-3 w-3 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-cyan-500"></span>
                </span>
              )}
            </div>
            
            <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-4">
              {builds.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-6 border border-dashed border-white/10 rounded-2xl bg-white/[0.01]">
                  <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mb-4">
                    <svg className="w-8 h-8 text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                    </svg>
                  </div>
                  <h3 className="text-white font-medium mb-1">Awaiting Commits</h3>
                  <p className="text-sm text-zinc-500">Push to a connected repository to trigger your first pipeline run.</p>
                </div>
              ) : (
                builds.map((build) => (
                  <div key={build.id} className="relative pl-6 before:content-[''] before:absolute before:left-[11px] before:top-[30px] before:bottom-[-20px] before:w-[2px] before:bg-white/[0.05] last:before:hidden">
                    {/* Timeline Dot */}
                    <div className="absolute left-0 top-3 w-6 h-6 rounded-full bg-[#09090b] border border-white/10 flex items-center justify-center z-10">
                      <div className={`w-2 h-2 rounded-full ${
                        build.status.toLowerCase() === 'success' ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]' :
                        build.status.toLowerCase() === 'running' ? 'bg-cyan-400 animate-pulse shadow-[0_0_8px_rgba(34,211,238,0.8)]' :
                        build.status.toLowerCase() === 'failed' ? 'bg-rose-400 shadow-[0_0_8px_rgba(251,113,133,0.8)]' :
                        'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]'
                      }`}></div>
                    </div>
                    
                    <div className="p-5 bg-white/[0.02] border border-white/[0.05] rounded-2xl hover:border-white/10 transition-colors">
                      <div className="flex justify-between items-start mb-3">
                        <span className="font-bold text-white text-base">{build.repository_name}</span>
                        <span className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-md ${getStatusBadgeClass(build.status)}`}>
                          {build.status}
                        </span>
                      </div>
                      <div className="flex flex-col gap-2 text-xs font-mono text-zinc-400">
                        <div className="flex justify-between items-center bg-[#09090b] px-3 py-2 rounded-lg border border-white/5">
                          <span>SHA</span> 
                          <code className="text-cyan-300 font-bold">{build.commit_hash?.substring(0, 7) || "N/A"}</code>
                        </div>
                        <div className="flex justify-between items-center px-1 mt-1">
                          <span className="text-zinc-500">Triggered</span> 
                          <span>{new Date(build.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'})}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      </main>

      {/* Internal Custom Scrollbar Styles for the builds list */}
      <style dangerouslySetInnerHTML={{__html: `
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: rgba(255, 255, 255, 0.02); border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.1); border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.2); }
      `}} />
    </div>
  );
}

export default App;