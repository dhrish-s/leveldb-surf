const express = require('express');
const cors = require('cors');
const path = require('path');
const { parseJsonlFile, reloadMetrics } = require('./metrics-parser');
const { setupRoutes } = require('./routes');

const app = express();
const PORT = process.env.PORT || 3001;

// Get metrics file paths from environment
const METRICS_FILE_BLOOM = process.env.METRICS_FILE_BLOOM;
const METRICS_FILE_SURF = process.env.METRICS_FILE_SURF;
const METRICS_FILE = process.env.METRICS_FILE || path.join(__dirname, '..', '..', 'metrics', 'sample_metrics.jsonl');

// Middleware
app.use(cors());
app.use(express.json());

// Global state: sources map with filePath, events, etc.
const state = {
  sources: {},
  lastReloadTime: null,
};

// Load metrics for all configured sources
function loadMetrics() {
  state.sources = {};
  state.lastReloadTime = new Date().toISOString();

  const sourcesToLoad = [];

  if (METRICS_FILE_BLOOM) {
    sourcesToLoad.push({ name: 'bloom', filePath: METRICS_FILE_BLOOM });
  }
  if (METRICS_FILE_SURF) {
    sourcesToLoad.push({ name: 'surf', filePath: METRICS_FILE_SURF });
  }
  if (!METRICS_FILE_BLOOM && !METRICS_FILE_SURF && METRICS_FILE) {
    sourcesToLoad.push({ name: 'default', filePath: METRICS_FILE });
  }

  for (const { name, filePath } of sourcesToLoad) {
    console.log(`Loading metrics from: ${filePath} as source '${name}'`);
    const result = parseJsonlFile(filePath);
    // Add source to each event
    result.events = result.events.map(event => ({ ...event, source: name }));
    state.sources[name] = {
      filePath,
      events: result.events,
      totalLines: result.totalLines,
      malformedLines: result.malformedLines,
    };
    console.log(`Loaded ${result.events.length} events for source '${name}'`);
  }

  if (Object.keys(state.sources).length === 0) {
    console.warn('No metrics files configured. Set METRICS_FILE_BLOOM, METRICS_FILE_SURF, or METRICS_FILE.');
  }
}

// Setup API routes
setupRoutes(app, state);

// Start server
function start() {
  loadMetrics();

  app.listen(PORT, () => {
    console.log(`\n📊 LevelDB Metrics Server running on http://localhost:${PORT}`);
    console.log('   Dashboard UI should connect to http://localhost:5173');
    console.log(`   Metrics file(s): ${Object.values(state.sources).map((src) => src.filePath).join(', ') || 'none'}\n`);
  });
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\nServer shutting down...');
  process.exit(0);
});

module.exports = { app, start, loadMetrics, state };

// Run if started directly
if (require.main === module) {
  start();
}
