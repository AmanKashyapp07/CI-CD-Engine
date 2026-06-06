import React, { useState } from 'react';

export default function RepoList({ repos, selectedRepo, setSelectedRepo, onDeleteRepo }) {
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 5;

  const totalPages = Math.ceil(repos.length / pageSize);
  const activePage = Math.min(currentPage, Math.max(totalPages, 1));
  const paginatedRepos = repos.slice((activePage - 1) * pageSize, activePage * pageSize);

  return (
    <div className="bg-white/[0.02] border border-white/[0.08] rounded-3xl p-6 backdrop-blur-xl shadow-xl flex-1 flex flex-col min-h-[300px]">
      <div className="flex justify-between items-center mb-5 border-b border-white/[0.05] pb-4">
        <h2 className="text-lg font-bold text-white flex items-center gap-2">
          <svg className="w-5 h-5 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
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
            paginatedRepos.map((repo) => {
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
                  <div className="flex items-center gap-3">
                    <div className={`hidden sm:flex px-2.5 py-1 rounded-md border ${
                      isSelected 
                        ? 'bg-cyan-500/10 border-cyan-500/30' 
                        : 'bg-white/5 border-white/5'
                    }`}>
                      <span className={`text-[10px] font-mono uppercase tracking-widest ${
                        isSelected ? 'text-cyan-400 font-bold' : 'text-zinc-500'
                      }`}>ID:{repo.id}</span>
                    </div>
                    {onDeleteRepo && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteRepo(repo);
                        }}
                        className="p-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-450 hover:bg-rose-500 hover:text-white hover:border-rose-500 transition-all active:scale-95 flex items-center justify-center cursor-pointer"
                        title="Delete Workspace"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {totalPages > 1 && (
        <div className="flex justify-between items-center mt-5 pt-4 border-t border-white/[0.05] select-none text-xs text-zinc-500 font-mono">
          <span>
            Showing <strong className="text-zinc-300">{(activePage - 1) * pageSize + 1}</strong> to{" "}
            <strong className="text-zinc-300">{Math.min(activePage * pageSize, repos.length)}</strong> of{" "}
            <strong className="text-zinc-300">{repos.length}</strong>
          </span>
          
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
              disabled={activePage === 1}
              className={`p-1.5 rounded-lg border transition-colors ${
                activePage === 1
                  ? 'border-white/5 text-zinc-700 cursor-not-allowed bg-transparent'
                  : 'border-white/10 hover:border-cyan-500/30 hover:bg-cyan-500/5 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            
            <span className="text-zinc-450">
              {activePage} / {totalPages}
            </span>
            
            <button
              onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
              disabled={activePage === totalPages}
              className={`p-1.5 rounded-lg border transition-colors ${
                activePage === totalPages
                  ? 'border-white/5 text-zinc-700 cursor-not-allowed bg-transparent'
                  : 'border-white/10 hover:border-cyan-500/30 hover:bg-cyan-500/5 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
