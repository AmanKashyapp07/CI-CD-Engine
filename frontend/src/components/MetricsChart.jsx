import React from 'react';

const parseMetrics = (metrics) => {
  if (!metrics) return [];
  if (typeof metrics === 'string') {
    try { return JSON.parse(metrics); } catch { return []; }
  }
  return Array.isArray(metrics) ? metrics : [];
};

export default function MetricsChart({ rawMetrics, status }) {
  const metrics = parseMetrics(rawMetrics);
  const isRunning = status?.toLowerCase() === 'running';

  if (metrics.length === 0) {
    if (isRunning) {
      return (
        <div className="bg-zinc-900/20 border-b border-white/[0.08] px-5 py-4 flex items-center justify-between select-none">
          <span className="text-zinc-400 font-bold text-xs uppercase tracking-wider flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5 text-cyan-400 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
            Resource Metrics:
          </span>
          <div className="flex items-center gap-2 text-xs font-semibold text-zinc-500">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500"></span>
            </span>
            Initializing resource monitors...
          </div>
        </div>
      );
    }
    return null;
  }

  const cpuVals = metrics.map(m => m.cpu || 0);
  const memVals = metrics.map(m => m.memory || 0);
  const maxCpu = Math.max(...cpuVals, 10);
  const maxMem = Math.max(...memVals, 64);
  
  const currentCpu = cpuVals[cpuVals.length - 1];
  const currentMem = memVals[memVals.length - 1];
  const peakCpu = Math.max(...cpuVals);
  const peakMem = Math.max(...memVals);
  const avgCpu = cpuVals.length > 0 ? (cpuVals.reduce((a, b) => a + b, 0) / cpuVals.length) : 0;
  const avgMem = memVals.length > 0 ? (memVals.reduce((a, b) => a + b, 0) / memVals.length) : 0;

  // SVG Dimensions
  const width = 300;
  const height = 80;

  const getSvgPoints = (vals, max) => {
    if (vals.length === 0) return [];
    return vals.map((val, idx) => {
      const x = vals.length > 1 ? (idx / (vals.length - 1)) * (width - 20) + 10 : width / 2;
      const y = height - (val / max) * (height - 20) - 10;
      return `${x},${y}`;
    });
  };

  const cpuPoints = getSvgPoints(cpuVals, maxCpu);
  const memPoints = getSvgPoints(memVals, maxMem);

  const cpuLinePath = cpuPoints.length > 0 ? `M ${cpuPoints.join(' L ')}` : '';
  const cpuFillPath = cpuPoints.length > 0 ? `${cpuLinePath} L ${cpuPoints[cpuPoints.length - 1].split(',')[0]},${height - 5} L ${cpuPoints[0].split(',')[0]},${height - 5} Z` : '';

  const memLinePath = memPoints.length > 0 ? `M ${memPoints.join(' L ')}` : '';
  const memFillPath = memPoints.length > 0 ? `${memLinePath} L ${memPoints[memPoints.length - 1].split(',')[0]},${height - 5} L ${memPoints[0].split(',')[0]},${height - 5} Z` : '';

  return (
    <div className="bg-zinc-950/40 border-b border-white/[0.08] px-5 py-4 flex flex-col gap-4 select-none">
      <div className="flex items-center justify-between">
        <span className="text-zinc-400 font-bold text-xs uppercase tracking-wider flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
          Container Resource Utilization:
        </span>
        {isRunning ? (
          <div className="flex items-center gap-2 text-xs font-semibold text-cyan-400">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500"></span>
            </span>
            Live Resource Monitoring Active
          </div>
        ) : (
          <span className="text-xs font-semibold text-zinc-500">Execution Resource Footprint</span>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* CPU Chart */}
        <div className="bg-white/[0.01] border border-white/[0.04] rounded-xl p-3 flex flex-col gap-2 relative overflow-hidden group hover:border-white/[0.08] transition-all">
          <div className="flex justify-between items-baseline z-10">
            <div>
              <div className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider">
                {isRunning ? "CPU Utilization" : "Average CPU"}
              </div>
              <div className="text-lg font-bold text-cyan-400 mt-0.5">
                {isRunning ? `${currentCpu.toFixed(1)}%` : `${avgCpu.toFixed(1)}%`}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase font-bold text-zinc-600 tracking-wider">Peak CPU</div>
              <div className="text-xs font-semibold text-zinc-400">{peakCpu.toFixed(1)}%</div>
            </div>
          </div>
          <div className="h-20 w-full mt-2">
            <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full overflow-visible">
              <defs>
                <linearGradient id="cpuGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.25" />
                  <stop offset="100%" stopColor="#22d3ee" stopOpacity="0.0" />
                </linearGradient>
              </defs>
              {/* Grid Lines */}
              <line x1="10" y1={height - 10} x2={width - 10} y2={height - 10} stroke="rgba(255,255,255,0.03)" strokeWidth="1" />
              <line x1="10" y1={height / 2} x2={width - 10} y2={height / 2} stroke="rgba(255,255,255,0.03)" strokeWidth="1" />
              <line x1="10" y1="10" x2={width - 10} y2={10} stroke="rgba(255,255,255,0.03)" strokeWidth="1" />
              {/* Area Fill */}
              {cpuFillPath && <path d={cpuFillPath} fill="url(#cpuGrad)" />}
              {/* Stroke Line */}
              {cpuLinePath && <path d={cpuLinePath} fill="none" stroke="#22d3ee" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />}
              {/* Current Value Dot */}
              {cpuPoints.length > 0 && (
                <circle
                  cx={cpuPoints[cpuPoints.length - 1].split(',')[0]}
                  cy={cpuPoints[cpuPoints.length - 1].split(',')[1]}
                  r="3"
                  fill="#22d3ee"
                  className={isRunning ? "animate-pulse" : ""}
                />
              )}
            </svg>
          </div>
        </div>

        {/* Memory Chart */}
        <div className="bg-white/[0.01] border border-white/[0.04] rounded-xl p-3 flex flex-col gap-2 relative overflow-hidden group hover:border-white/[0.08] transition-all">
          <div className="flex justify-between items-baseline z-10">
            <div>
              <div className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider">
                {isRunning ? "Memory Allocation" : "Average Memory"}
              </div>
              <div className="text-lg font-bold text-indigo-400 mt-0.5">
                {isRunning ? `${currentMem.toFixed(1)} MB` : `${avgMem.toFixed(1)} MB`}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase font-bold text-zinc-600 tracking-wider">Peak Memory</div>
              <div className="text-xs font-semibold text-zinc-400">{peakMem.toFixed(1)} MB</div>
            </div>
          </div>
          <div className="h-20 w-full mt-2">
            <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full overflow-visible">
              <defs>
                <linearGradient id="memGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#818cf8" stopOpacity="0.25" />
                  <stop offset="100%" stopColor="#818cf8" stopOpacity="0.0" />
                </linearGradient>
              </defs>
              {/* Grid Lines */}
              <line x1="10" y1={height - 10} x2={width - 10} y2={height - 10} stroke="rgba(255,255,255,0.03)" strokeWidth="1" />
              <line x1="10" y1={height / 2} x2={width - 10} y2={height / 2} stroke="rgba(255,255,255,0.03)" strokeWidth="1" />
              <line x1="10" y1="10" x2={width - 10} y2="10" stroke="rgba(255,255,255,0.03)" strokeWidth="1" />
              {/* Area Fill */}
              {memFillPath && <path d={memFillPath} fill="url(#memGrad)" />}
              {/* Stroke Line */}
              {memLinePath && <path d={memLinePath} fill="none" stroke="#818cf8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />}
              {/* Current Value Dot */}
              {memPoints.length > 0 && (
                <circle
                  cx={memPoints[memPoints.length - 1].split(',')[0]}
                  cy={memPoints[memPoints.length - 1].split(',')[1]}
                  r="3"
                  fill="#818cf8"
                  className={isRunning ? "animate-pulse" : ""}
                />
              )}
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}
