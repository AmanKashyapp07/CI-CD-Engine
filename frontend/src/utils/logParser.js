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

  const steps = [
    { id: 'setup_workspace', name: 'Setup Workspace', lines: [], status: 'pending', startTime: null, endTime: null },
    { id: 'env_setup', name: 'Environment Detection', lines: [], status: 'pending', startTime: null, endTime: null },
    { id: 'pull_image', name: 'Pulling Base Layer', lines: [], status: 'pending', startTime: null, endTime: null },
    { id: 'run_tests', name: 'Running Pipeline Tests', lines: [], status: 'pending', startTime: null, endTime: null },
    { id: 'harvest_artifacts', name: 'Harvesting Artifacts', lines: [], status: 'pending', startTime: null, endTime: null },
    { id: 'auto_revert', name: 'Auto-Revert Status', lines: [], status: 'pending', startTime: null, endTime: null },
    { id: 'cleanup', name: 'Teardown & Cleanup', lines: [], status: 'pending', startTime: null, endTime: null }
  ];

  let currentStepId = 'setup_workspace';
  let hasSeenContainerStart = false;

  for (let line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Detect step transition keywords
    if (trimmed.includes('Detecting project language') || trimmed.includes('Detected context:')) {
      currentStepId = 'env_setup';
    } else if (trimmed.includes('Pulling base layer image') || trimmed.includes('Base layer cached successfully')) {
      currentStepId = 'pull_image';
    } else if (trimmed.includes('Configuring runtime container context')) {
      currentStepId = 'pull_image';
      hasSeenContainerStart = true;
    } else if (hasSeenContainerStart && currentStepId === 'pull_image' && !trimmed.includes('[ENGINE]')) {
      currentStepId = 'run_tests';
    } else if (trimmed.includes('Container execution exited with code')) {
      // Append the exit code line to run_tests so users see the container exit status
      const runStep = steps.find(s => s.id === 'run_tests');
      if (runStep) runStep.lines.push(line);
      currentStepId = 'harvest_artifacts';
      continue;
    } else if ((trimmed.includes('Captured') && trimmed.includes('build artifact')) || trimmed.includes('[ARTIFACTS]')) {
      currentStepId = 'harvest_artifacts';
    } else if (trimmed.includes('[REVERT]')) {
      currentStepId = 'auto_revert';
    } else if (trimmed.includes('Pruning operational file tree') || trimmed.includes('fully executed and finished context routines')) {
      currentStepId = 'cleanup';
    }

    const step = steps.find(s => s.id === currentStepId);
    if (step) {
      step.lines.push(line);
    }
  }

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

  // Initial assign of timestamps
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (step.lines.length > 0) {
      step.startTime = getFirstTimestamp(step.lines);
      step.endTime = getLastTimestamp(step.lines);
      
      if (!step.startTime && i > 0) {
        step.startTime = steps[i - 1].endTime || steps[i - 1].startTime;
      }
    }
  }

  // Refine start/end times between consecutive steps to fill gaps
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (step.lines.length === 0) continue;

    if (step.id === 'run_tests') {
      const pullStep = steps.find(s => s.id === 'pull_image');
      if (pullStep && pullStep.endTime) {
        step.startTime = pullStep.endTime;
      }
    }

    if (!step.endTime) {
      for (let j = i + 1; j < steps.length; j++) {
        if (steps[j].lines.length > 0 && steps[j].startTime) {
          step.endTime = steps[j].startTime;
          break;
        }
      }
    }
    
    // Calculate duration
    if (step.startTime && step.endTime) {
      const t1 = parseTimeToSeconds(step.startTime);
      const t2 = parseTimeToSeconds(step.endTime);
      if (t1 !== null && t2 !== null) {
        let diff = t2 - t1;
        if (diff < 0) diff += 24 * 3600;
        step.duration = `${diff.toFixed(1)}s`;
      } else {
        step.duration = '0s';
      }
    } else if (step.startTime && buildStatus === 'RUNNING') {
      step.duration = 'running...';
    } else {
      step.duration = '0.1s';
    }
  }

  let hasFailedStep = false;
  
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    
    // Check if the step lines contain any error keywords
    const hasErrorKeyword = step.lines.some(l => 
      l.includes('❌') || 
      l.toLowerCase().includes('operational breakdown') || 
      l.toLowerCase().includes('pipeline broken down') ||
      (step.id !== 'run_tests' && l.toLowerCase().includes('failed'))
    );

    const hasTestFail = step.id === 'run_tests' && step.lines.some(l => 
      l.includes('Container execution exited with code') && !l.includes('code: 0') && !l.includes('code: \x1b[32m0')
    );

    if (hasErrorKeyword || hasTestFail) {
      step.status = 'failed';
      hasFailedStep = true;
    } else if (step.lines.length > 0) {
      const isLastActiveStep = i === steps.findLastIndex(s => s.lines.length > 0);
      if (isLastActiveStep && buildStatus === 'RUNNING') {
        step.status = 'running';
      } else {
        step.status = 'success';
      }
    } else {
      // Step has 0 lines
      if (buildStatus === 'SUCCESS') {
        // If the build succeeded, all non-failed steps are marked success
        step.status = 'success';
      } else if (step.id === 'cleanup' && buildStatus === 'FAILED') {
        // Cleanup always runs in finally block even on failures
        step.status = 'success';
      } else {
        step.status = 'pending';
      }
    }
  }

  // Filter out steps with 0 lines that aren't critical
  return steps.filter(s => s.lines.length > 0 || ['setup_workspace', 'env_setup', 'pull_image', 'run_tests', 'harvest_artifacts', 'cleanup'].includes(s.id));
}
