import { useState, useEffect, useCallback, useRef } from "react";
import Header from "./components/Header";
import MetricsRow from "./components/MetricsRow";
import ConnectRepoCard from "./components/ConnectRepoCard";
import RepoList from "./components/RepoList";
import BuildHistory from "./components/BuildHistory";
import BuildModal from "./components/BuildModal";

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

  const [toast, setToast] = useState(null);

  const showToast = useCallback((msg, type = "success") => {
    setToast({ message: msg, type });
  }, []);

  useEffect(() => {
    if (!toast || toast.type === "confirm") return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

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
          setSelectedBuild(prev => {
            if (prev && prev.id === data.build.id && prev.status === data.build.status) {
              const isLive = ["running", "pending"].includes(prev.status?.toLowerCase());
              if (!isLive) {
                // Return same reference to avoid infinite re-render loop on finished builds
                return prev;
              }
            }
            return prev ? ({ ...prev, ...data.build }) : null;
          });
        }
      }
    } catch (err) {
      console.error("Failed to fetch logs:", err);
    } finally {
      if (!silent) setIsLogsLoading(false);
    }
  }, [token, fetchWithAuth]);

  const selectedBuildId = selectedBuild?.id;
  const selectedBuildStatus = selectedBuild?.status;

  useEffect(() => {
    if (!selectedBuildId) {
      setLogs("");
      return;
    }
    fetchLogs(selectedBuildId);
    const isLive = ["running", "pending"].includes(selectedBuildStatus?.toLowerCase());
    if (!isLive) return;
    const interval = setInterval(() => {
      fetchBuilds();
      fetchLogs(selectedBuildId, true);
    }, 2000);
    return () => clearInterval(interval);
  }, [selectedBuildId, selectedBuildStatus, fetchLogs, fetchBuilds]);

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

  const handleDeleteRepo = (repo) => {
    setToast({
      message: `Are you sure you want to delete workspace "${repo.name}" and all of its execution history? This action cannot be undone.`,
      type: "confirm",
      repoId: repo.id
    });
  };

  const executeDeleteRepo = async (repoId) => {
    setToast(null);
    try {
      const res = await fetchWithAuth(`${API_BASE}/repositories/${repoId}`, {
        method: "DELETE"
      });
      if (res.ok) {
        showToast("Workspace and corresponding execution history deleted successfully.", "success");
        setSelectedRepo(prev => prev && prev.id === repoId ? null : prev);
        fetchRepos();
        fetchBuilds();
      } else {
        let errorMsg = "Failed to delete workspace.";
        try {
          const data = await res.json();
          errorMsg = data.error || errorMsg;
        } catch (jsonErr) {
          // non-JSON error response, use default message
        }
        showToast(errorMsg, "error");
      }
    } catch (err) {
      showToast("Server connection failed.", "error");
    }
  };

  const handleRegisterRepo = async (e) => {
    e.preventDefault();
    if (!repoName || !repoUrl) {
      setError("Please fill out all fields.");
      showToast("Please fill out all fields.", "error");
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
        showToast("Repository registered successfully!", "success");
        setRepoName("");
        setRepoUrl("");
        fetchRepos();
      } else {
        setError(data.error || "Failed to register repository.");
        showToast(data.error || "Failed to register repository.", "error");
      }
    } catch (err) {
      setError("Server connection failed.");
      showToast("Server connection failed.", "error");
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
      <Header user={user} dbStatus={dbStatus} handleLogout={handleLogout} />

      <main className="max-w-7xl mx-auto w-full px-6 py-8 flex-1 flex flex-col relative z-10">
        {/* Top Metrics Row */}
        <MetricsRow
          reposCount={repos.length}
          buildsCount={builds.length}
          activeRunners={activeRunners}
          successRate={successRate}
        />

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 flex-1">
          {/* Left column - Connect Repo & List Repos */}
          <section className="lg:col-span-7 flex flex-col gap-6">
            <ConnectRepoCard
              repoName={repoName}
              setRepoName={setRepoName}
              repoUrl={repoUrl}
              setRepoUrl={setRepoUrl}
              error={error}
              message={message}
              isLoading={isLoading}
              handleRegisterRepo={handleRegisterRepo}
            />

            <RepoList
              repos={repos}
              selectedRepo={selectedRepo}
              setSelectedRepo={setSelectedRepo}
              onDeleteRepo={handleDeleteRepo}
            />
          </section>

          {/* Right column - Build executions logs (Terminal Style) */}
          <section className="lg:col-span-5 h-full min-h-[500px]">
            <BuildHistory
              filteredBuilds={filteredBuilds}
              selectedRepo={selectedRepo}
              setSelectedRepo={setSelectedRepo}
              setSelectedBuild={setSelectedBuild}
              getStatusBadgeClass={getStatusBadgeClass}
            />
          </section>
        </div>
      </main>

      {/* ─── Production Footer ─── */}
      <footer className="relative z-10 border-t border-white/[0.05] bg-white/[0.01] mt-auto">
        {/* Top gradient separator */}
        <div className="h-px w-full bg-gradient-to-r from-transparent via-cyan-500/20 to-transparent" />

        <div className="max-w-7xl mx-auto px-6 py-8">
          {/* Main footer grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-8 mb-8">

            {/* Brand column */}
            <div className="lg:col-span-1 flex flex-col gap-4">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-emerald-500 flex items-center justify-center shadow-lg shadow-cyan-500/25">
                  <svg className="w-4 h-4 text-zinc-950" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
                <span className="font-bold text-white tracking-tight">Magnus<span className="text-cyan-400">CI</span></span>
              </div>
              <p className="text-xs text-zinc-500 leading-relaxed max-w-[200px]">
                Automated pipeline orchestration for modern engineering teams.
              </p>
              {/* System status pill */}
              <div className="flex items-center gap-2 w-fit px-2.5 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.06]">
                <span className="relative flex h-1.5 w-1.5">
                  {dbStatus === "connected" && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />}
                  <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${dbStatus === "connected" ? "bg-emerald-500" : "bg-rose-500"}`} />
                </span>
                <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">
                  {dbStatus === "connected" ? "All systems operational" : "Degraded"}
                </span>
              </div>
            </div>

            {/* Live Stats column */}
            <div className="flex flex-col gap-3">
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-zinc-600 mb-1">Live Stats</h3>
              <div className="flex flex-col gap-2">
                {[
                  { label: "Registered Workspaces", value: repos.length },
                  { label: "Total Pipeline Runs", value: builds.length },
                  { label: "Active Runners", value: builds.filter(b => b.status?.toLowerCase() === "running").length },
                  {
                    label: "Success Rate",
                    value: (() => {
                      const done = builds.filter(b => ["success","failed"].includes(b.status?.toLowerCase()));
                      if (!done.length) return "—";
                      return `${Math.round((done.filter(b => b.status?.toLowerCase() === "success").length / done.length) * 100)}%`;
                    })()
                  },
                ].map(({ label, value }) => (
                  <div key={label} className="flex justify-between items-center py-1 border-b border-white/[0.04] last:border-0">
                    <span className="text-[11px] text-zinc-500 font-mono">{label}</span>
                    <span className="text-[11px] font-bold text-zinc-300 font-mono tabular-nums">{value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Stack column */}
            <div className="flex flex-col gap-3">
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-zinc-600 mb-1">Tech Stack</h3>
              <div className="flex flex-wrap gap-1.5">
                {[
                  { label: "Node.js", color: "emerald" },
                  { label: "PostgreSQL", color: "cyan" },
                  { label: "BullMQ", color: "amber" },
                  { label: "Docker", color: "sky" },
                  { label: "React", color: "cyan" },
                  { label: "GitHub OAuth", color: "violet" },
                  { label: "Webhooks", color: "rose" },
                ].map(({ label, color }) => (
                  <span
                    key={label}
                    className={`text-[9px] font-bold uppercase tracking-widest px-2 py-1 rounded-md border
                      ${color === "emerald" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : ""}
                      ${color === "cyan" ? "bg-cyan-500/10 text-cyan-400 border-cyan-500/20" : ""}
                      ${color === "amber" ? "bg-amber-500/10 text-amber-400 border-amber-500/20" : ""}
                      ${color === "sky" ? "bg-sky-500/10 text-sky-400 border-sky-500/20" : ""}
                      ${color === "violet" ? "bg-violet-500/10 text-violet-400 border-violet-500/20" : ""}
                      ${color === "rose" ? "bg-rose-500/10 text-rose-400 border-rose-500/20" : ""}
                    `}
                  >
                    {label}
                  </span>
                ))}
              </div>
            </div>

            {/* Pipeline health column */}
            <div className="flex flex-col gap-3">
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-zinc-600 mb-1">Pipeline Health</h3>
              <div className="flex flex-col gap-2.5">
                {[
                  { label: "Webhook Listener", ok: dbStatus === "connected" },
                  { label: "Database Connection", ok: dbStatus === "connected" },
                  { label: "Build Queue", ok: true },
                  { label: "Container Runtime", ok: true },
                ].map(({ label, ok }) => (
                  <div key={label} className="flex items-center gap-2">
                    <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${ok ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.6)]" : "bg-rose-500 shadow-[0_0_6px_rgba(239,68,68,0.6)]"}`} />
                    <span className="text-[11px] font-mono text-zinc-500">{label}</span>
                    <span className={`ml-auto text-[9px] font-bold uppercase tracking-wider ${ok ? "text-emerald-500" : "text-rose-400"}`}>
                      {ok ? "UP" : "DOWN"}
                    </span>
                  </div>
                ))}
              </div>
            </div>

          </div>

          {/* Bottom bar */}
          <div className="pt-6 border-t border-white/[0.04] flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex items-center gap-4">
              <span className="text-[10px] font-mono text-zinc-600">
                © {new Date().getFullYear()} MagnusCI &nbsp;·&nbsp; v2.0.0
              </span>
              <span className="hidden sm:inline text-[10px] font-mono text-zinc-700">
                Build #{builds.length > 0 ? builds[0]?.id : "—"}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-mono text-zinc-700 hidden sm:inline">
                Uptime engine active
              </span>
              {dbTime && (
                <span className="text-[10px] font-mono text-zinc-700">
                  DB sync: {new Date(dbTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </span>
              )}
              <span className="inline-flex items-center gap-1.5 text-[10px] font-mono text-zinc-600 bg-white/[0.03] border border-white/[0.05] px-2.5 py-1 rounded-md">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-500 shadow-[0_0_5px_rgba(6,182,212,0.7)] animate-pulse" />
                DAEMON RUNNING
              </span>
            </div>
          </div>
        </div>
      </footer>

      {/* Logs Modal */}
      <BuildModal
        selectedBuild={selectedBuild}
        setSelectedBuild={setSelectedBuild}
        isLogsLoading={isLogsLoading}
        logs={logs}
        handleDownloadLogs={handleDownloadLogs}
        handleCopyLogs={handleCopyLogs}
        copied={copied}
        getStatusBadgeClass={getStatusBadgeClass}
        API_BASE={API_BASE}
      />

      {/* Custom Toast Notification Overlay */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 animate-fade-in max-w-sm w-full bg-[#0a0a0c]/95 border border-white/[0.08] rounded-2xl p-4 shadow-2xl backdrop-blur-xl">
          <div className="flex gap-3">
            {toast.type === "confirm" ? (
              <div className="w-8 h-8 rounded-lg bg-rose-500/10 text-rose-400 border border-rose-500/20 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
            ) : toast.type === "error" ? (
              <div className="w-8 h-8 rounded-lg bg-rose-500/10 text-rose-450 border border-rose-500/20 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
            ) : (
              <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
            )}
            
            <div className="flex-1">
              <p className="text-xs font-mono text-zinc-300 leading-relaxed">{toast.message}</p>
              
              {toast.type === "confirm" ? (
                <div className="flex gap-2 mt-3 justify-end">
                  <button 
                    onClick={() => setToast(null)}
                    className="px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider bg-white/5 border border-white/10 text-zinc-400 hover:text-zinc-200 hover:bg-white/10 transition-all cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={() => executeDeleteRepo(toast.repoId)}
                    className="px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider bg-rose-600 border border-rose-500/30 text-white hover:bg-rose-500 transition-all shadow-[0_0_15px_rgba(220,38,38,0.3)] cursor-pointer"
                  >
                    Delete
                  </button>
                </div>
              ) : (
                <div className="flex justify-end mt-1">
                  <button 
                    onClick={() => setToast(null)}
                    className="text-[9px] font-mono text-zinc-500 hover:text-zinc-400 transition-colors cursor-pointer"
                  >
                    dismiss
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <style dangerouslySetInnerHTML={{__html: `
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.1); border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.2); }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-in {
          animation: fadeIn 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
      `}} />
    </div>
  );
}

export default App;