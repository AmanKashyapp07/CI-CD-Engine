import { useState, useEffect, useCallback, useRef } from "react";

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

  const [selectedBuild, setSelectedBuild] = useState(null);
  const [selectedRepo, setSelectedRepo] = useState(null);
  const [logs, setLogs] = useState("");
  const [isLogsLoading, setIsLogsLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const logsEndRef = useRef(null);

  // Helper for stripping ANSI and cleaning raw TTY output (spinners, carriage returns, Jest noise)
  const stripAnsi = (str) => {
    if (!str) return "";
    
    // 1. Strip ANSI escape codes
    let cleaned = str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
    
    // 2. Remove npm spinner symbols (like \|/-\|/-\|/-)
    cleaned = cleaned.replace(/[\\|/-\s]{4,}/g, (match) => {
      if (/^[\\|/-\s]+$/.test(match) && (match.includes('\\') || match.includes('/') || match.includes('|'))) {
        return ' ';
      }
      return match;
    });

    // 3. Process carriage returns (\r) and filter out interactive Jest Tty updates (like "RUNS  ...")
    const lines = cleaned.split('\n');
    const processedLines = [];

    for (let line of lines) {
      let finalLine = line;
      if (line.includes('\r')) {
        const segments = line.split('\r');
        for (const segment of segments) {
          if (segment.trim().length > 0) {
            finalLine = segment;
          }
        }
      }
      
      const trimmed = finalLine.trim();
      // Skip interactive runs/spinners
      if (trimmed === "RUNS  ..." || trimmed === "RUNS" || trimmed === "\\" || trimmed === "/" || trimmed === "|" || trimmed === "-") {
        continue;
      }
      processedLines.push(finalLine);
    }

    // Deduplicate empty lines
    return processedLines.filter((line, index, arr) => {
      if (line.trim() === "" && index > 0 && arr[index - 1].trim() === "") {
        return false;
      }
      return true;
    }).join('\n');
  };

  const handleCopyLogs = () => {
    navigator.clipboard.writeText(stripAnsi(logs));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadLogs = () => {
    const cleanLogs = stripAnsi(logs);
    const blob = new Blob([cleanLogs], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `magnus-build-${selectedBuild?.commit_hash?.substring(0, 7) || "report"}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

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

  const fetchLogs = useCallback(async (buildId, silent = false) => {
    if (!token) return;
    if (!silent) setIsLogsLoading(true);
    try {
      const res = await fetchWithAuth(`${API_BASE}/builds/${buildId}/logs`);
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs);
        if (data.build) {
          setSelectedBuild(prev => prev ? ({ ...prev, ...data.build }) : null);
        }
      }
    } catch (err) {
      console.error("Failed to fetch logs:", err);
    } finally {
      if (!silent) setIsLogsLoading(false);
    }
  }, [token, fetchWithAuth]);

  useEffect(() => {
    if (!selectedBuild) {
      setLogs("");
      return;
    }
    fetchLogs(selectedBuild.id);
    const isLive = ["running", "pending"].includes(selectedBuild.status?.toLowerCase());
    if (!isLive) return;
    const interval = setInterval(() => {
      fetchBuilds();
      fetchLogs(selectedBuild.id, true);
    }, 2000);
    return () => clearInterval(interval);
  }, [selectedBuild, fetchLogs, fetchBuilds]);

  useEffect(() => {
    if (selectedBuild) {
      const updated = builds.find(b => b.id === selectedBuild.id);
      if (updated && updated.status !== selectedBuild.status) {
        setSelectedBuild(updated);
      }
    }
  }, [builds, selectedBuild]);

  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, selectedBuild]);

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
    switch (status?.toLowerCase()) {
      case "pending":
        return "bg-amber-500/10 text-amber-400 border border-amber-500/30 shadow-[0_0_10px_rgba(245,158,11,0.2)]";
      case "running":
        return "bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 shadow-[0_0_10px_rgba(6,182,212,0.2)] animate-pulse";
      case "success":
        return "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 shadow-[0_0_10px_rgba(16,185,129,0.2)]";
      case "failed":
        return "bg-rose-500/10 text-rose-400 border border-rose-500/30 shadow-[0_0_10px_rgba(244,63,94,0.2)]";
      default:
        return "bg-zinc-500/10 text-zinc-300 border border-zinc-500/30";
    }
  };

  // Filter builds based on selected repository
  const filteredBuilds = selectedRepo
    ? builds.filter(
        (b) =>
          b.repository_id === selectedRepo.id ||
          b.repository_name?.toLowerCase() === selectedRepo.name?.toLowerCase()
      )
    : builds;

  // Derived Dashboard Statistics
  const activeRunners = builds.filter(b => b.status?.toLowerCase() === 'running').length;
  const completedBuilds = builds.filter(b => ['success', 'failed'].includes(b.status?.toLowerCase()));
  const successCount = completedBuilds.filter(b => b.status?.toLowerCase() === 'success').length;
  const successRate = completedBuilds.length > 0 ? Math.round((successCount / completedBuilds.length) * 100) : 0;

  // If not logged in, render the login landing page
  if (!token || !user) {
    return (
      <div className="min-h-screen bg-[#050505] text-zinc-100 flex flex-col relative overflow-hidden font-sans selection:bg-cyan-500/30">
        {/* Intense Ambient Background Glows */}
        <div className="absolute top-[-10%] left-[-10%] w-[60%] h-[60%] bg-cyan-600/20 blur-[180px] rounded-full pointer-events-none mix-blend-screen"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-emerald-600/15 blur-[150px] rounded-full pointer-events-none mix-blend-screen"></div>

        {/* Top Navigation */}
        <header className="w-full max-w-7xl mx-auto flex justify-between items-center p-6 z-20 relative">
          <div className="flex items-center gap-3 group cursor-default">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-emerald-500 flex items-center justify-center shadow-lg shadow-cyan-500/25 group-hover:shadow-cyan-500/40 transition-shadow duration-500">
              <svg className="w-5 h-5 text-zinc-950" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>

            <h1 className="text-xl font-bold tracking-tight text-white">
              Magnus<span className="text-cyan-400 drop-shadow-[0_0_8px_rgba(34,211,238,0.5)]">CI</span>
            </h1>
          </div>
          <div className="flex items-center gap-3 bg-[#0a0a0c]/80 border border-white/[0.08] px-4 py-2 rounded-full backdrop-blur-md shadow-xl">
            <span className="relative flex h-2.5 w-2.5">
              {dbStatus === "connected" && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>}
              <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${dbStatus === "connected" ? "bg-emerald-500" : "bg-rose-500"}`}></span>
            </span>
            <span className="text-sm font-medium text-zinc-300">
              Engine Status: <span className={dbStatus === "connected" ? "text-emerald-400" : "text-rose-400"}>{dbStatus === "connected" ? "Online" : "Offline"}</span>
            </span>
          </div>
        </header>

        {/* Hero Section */}
        <main className="flex-1 flex flex-col justify-center items-center p-6 z-10 w-full max-w-7xl mx-auto">
          {/* Glowing Top Border Line */}
          <div className="w-full max-w-5xl h-px bg-gradient-to-r from-transparent via-cyan-500/50 to-transparent mb-12 opacity-50"></div>

          <div className="w-full max-w-5xl bg-[#0a0a0c]/60 border border-white/[0.08] rounded-[2.5rem] backdrop-blur-2xl shadow-2xl shadow-black/80 overflow-hidden relative">
            
            {/* Shimmer Effect */}
            <div className="absolute inset-0 bg-gradient-to-tr from-white/[0.01] via-white/[0.05] to-transparent opacity-50 pointer-events-none"></div>

            <div className="grid grid-cols-1 lg:grid-cols-2">
              
              {/* Left Column: Copy & Auth */}
              <div className="p-10 lg:p-14 flex flex-col justify-center relative z-10">
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-xs font-semibold mb-6 w-fit shadow-[0_0_15px_rgba(6,182,212,0.15)]">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500"></span>
                  </span>
                  v2.0 Automation Engine
                </div>
                
                <h2 className="text-4xl md:text-5xl lg:text-6xl font-extrabold mb-6 tracking-tight text-white leading-[1.1]">
                  Ship Code <br/>
                  <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-emerald-400">At Light Speed.</span>
                </h2>
                
                <p className="text-zinc-400 text-base md:text-lg leading-relaxed mb-10 max-w-md">
                  Orchestrate multi-threaded background queues, run isolated containerized test-suites, and multiplex output streams instantly.
                </p>

                <div className="flex flex-col gap-4 max-w-md">
                  <button
                    onClick={initiateGithubLogin}
                    className="group relative flex items-center justify-center gap-3 w-full py-4 rounded-2xl font-bold bg-white text-zinc-950 hover:bg-zinc-200 transition-all duration-300 active:scale-[0.98] shadow-[0_0_30px_rgba(255,255,255,0.1)] hover:shadow-[0_0_40px_rgba(255,255,255,0.2)] overflow-hidden"
                  >
                    <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/0 via-cyan-500/10 to-cyan-500/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700 ease-in-out"></div>
                    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" className="relative z-10">
                      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                    </svg>
                    <span className="relative z-10">Authenticate with GitHub</span>
                  </button>
                  <p className="text-center text-xs text-zinc-500 flex items-center justify-center gap-1.5 mt-2">
                    <svg className="w-4 h-4 text-emerald-500/70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                    Enterprise-grade OAuth 2.0 Handshake
                  </p>
                </div>
              </div>

              {/* Right Column: Mock Terminal Interface */}
              <div className="hidden lg:flex flex-col bg-[#050505]/80 border-l border-white/[0.05] p-6 relative">
                {/* Terminal Window */}
                <div className="w-full h-full rounded-2xl bg-[#020202] border border-white/[0.08] shadow-2xl flex flex-col font-mono text-xs overflow-hidden relative z-10">
                  <div className="h-10 bg-white/[0.03] border-b border-white/[0.05] flex items-center px-4 gap-2 select-none">
                    <div className="w-2.5 h-2.5 rounded-full bg-rose-500/70 shadow-[0_0_5px_rgba(244,63,94,0.4)]"></div>
                    <div className="w-2.5 h-2.5 rounded-full bg-amber-500/70 shadow-[0_0_5px_rgba(245,158,11,0.4)]"></div>
                    <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/70 shadow-[0_0_5px_rgba(16,185,129,0.4)]"></div>
                    <span className="ml-2 text-zinc-500 tracking-wider">Magnus-daemon@edge-node</span>
                  </div>
                  
                  <div className="p-5 flex flex-col gap-3.5 flex-1 relative">
                    <div className="flex gap-2">
                      <span className="text-cyan-500">❯</span> 
                      <span className="text-zinc-300">Magnus pipeline trigger --repo backend-api --sha 8f7b2c9</span>
                    </div>
                    
                    <div className="flex flex-col gap-1.5 pl-4 border-l border-white/[0.05] ml-1 mt-1">
                      <div className="text-zinc-500">00:00.01 <span className="text-cyan-400">[INFO]</span> Resolving build dependencies...</div>
                      <div className="text-zinc-500">00:00.45 <span className="text-cyan-400">[INFO]</span> Spawning isolated container runner...</div>
                      <div className="text-zinc-500">00:01.20 <span className="text-cyan-400">[INFO]</span> Cloning repository @ 8f7b2c9...</div>
                      <div className="text-zinc-500">00:04.12 <span className="text-cyan-400">[INFO]</span> Executing test suites (jest, eslint)...</div>
                      <div className="text-zinc-500">00:09.55 <span className="text-emerald-400">[PASS]</span> 142 tests completed successfully.</div>
                      <div className="text-zinc-500">00:10.02 <span className="text-cyan-400">[INFO]</span> Uploading artifacts to registry...</div>
                      <div className="text-zinc-500">00:12.44 <span className="text-emerald-400 font-bold bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20 inline-block mt-1">[SUCCESS] Pipeline completed in 12.4s</span></div>
                    </div>

                    <div className="flex gap-2 mt-2 items-center">
                      <span className="text-cyan-500">❯</span> 
                      <span className="animate-pulse w-2 h-4 bg-cyan-400 inline-block shadow-[0_0_8px_rgba(34,211,238,0.8)]"></span>
                    </div>
                    
                    {/* Bottom fade out inside terminal */}
                    <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-[#020202] to-transparent pointer-events-none"></div>
                  </div>
                </div>

                {/* Decorative floating dots behind terminal */}
                <div className="absolute top-10 right-10 w-2 h-2 rounded-full bg-cyan-500/50 blur-[2px] animate-pulse"></div>
                <div className="absolute bottom-20 left-4 w-1.5 h-1.5 rounded-full bg-emerald-500/50 blur-[1px] animate-bounce"></div>
              </div>

            </div>
          </div>
          
          {/* Bottom Glowing Line */}
          <div className="w-full max-w-5xl h-px bg-gradient-to-r from-transparent via-cyan-500/30 to-transparent mt-12 opacity-30"></div>
        </main>
        
        {/* Deep Background Grid Overlay */}
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImdyaWQiIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTSAwIDEwIEwgNDAgMTAgTSAxMCAwIEwgMTAgNDAiIGZpbGw9Im5vbmUiIHN0cm9rZT0icmdiYSgyNTUsIDI1NSwgMjU1LCAwLjAyKSIgc3Ryb2tlLXdpZHRoPSIxIi8+PC9wYXR0ZXJuPjwvZGVmcz48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSJ1cmwoI2dyaWQpIi8+PC9zdmc+')] pointer-events-none opacity-50 z-0 mask-image-[radial-gradient(ellipse_at_center,black_40%,transparent_80%)]" style={{ maskImage: 'radial-gradient(ellipse at center, black 40%, transparent 80%)', WebkitMaskImage: 'radial-gradient(ellipse at center, black 40%, transparent 80%)' }}></div>
      </div>
    );
  }

  // Render the authenticated developer dashboard
  return (
    <div className="min-h-screen bg-[#050505] text-zinc-200 font-sans selection:bg-cyan-500/30 relative overflow-hidden flex flex-col">
      {/* Ambient background styling */}
      <div className="fixed top-[-25%] right-[-10%] w-[60%] h-[60%] bg-cyan-600/10 blur-[180px] rounded-full pointer-events-none"></div>
      <div className="fixed bottom-[-20%] left-[-10%] w-[50%] h-[50%] bg-emerald-600/10 blur-[150px] rounded-full pointer-events-none"></div>

      {/* Header Navbar */}
      <header className="sticky top-0 z-50 border-b border-white/[0.08] bg-[#050505]/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-6 h-16 flex justify-between items-center">
          <div className="flex items-center gap-3">
             <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-cyan-500 to-emerald-500 flex items-center justify-center shadow-lg shadow-cyan-500/20">
              <svg className="w-3.5 h-3.5 text-zinc-950" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <h1 className="text-lg font-bold tracking-tight text-white hidden sm:block">
              Magnus<span className="text-cyan-400">CI</span>
            </h1>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="hidden md:flex items-center gap-2 bg-white/[0.03] border border-white/[0.08] px-3 py-1 rounded-full text-xs font-medium">
              <span className="relative flex h-2 w-2">
                {dbStatus === "connected" && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>}
                <span className={`relative inline-flex rounded-full h-2 w-2 ${dbStatus === "connected" ? "bg-emerald-500" : "bg-rose-500"}`}></span>
              </span>
              <span className="text-zinc-300">
                DB {dbStatus === "connected" ? "Online" : "Offline"}
              </span>
            </div>

            <div className="h-5 w-px bg-white/10 mx-1 hidden sm:block"></div>

            <div className="flex items-center gap-3 bg-white/[0.03] border border-white/[0.08] pl-1.5 pr-3 py-1 rounded-full hover:bg-white/[0.06] transition-colors cursor-pointer group">
              <img src={user.avatar_url} alt={user.username} className="w-6 h-6 rounded-full border border-white/10 group-hover:border-cyan-400 transition-colors" />
              <span className="text-xs font-medium text-zinc-200">{user.username}</span>
              <button onClick={handleLogout} className="text-zinc-500 hover:text-rose-400 transition-colors ml-1" title="Logout">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto w-full px-6 py-8 flex-1 flex flex-col relative z-10">
        
        {/* Top Metrics Row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <div className="bg-white/[0.02] border border-white/[0.08] p-5 rounded-2xl backdrop-blur-xl flex flex-col gap-1">
            <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider flex items-center gap-2">
               <svg className="w-4 h-4 text-cyan-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
               Workspaces
            </span>
            <div className="text-3xl font-bold text-white mt-1">{repos.length}</div>
          </div>
          
          <div className="bg-white/[0.02] border border-white/[0.08] p-5 rounded-2xl backdrop-blur-xl flex flex-col gap-1">
            <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider flex items-center gap-2">
               <svg className="w-4 h-4 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
               Total Executions
            </span>
            <div className="text-3xl font-bold text-white mt-1">{builds.length}</div>
          </div>

          <div className="bg-white/[0.02] border border-white/[0.08] p-5 rounded-2xl backdrop-blur-xl flex flex-col gap-1 relative overflow-hidden">
             {activeRunners > 0 && <div className="absolute inset-0 bg-cyan-500/5 animate-pulse"></div>}
            <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider flex items-center gap-2 relative z-10">
               <svg className={`w-4 h-4 ${activeRunners > 0 ? 'text-cyan-400' : 'text-zinc-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
               Active Runners
            </span>
            <div className="text-3xl font-bold text-white mt-1 flex items-baseline gap-2 relative z-10">
              {activeRunners}
              {activeRunners > 0 && <span className="text-xs text-cyan-400 font-medium bg-cyan-500/10 px-2 py-0.5 rounded-full border border-cyan-500/20">Running</span>}
            </div>
          </div>

          <div className="bg-white/[0.02] border border-white/[0.08] p-5 rounded-2xl backdrop-blur-xl flex flex-col gap-1">
            <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider flex items-center gap-2">
               <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
               Success Rate
            </span>
            <div className="text-3xl font-bold text-white mt-1 flex items-baseline gap-1">
              {successRate}<span className="text-lg text-zinc-500">%</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 flex-1">
          {/* Left column - Connect Repo & List Repos */}
          <section className="lg:col-span-7 flex flex-col gap-6">
            
            {/* Register Card */}
            <div className="bg-white/[0.02] border border-white/[0.08] rounded-3xl p-6 backdrop-blur-xl shadow-xl relative overflow-hidden">
              <div className="absolute top-0 right-0 p-32 bg-cyan-500/5 blur-[100px] rounded-full pointer-events-none"></div>
              
              <div className="mb-6 relative z-10">
                <h2 className="text-lg font-bold text-white mb-1 flex items-center gap-2">
                  <svg className="w-5 h-5 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                  </svg>
                  Connect Repository
                </h2>
                <p className="text-zinc-400 text-sm">Register a new GitHub webhook origin target.</p>
              </div>
              
              <form onSubmit={handleRegisterRepo} className="flex flex-col gap-5 relative z-10">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div className="flex flex-col gap-2">
                    <label htmlFor="repo-name" className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Project Name</label>
                    <input
                      id="repo-name"
                      type="text"
                      value={repoName}
                      onChange={(e) => setRepoName(e.target.value)}
                      placeholder="Magnus-core-api"
                      className="bg-[#09090b] border border-white/10 rounded-xl px-4 py-3 text-sm font-medium text-white placeholder:text-zinc-600 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50 transition-all shadow-inner"
                      required
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <label htmlFor="repo-url" className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Repository URL</label>
                    <input
                      id="repo-url"
                      type="url"
                      value={repoUrl}
                      onChange={(e) => setRepoUrl(e.target.value)}
                      placeholder="https://github.com/user/repo"
                      className="bg-[#09090b] border border-white/10 rounded-xl px-4 py-3 text-sm font-medium text-white placeholder:text-zinc-600 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50 transition-all shadow-inner"
                      required
                    />
                  </div>
                </div>
                
                <div className="flex items-center justify-between mt-2">
                  <div className="flex-1 mr-4">
                    {error && <div className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 px-3 py-2.5 rounded-xl flex items-center gap-2"><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>{error}</div>}
                    {message && <div className="text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-3 py-2.5 rounded-xl flex items-center gap-2"><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>{message}</div>}
                  </div>
                  
                  <button type="submit" disabled={isLoading} className="whitespace-nowrap px-6 py-3 rounded-xl font-semibold bg-cyan-600 text-white hover:bg-cyan-500 active:scale-[0.98] transition-all shadow-[0_0_15px_rgba(8,145,178,0.3)] hover:shadow-[0_0_20px_rgba(8,145,178,0.5)] disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none disabled:hover:bg-cyan-600 flex items-center gap-2 text-sm">
                    {isLoading ? (
                      <><svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Hooking...</>
                    ) : "Create Hook"}
                  </button>
                </div>
              </form>
            </div>

            {/* Repositories List Card */}
            <div className="bg-white/[0.02] border border-white/[0.08] rounded-3xl p-6 backdrop-blur-xl shadow-xl flex-1 flex flex-col min-h-[300px]">
              <div className="flex justify-between items-center mb-5 border-b border-white/[0.05] pb-4">
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <svg className="w-5 h-5 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                  </svg>
                  Configured Workspaces
                </h2>
                <span className="text-xs bg-white/5 border border-white/10 px-2.5 py-1 rounded-md text-zinc-400 font-mono">{repos.length} Total</span>
              </div>
              
              <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
                <div className="flex flex-col gap-3">
                  {repos.length === 0 ? (
                    <div className="h-full min-h-[150px] flex flex-col items-center justify-center text-center p-6 border border-dashed border-white/10 rounded-2xl bg-white/[0.01]">
                      <p className="text-zinc-500 text-sm">No repositories connected.</p>
                    </div>
                  ) : (
                    repos.map((repo) => {
                      const isSelected = selectedRepo?.id === repo.id;
                      return (
                        <div 
                          key={repo.id} 
                          onClick={() => setSelectedRepo(isSelected ? null : repo)}
                          className={`group flex justify-between items-center p-3.5 bg-[#09090b] border rounded-xl hover:border-cyan-500/30 transition-all cursor-pointer select-none ${
                            isSelected 
                              ? 'border-cyan-500 shadow-[0_0_15px_rgba(6,182,212,0.15)] bg-cyan-500/[0.02]' 
                              : 'border-white/5'
                          }`}
                        >
                          <div className="flex items-center gap-4">
                            <div className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${
                              isSelected 
                                ? 'bg-cyan-500 text-zinc-950' 
                                : 'bg-cyan-500/10 text-cyan-400 group-hover:bg-cyan-500 group-hover:text-zinc-950'
                            }`}>
                              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                                <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
                              </svg>
                            </div>
                            <div className="flex flex-col">
                              <span className="font-semibold text-zinc-200 text-sm flex items-center gap-2">
                                {repo.name}
                                {isSelected && (
                                  <span className="text-[9px] font-bold text-cyan-400 bg-cyan-500/10 px-1.5 py-0.5 rounded border border-cyan-500/20">Selected</span>
                                )}
                              </span>
                              <a href={repo.github_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-[11px] text-zinc-500 hover:text-cyan-400 transition-colors mt-0.5 max-w-[200px] sm:max-w-xs truncate">
                                {repo.github_url}
                              </a>
                            </div>
                          </div>
                          <div className={`hidden sm:flex px-2.5 py-1 rounded-md border ${
                            isSelected 
                              ? 'bg-cyan-500/10 border-cyan-500/30' 
                              : 'bg-white/5 border-white/5'
                          }`}>
                            <span className={`text-[10px] font-mono uppercase tracking-widest ${
                              isSelected ? 'text-cyan-400 font-bold' : 'text-zinc-500'
                            }`}>ID:{repo.id}</span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* Right column - Build executions logs (Terminal Style) */}
          <section className="lg:col-span-5 h-full min-h-[500px]">
            <div className="bg-[#050505] border border-white/[0.08] rounded-3xl overflow-hidden shadow-2xl flex flex-col h-full relative">
              
              {/* Fake Terminal Header */}
              <div className="h-12 bg-white/[0.03] border-b border-white/[0.08] flex items-center px-4 justify-between select-none">
                  <div className="flex gap-2 items-center">
                      <div className="w-3 h-3 rounded-full bg-rose-500/80 shadow-[0_0_5px_rgba(244,63,94,0.5)]"></div>
                      <div className="w-3 h-3 rounded-full bg-amber-500/80 shadow-[0_0_5px_rgba(245,158,11,0.5)]"></div>
                      <div className="w-3 h-3 rounded-full bg-emerald-500/80 shadow-[0_0_5px_rgba(16,185,129,0.5)]"></div>
                  </div>
                  
                  <span className="text-[11px] font-mono text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                    ~/Magnus/execution-logs{selectedRepo && `/${selectedRepo.name.toLowerCase()}`}
                    {filteredBuilds.some(b => b.status.toLowerCase() === 'running') && (
                      <span className="flex h-2 w-2 relative">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500"></span>
                      </span>
                    )}
                  </span>

                  <div>
                    {selectedRepo ? (
                      <button 
                        onClick={() => setSelectedRepo(null)}
                        className="text-[10px] font-mono text-cyan-400 hover:text-cyan-300 bg-cyan-500/10 border border-cyan-500/30 px-2.5 py-1 rounded-md transition-colors flex items-center gap-1.5 active:scale-[0.98]"
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                        ALL
                      </button>
                    ) : (
                      <div className="w-12"></div>
                    )}
                  </div>
              </div>

              {/* Terminal Body */}
              <div className="flex-1 overflow-y-auto p-5 custom-scrollbar bg-gradient-to-b from-transparent to-[#030303]">
                {filteredBuilds.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center p-6">
                    <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mb-4 border border-white/5 shadow-inner">
                      <svg className="w-8 h-8 text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <h3 className="text-white font-medium mb-1 font-mono text-sm">
                      {selectedRepo ? ">_ NO_EXECUTIONS" : ">_ AWAITING_COMMITS"}
                    </h3>
                    <p className="text-xs text-zinc-500 font-mono">
                      {selectedRepo 
                        ? `No execution history found for ${selectedRepo.name}.` 
                        : "Push to origin to trigger pipeline stream."}
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-5">
                    {filteredBuilds.map((build) => (
                      <div key={build.id} className="relative pl-6 before:content-[''] before:absolute before:left-[11px] before:top-[30px] before:bottom-[-20px] before:w-px before:bg-white/[0.1] last:before:hidden">
                        {/* Timeline Dot */}
                        <div className="absolute left-0 top-1.5 w-6 h-6 rounded-full bg-[#050505] border border-white/10 flex items-center justify-center z-10">
                          <div className={`w-2 h-2 rounded-full ${
                            build.status.toLowerCase() === 'success' ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]' :
                            build.status.toLowerCase() === 'running' ? 'bg-cyan-400 animate-pulse shadow-[0_0_8px_rgba(34,211,238,0.8)]' :
                            build.status.toLowerCase() === 'failed' ? 'bg-rose-400 shadow-[0_0_8px_rgba(251,113,133,0.8)]' :
                            'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]'
                          }`}></div>
                        </div>
                        
                        <div
                          onClick={() => setSelectedBuild(build)}
                          className="p-4 bg-white/[0.02] border border-white/[0.05] rounded-xl hover:border-white/15 hover:bg-white/[0.04] transition-all cursor-pointer"
                        >
                          <div className="flex justify-between items-start mb-3">
                            <span className="font-bold text-zinc-200 text-sm flex items-center gap-2">
                              <svg className="w-3.5 h-3.5 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" /></svg>
                              {build.repository_name}
                            </span>
                            <div className="flex items-center gap-2">
                              {build.artifacts && build.artifacts.length > 0 && (
                                <span className="text-[9px] font-bold uppercase tracking-widest px-2 py-1 rounded-md bg-indigo-500/10 text-indigo-400 border border-indigo-500/30 shadow-[0_0_10px_rgba(99,102,241,0.15)] flex items-center gap-1">
                                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                                  {build.artifacts.length} Artifact{build.artifacts.length > 1 ? 's' : ''}
                                </span>
                              )}
                              <span className={`text-[9px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-md ${getStatusBadgeClass(build.status)}`}>
                                {build.status}
                              </span>
                            </div>
                          </div>
                          
                          <div className="flex flex-col gap-2 text-[11px] font-mono">
                            <div className="flex justify-between items-center bg-[#000000] px-3 py-2 rounded-lg border border-white/5">
                              <span className="text-zinc-600">commit_sha</span> 
                              <span className="text-cyan-400 font-semibold">{build.commit_hash?.substring(0, 7) || "null"}</span>
                            </div>
                            <div className="flex justify-between items-center px-1">
                              <span className="text-zinc-600">timestamp</span> 
                              <span className="text-zinc-400">{new Date(build.created_at).toLocaleString([], { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>
      </main>

      {/* Logs Modal */}
      {selectedBuild && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-[#020202]/80 backdrop-blur-md" onClick={() => setSelectedBuild(null)}>
          <div className="w-full max-w-6xl h-[85vh] bg-[#050505] border border-white/[0.1] rounded-2xl shadow-2xl flex flex-col overflow-hidden relative" onClick={(e) => e.stopPropagation()}>
            
            {/* Modal Header */}
            <div className="h-14 bg-white/[0.03] border-b border-white/[0.08] flex items-center px-5 justify-between select-none">
              <div className="flex items-center gap-4">
                {/* Decorative Window Controls */}
                <div className="flex gap-2">
                  <div className="w-3.5 h-3.5 rounded-full bg-rose-500/80 shadow-[0_0_8px_rgba(244,63,94,0.5)]"></div>
                  <div className="w-3.5 h-3.5 rounded-full bg-amber-500/80 shadow-[0_0_8px_rgba(245,158,11,0.5)]"></div>
                  <div className="w-3.5 h-3.5 rounded-full bg-emerald-500/80 shadow-[0_0_8px_rgba(16,185,129,0.5)]"></div>
                </div>
                
                <div className="h-5 w-px bg-white/10 mx-2"></div>
                
                <div className="flex items-center gap-3">
                  <span className="text-zinc-200 font-bold text-sm">{selectedBuild.repository_name}</span>
                  <span className="text-cyan-400 font-mono text-xs bg-cyan-500/10 px-2 py-0.5 rounded border border-cyan-500/20">
                    {selectedBuild.commit_hash?.substring(0, 7) || "null"}
                  </span>
                  <span className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-md ${getStatusBadgeClass(selectedBuild.status)}`}>
                    {selectedBuild.status}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={handleDownloadLogs}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/30 text-xs font-medium text-indigo-300 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                  Download Logs
                </button>
                
                <button
                  onClick={handleCopyLogs}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-medium text-zinc-300 transition-colors"
                >
                  {copied ? (
                    <><svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg> Copied</>
                  ) : (
                    <><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg> Copy Logs</>
                  )}
                </button>

                <div className="w-px h-5 bg-white/10 mx-1"></div>

                <button
                  onClick={() => setSelectedBuild(null)}
                  className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-400 transition-colors flex items-center justify-center group"
                  title="Close"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
            </div>

            {/* Artifacts Panel */}
            {selectedBuild.artifacts && selectedBuild.artifacts.length > 0 && (
              <div className="bg-white/[0.02] border-b border-white/[0.08] px-5 py-3 flex flex-wrap gap-3 items-center select-none">
                <span className="text-zinc-400 font-bold text-xs uppercase tracking-wider flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>
                  Build Artifacts:
                </span>
                {selectedBuild.artifacts.map((art, idx) => (
                  art.type === 'file' ? (
                    <a
                      key={idx}
                      href={`${API_BASE.replace('/api', '')}${art.path}`}
                      download
                      className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-indigo-500/10 hover:bg-indigo-500/25 border border-indigo-500/30 text-xs font-semibold text-indigo-300 hover:text-indigo-200 transition-all shadow-[0_0_12px_rgba(99,102,241,0.05)] hover:shadow-[0_0_12px_rgba(99,102,241,0.15)] active:scale-[0.97]"
                    >
                      <svg className="w-4 h-4 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                      ⬇ Download {art.name}
                    </a>
                  ) : (
                    <a
                      key={idx}
                      href={`${API_BASE.replace('/api', '')}${art.path}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/25 border border-cyan-500/30 text-xs font-semibold text-cyan-300 hover:text-cyan-200 transition-all shadow-[0_0_12px_rgba(6,182,212,0.05)] hover:shadow-[0_0_12px_rgba(6,182,212,0.15)]"
                    >
                      <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                      {art.name}
                    </a>
                  )
                ))}
              </div>
            )}

            {/* Modal Body (Terminal) */}
            <div className="flex-1 overflow-y-auto p-6 bg-[#020202] font-mono text-xs sm:text-sm text-zinc-300 custom-scrollbar">
              {isLogsLoading && !logs ? (
                 <div className="flex items-center justify-center h-full text-zinc-500 gap-3">
                   <svg className="animate-spin h-5 w-5 text-cyan-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                   Loading logs stream...
                 </div>
              ) : (
                <div className="whitespace-pre-wrap break-all leading-relaxed flex flex-col gap-1">
                  {stripAnsi(logs).split('\n').map((line, idx) => (
                    <div key={idx} className="hover:bg-white/[0.02] px-2 -mx-2 rounded transition-colors">{line || ' '}</div>
                  ))}
                  
                  {['running', 'pending'].includes(selectedBuild.status?.toLowerCase()) && (
                    <div className="flex gap-2 items-center mt-4">
                      <span className="text-cyan-500">❯</span> 
                      <span className="animate-pulse w-2.5 h-4 bg-cyan-400 inline-block shadow-[0_0_8px_rgba(34,211,238,0.8)]"></span>
                    </div>
                  )}
                  <div ref={logsEndRef} />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Internal Custom Scrollbar Styles for the builds list */}
      <style dangerouslySetInnerHTML={{__html: `
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.1); border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.2); }
      `}} />
    </div>
  );
}

export default App;