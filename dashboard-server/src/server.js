const express = require('express');
const cors = require('cors');
const path = require('path');
const { parseJsonlFile, reloadMetrics } = require('./metrics-parser');
const { setupRoutes } = require('./routes');

const app = express();
const PORT = process.env.PORT || 3001;

// Get metrics file path from environment or use default
const METRICS_FILE = process.env.METRICS_FILE || path.join(__dirname, '..', '..', 'metrics', 'sample_metrics.jsonl');

// Middleware
app.use(cors());
app.use(express.json());

// Global state
const state = {
  filePath: METRICS_FILE,
  events: [],
  totalLines: 0,
  malformedLines: 0,
  lastReloadTime: null,
};

// Load initial metrics
function loadMetrics() {
  console.log(`Loading metrics from: ${state.filePath}`);
  const result = parseJsonlFile(state.filePath);
  state.events = result.events;
  state.totalLines = result.totalLines;
  state.malformedLines = result.malformedLines;
  state.lastReloadTime = new Date().toISOString();
  console.log(`Loaded ${state.events.length} events`);
}

// Setup API routes
setupRoutes(app, state);

// Start server
function start() {
  loadMetrics();

  app.listen(PORT, () => {
    console.log(`\n📊 LevelDB Metrics Server running on http://localhost:${PORT}`);
    console.log(`   Dashboard UI should connect to http://localhost:${PORT}`);
    console.log(`   Metrics file: ${state.filePath}\n`);
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
