function parseTimeToSeconds(timeStr) {
  const parts = timeStr.split(':');
  if (parts.length === 3) {
    return parseInt(parts[0], 10) * 3600 + parseInt(parts[1], 10) * 60 + parseInt(parts[2], 10);
  }
  return null;
}

function stripAnsi(str) {
  if (!str) return "";
  
  // 1. Strip ANSI escape codes
  let cleaned = str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');

  // 2. Process carriage returns (\r) and filter out interactive Jest Tty updates (like "RUNS  ...")
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
}

export function parseLogsIntoSteps(rawLogs, buildStatus) {
  if (!rawLogs) return [];

  const cleanLogs = stripAnsi(rawLogs);
  const lines = cleanLogs.split('\n');

  // 1. Initialize permanent system steps
  const systemSteps = {
    setup_workspace: { id: 'setup_workspace', name: 'Setup Workspace', lines: [], status: 'pending', startTime: null, endTime: null },
    env_detect: { id: 'env_detect', name: 'Environment Detection', lines: [], status: 'pending', startTime: null, endTime: null },
  };

  const dynamicStages = {};

  const systemEndSteps = {
    artifacts: { id: 'artifacts', name: 'Harvesting Artifacts', lines: [], status: 'pending', startTime: null, endTime: null },
    cleanup: { id: 'cleanup', name: 'Teardown & Cleanup', lines: [], status: 'pending', startTime: null, endTime: null }
  };

  let lastActiveStage = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Detect stage logs based on bracket prefix, e.g. "[SETUP] added packages" or "[TEST] PASS"
    const stagePrefixRegex = /^(?:\[\d{2}:\d{2}:\d{2}\]\s+)?\[([A-Z0-9_-]+)\]\s+(.*)$/;
    const match = trimmed.match(stagePrefixRegex);

    if (match) {
      const stageName = match[1].toLowerCase();
      const content = match[2];

      // Exclude system names
      if (stageName !== 'worker' && stageName !== 'engine' && stageName !== 'revert') {
        if (!dynamicStages[stageName]) {
          dynamicStages[stageName] = {
            id: `stage_${stageName}`,
            name: `Stage: ${stageName.toUpperCase()}`,
            lines: [],
            status: 'pending',
            startTime: null,
            endTime: null
          };
        }
        dynamicStages[stageName].lines.push(line);
        lastActiveStage = stageName;
        continue;
      }
    }

    // Engine/Worker log lines
    if (trimmed.includes('Build status forced to RUNNING') || trimmed.includes('Created workspace path') || trimmed.includes('Repository cloned successfully') || trimmed.includes('Target commit successfully isolated')) {
      systemSteps.setup_workspace.lines.push(line);
    } else if (trimmed.includes('Detecting project language') || trimmed.includes('Detected context:') || trimmed.includes('dependency caching') || trimmed.includes('caching strategy') || trimmed.includes('Cache hit') || trimmed.includes('Cache miss')) {
      systemSteps.env_detect.lines.push(line);
    } else if (trimmed.includes('Preparing stage') || trimmed.includes('Launching stage') || (trimmed.includes('Stage') && trimmed.includes('execution exited')) || trimmed.includes('runtime session active')) {
      const stageMatch = trimmed.match(/stage\s+([A-Z0-9_-]+)/i);
      if (stageMatch) {
        const stageName = stageMatch[1].toLowerCase();
        if (!dynamicStages[stageName]) {
          dynamicStages[stageName] = {
            id: `stage_${stageName}`,
            name: `Stage: ${stageName.toUpperCase()}`,
            lines: [],
            status: 'pending',
            startTime: null,
            endTime: null
          };
        }
        dynamicStages[stageName].lines.push(line);
      } else if (lastActiveStage && dynamicStages[lastActiveStage]) {
        dynamicStages[lastActiveStage].lines.push(line);
      } else {
        systemSteps.env_detect.lines.push(line);
      }
    } else if ((trimmed.includes('Captured') && trimmed.includes('build artifact')) || trimmed.includes('[ARTIFACTS]') || trimmed.includes('Gathering build artifacts')) {
      systemEndSteps.artifacts.lines.push(line);
    } else if (trimmed.includes('Pruning operational file tree') || trimmed.includes('fully executed and finished context') || trimmed.includes('Pruned operational') || trimmed.includes('Teardown')) {
      systemEndSteps.cleanup.lines.push(line);
    } else {
      if (lastActiveStage && dynamicStages[lastActiveStage]) {
        dynamicStages[lastActiveStage].lines.push(line);
      } else {
        systemSteps.env_detect.lines.push(line);
      }
    }
  }

  // Combine steps in correct execution order
  const steps = [
    systemSteps.setup_workspace,
    systemSteps.env_detect,
    ...Object.values(dynamicStages),
    systemEndSteps.artifacts,
    systemEndSteps.cleanup
  ];

  const timeRegex = /\[(\d{2}:\d{2}:\d{2})\]/;
  const getFirstTimestamp = (stepLines) => {
    for (const l of stepLines) {
      const match = l.match(timeRegex);
      if (match) return match[1];
    }
    return null;
  };

  const getLastTimestamp = (stepLines) => {
    for (let i = stepLines.length - 1; i >= 0; i--) {
      const match = stepLines[i].match(timeRegex);
      if (match) return match[1];
    }
    return null;
  };

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (step.lines.length > 0) {
      step.startTime = getFirstTimestamp(step.lines);
      step.endTime = getLastTimestamp(step.lines);
    }
    
    if (!step.startTime && i > 0) {
      step.startTime = steps[i - 1].endTime || steps[i - 1].startTime;
    }
  }

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    
    if (!step.endTime) {
      for (let j = i + 1; j < steps.length; j++) {
        if (steps[j].lines.length > 0 && steps[j].startTime) {
          step.endTime = steps[j].startTime;
          break;
        }
      }
    }

    if (step.startTime && step.endTime) {
      const t1 = parseTimeToSeconds(step.startTime);
      const t2 = parseTimeToSeconds(step.endTime);
      if (t1 !== null && t2 !== null) {
        let diff = t2 - t1;
        if (diff < 0) diff += 24 * 3600;
        step.duration = `${diff.toFixed(1)}s`;
      } else {
        step.duration = '0.1s';
      }
    } else if (step.startTime && buildStatus === 'RUNNING') {
      step.duration = 'running...';
    } else {
      step.duration = '0.0s';
    }
  }

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];

    const hasError = step.lines.some(l => 
      l.includes('❌') || 
      l.toLowerCase().includes('failed') || 
      l.toLowerCase().includes('error') || 
      l.toLowerCase().includes('breakdown')
    );

    if (hasError) {
      step.status = 'failed';
    } else if (step.lines.length > 0) {
      const isLastActiveStep = i === steps.findLastIndex(s => s.lines.length > 0);
      if (isLastActiveStep && buildStatus === 'RUNNING') {
        step.status = 'running';
      } else {
        step.status = 'success';
      }
    } else {
      if (buildStatus === 'SUCCESS') {
        step.status = 'success';
      } else if (step.id === 'cleanup' && buildStatus === 'FAILED') {
        step.status = 'success';
      } else {
        step.status = 'pending';
      }
    }
  }

  return steps.filter(s => s.lines.length > 0 || ['setup_workspace', 'env_detect', 'cleanup'].includes(s.id));
}
