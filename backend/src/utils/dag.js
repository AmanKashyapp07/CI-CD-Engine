const fs = require('fs').promises;
const path = require('path');

// Fallback presets per language/toolchain
const PRESETS = {
  'Node.js': {
    stages: {
      'install': { run: 'npm install' },
      'test': { run: 'npm test', needs: 'install' }
    }
  },
  'Python': {
    stages: {
      'install': { run: 'pip install -r requirements.txt' },
      'test': { run: 'python -m unittest discover', needs: 'install' }
    }
  },
  'Go': {
    stages: {
      'test': { run: 'go test -v ./...' }
    }
  },
  'Java (Maven)': {
    stages: {
      'test': { run: 'mvn test' }
    }
  },
  'Java (Gradle)': {
    stages: {
      'test': { run: 'gradle test' }
    }
  },
  'C/C++ (CMake)': {
    stages: {
      'build': { run: 'mkdir -p build && cd build && cmake .. && make' },
      'test': { run: 'cd build && ctest', needs: 'build' }
    }
  },
  'C/C++ (Make)': {
    stages: {
      'test': { run: 'make test' }
    }
  }
};

function getPreset(language) {
  if (!language) return null;
  for (const key of Object.keys(PRESETS)) {
    if (language === key || language.includes(key)) {
      return PRESETS[key];
    }
  }
  return null;
}

function hasCycle(stages) {
  const visited = new Set();
  const recStack = new Set();

  function dfs(node) {
    if (recStack.has(node)) return true;
    if (visited.has(node)) return false;

    visited.add(node);
    recStack.add(node);

    const needs = stages[node].needs || [];
    const dependencies = Array.isArray(needs) ? needs : [needs];

    for (const dep of dependencies) {
      if (stages[dep]) {
        if (dfs(dep)) return true;
      }
    }

    recStack.delete(node);
    return false;
  }

  for (const node of Object.keys(stages)) {
    if (dfs(node)) return true;
  }
  return false;
}

async function loadPipelineStages(workspacePath, language, defaultImage) {
  const configPath = path.join(workspacePath, 'magnus-ci.json');
  try {
    const data = await fs.readFile(configPath, 'utf8');
    const config = JSON.parse(data);

    // 1. Check if DAG Format
    if (config.stages && typeof config.stages === 'object') {
      const parsedStages = {};
      for (const [name, stage] of Object.entries(config.stages)) {
        parsedStages[name] = {
          run: stage.run || stage.cmd,
          image: stage.image || defaultImage,
          needs: stage.needs || []
        };
      }
      return parsedStages;
    }

    // 2. Check if Legacy Format
    if (config.image && config.run) {
      return {
        'build': {
          run: config.run,
          image: config.image,
          needs: []
        }
      };
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw err;
    }
  }

  // 3. Fallback to presets based on language
  const preset = getPreset(language);
  if (preset) {
    const parsedStages = {};
    for (const [name, stage] of Object.entries(preset.stages)) {
      parsedStages[name] = {
        run: stage.run,
        image: defaultImage,
        needs: stage.needs || []
      };
    }
    return parsedStages;
  }

  // 4. Default baseline fallback
  return {
    'test': {
      run: 'npm test',
      image: defaultImage,
      needs: []
    }
  };
}

async function executeDAG(stages, runStageFn) {
  const states = {};
  for (const stage of Object.keys(stages)) {
    states[stage] = 'PENDING';
  }

  const activePromises = {};

  while (true) {
    const runningStages = Object.keys(states).filter(s => states[s] === 'RUNNING');
    const pendingStages = Object.keys(states).filter(s => states[s] === 'PENDING');

    if (runningStages.length === 0 && pendingStages.length === 0) {
      break;
    }

    // Identify ready stages
    const readyStages = pendingStages.filter(stage => {
      const needs = stages[stage].needs || [];
      const dependencies = Array.isArray(needs) ? needs : [needs];
      // Ready if all dependencies are SUCCESS (or if there are no dependencies)
      return dependencies.every(dep => states[dep] === 'SUCCESS');
    });

    if (readyStages.length === 0 && runningStages.length > 0) {
      // Wait for any running stage to complete
      await Promise.race(Object.values(activePromises));
      continue;
    }

    if (readyStages.length === 0 && runningStages.length === 0 && pendingStages.length > 0) {
      // Abort remaining stages due to block / failures
      break;
    }

    // Launch ready stages in parallel
    for (const stage of readyStages) {
      states[stage] = 'RUNNING';
      activePromises[stage] = (async () => {
        try {
          const success = await runStageFn(stage, stages[stage]);
          states[stage] = success ? 'SUCCESS' : 'FAILED';
        } catch (err) {
          states[stage] = 'FAILED';
        }
        delete activePromises[stage];
      })();
    }
  }

  return states;
}

module.exports = {
  loadPipelineStages,
  hasCycle,
  executeDAG
};
