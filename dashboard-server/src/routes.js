const express = require('express');
const { computeSummary } = require('./summary-calculator');

/**
 * Setup routes for metrics API
 */
function setupRoutes(app, state) {
  /**
   * GET /api/health
   * Health check endpoint
   */
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
    });
  });

  /**
   * GET /api/meta
   * Return metadata about the metrics file
   */
  app.get('/api/meta', (req, res) => {
    const filterTypes = new Set();
    const queryTypes = new Set();
    const benchmarkNames = new Set();

    for (const event of state.events) {
      if (event.filter_type) filterTypes.add(event.filter_type);
      if (event.query_type) queryTypes.add(event.query_type);
      if (event.benchmark_name) benchmarkNames.add(event.benchmark_name);
    }

    res.json({
      metrics_file: state.filePath,
      total_lines_read: state.totalLines,
      malformed_lines_skipped: state.malformedLines,
      total_events: state.events.length,
      server_time: new Date().toISOString(),
      available_filter_types: Array.from(filterTypes).sort(),
      available_query_types: Array.from(queryTypes).sort(),
      available_benchmark_names: Array.from(benchmarkNames).sort(),
    });
  });

  /**
   * GET /api/summary
   * Return aggregated metrics
   */
  app.get('/api/summary', (req, res) => {
    const summary = computeSummary(state.events);
    res.json(summary);
  });

  /**
   * GET /api/events
   * Return filtered events
   * Query params:
   *   - filter_type: "bloom" or "surf"
   *   - query_type: "point_get", "range_scan", etc.
   *   - benchmark_name: benchmark name
   *   - limit: max number of events to return
   */
  app.get('/api/events', (req, res) => {
    let events = state.events;

    // Apply filters
    if (req.query.filter_type && req.query.filter_type !== 'all') {
      events = events.filter(e => e.filter_type === req.query.filter_type);
    }

    if (req.query.query_type && req.query.query_type !== 'all') {
      events = events.filter(e => e.query_type === req.query.query_type);
    }

    if (req.query.benchmark_name && req.query.benchmark_name !== 'all') {
      events = events.filter(e => e.benchmark_name === req.query.benchmark_name);
    }

    // Apply limit
    const limit = parseInt(req.query.limit) || events.length;
    events = events.slice(-limit); // Return most recent

    res.json({
      events,
      count: events.length,
    });
  });
}

module.exports = {
  setupRoutes,
};
