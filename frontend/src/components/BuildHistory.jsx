import React, { useState, useEffect } from 'react';

export default function BuildHistory({
  filteredBuilds,
  selectedRepo,
  setSelectedRepo,
  setSelectedBuild,
  getStatusBadgeClass
}) {
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 5;

  useEffect(() => {
    setCurrentPage(1);
  }, [selectedRepo?.id, filteredBuilds.length]);

  const totalPages = Math.ceil(filteredBuilds.length / pageSize);
  const activePage = Math.min(currentPage, Math.max(totalPages, 1));
  const paginatedBuilds = filteredBuilds.slice((activePage - 1) * pageSize, activePage * pageSize);

  return (
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
            {paginatedBuilds.map((build) => (
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
                          <svg className="w-3.5 h-3.5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
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
                      <span className="text-zinc-650">commit_sha</span> 
                      <span className="text-cyan-400 font-semibold">{build.commit_hash?.substring(0, 7) || "null"}</span>
                    </div>
                    <div className="flex justify-between items-center px-1">
                      <span className="text-zinc-650">timestamp</span> 
                      <span className="text-zinc-400">{new Date(build.created_at).toLocaleString([], { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Terminal Footer with Pagination */}
      {totalPages > 1 && (
        <div className="h-12 bg-white/[0.01] border-t border-white/[0.08] flex items-center px-5 justify-between select-none text-xs text-zinc-500 font-mono">
          <span>
            PAGE: <strong className="text-zinc-300">{activePage}</strong> / <strong className="text-zinc-300">{totalPages}</strong>
          </span>
          <span className="hidden sm:inline text-[10px] text-zinc-650">
            SHOWING {(activePage - 1) * pageSize + 1}-{Math.min(activePage * pageSize, filteredBuilds.length)} OF {filteredBuilds.length}
          </span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
              disabled={activePage === 1}
              className={`px-2.5 py-1.5 rounded-lg border text-[10px] uppercase font-bold tracking-wider transition-colors ${
                activePage === 1
                  ? 'border-white/5 text-zinc-700 cursor-not-allowed bg-transparent'
                  : 'border-white/10 hover:border-cyan-500/30 hover:bg-cyan-500/5 text-cyan-400 hover:text-cyan-300'
              }`}
            >
              PREV
            </button>
            <button
              onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
              disabled={activePage === totalPages}
              className={`px-2.5 py-1.5 rounded-lg border text-[10px] uppercase font-bold tracking-wider transition-colors ${
                activePage === totalPages
                  ? 'border-white/5 text-zinc-700 cursor-not-allowed bg-transparent'
                  : 'border-white/10 hover:border-cyan-500/30 hover:bg-cyan-500/5 text-cyan-400 hover:text-cyan-300'
              }`}
            >
              NEXT
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
