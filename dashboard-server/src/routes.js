const express = require('express');
const { computeSummary } = require('./summary-calculator');

/**
 * Get events for a specific source or all sources
 */
function compareEventsByTimestamp(a, b) {
  const aTime = typeof a.timestamp_us === 'number' ? a.timestamp_us : Number.POSITIVE_INFINITY;
  const bTime = typeof b.timestamp_us === 'number' ? b.timestamp_us : Number.POSITIVE_INFINITY;
  if (aTime !== bTime) {
    return aTime - bTime;
  }
  const aId = typeof a.query_id === 'number' ? a.query_id : 0;
  const bId = typeof b.query_id === 'number' ? b.query_id : 0;
  return aId - bId;
}

function getEventsForSource(state, source) {
  if (source === 'all') {
    const sourceEntries = Object.entries(state.sources).map(([key, src]) => ({
      key,
      filePath: src?.filePath,
      eventsType: src?.events === undefined ? 'missing' : Array.isArray(src.events) ? 'array' : typeof src.events,
      eventsLength: Array.isArray(src?.events) ? src.events.length : null,
      totalLines: src?.totalLines,
      malformedLines: src?.malformedLines,
    }));
    console.log('DEBUG getEventsForSource(all): sourceEntries=', JSON.stringify(sourceEntries));

    const allEvents = [];
    for (const sourceKey of Object.keys(state.sources)) {
      const src = state.sources[sourceKey];
      if (src && Array.isArray(src.events)) {
        for (const event of src.events) {
          allEvents.push(event);
        }
      } else {
        console.log(`DEBUG getEventsForSource(all): skipping invalid source entry ${sourceKey}`, src);
      }
    }

    console.log('DEBUG getEventsForSource(all): merged event count=', allEvents.length);
    return allEvents;
  }

  const sourceEntry = state.sources[source];
  if (sourceEntry && Array.isArray(sourceEntry.events)) {
    console.log(`DEBUG getEventsForSource(${source}): returning ${sourceEntry.events.length} events`);
    return sourceEntry.events;
  }

  console.log(`DEBUG getEventsForSource(${source}): source missing or invalid`, sourceEntry);
  return [];
}

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
   * Return metadata about the metrics files
   */
  app.get('/api/meta', (req, res) => {
    const allEvents = getEventsForSource(state, 'all');
    const filterTypes = new Set();
    const queryTypes = new Set();
    const benchmarkNames = new Set();

    for (const event of allEvents) {
      if (event.filter_type) filterTypes.add(event.filter_type);
      if (event.query_type) queryTypes.add(event.query_type);
      if (event.benchmark_name) benchmarkNames.add(event.benchmark_name);
    }

    const sources = {};
    let totalLines = 0;
    let malformedLines = 0;
    for (const [name, src] of Object.entries(state.sources)) {
      sources[name] = src.filePath;
      totalLines += src.totalLines;
      malformedLines += src.malformedLines;
    }

    const availableSources = Object.keys(state.sources).sort();

    res.json({
      sources,
      available_sources: availableSources,
      total_lines_read: totalLines,
      malformed_lines_skipped: malformedLines,
      total_events: allEvents.length,
      server_time: new Date().toISOString(),
      available_filter_types: Array.from(filterTypes).sort(),
      available_query_types: Array.from(queryTypes).sort(),
      available_benchmark_names: Array.from(benchmarkNames).sort(),
    });
  });

  /**
   * GET /api/summary
   * Return aggregated metrics
   * Query params:
   *   - source: "bloom", "surf", "default", or "all"
   */
  app.get('/api/summary', (req, res) => {
    const source = req.query.source || 'all';

    if (source === 'all') {
      const allEvents = getEventsForSource(state, 'all');
      const response = {
        overall: computeSummary(allEvents),
      };

      for (const sourceName of Object.keys(state.sources).sort()) {
        response[sourceName] = computeSummary(getEventsForSource(state, sourceName));
      }

      res.json(response);
    } else {
      const events = getEventsForSource(state, source);
      res.json(computeSummary(events));
    }
  });

  /**
   * GET /api/events
   * Return filtered events
   * Query params:
   *   - source: "bloom", "surf", "default", or "all"
   *   - filter_type: "bloom" or "surf"
   *   - query_type: "point_get", "range_scan", etc.
   *   - benchmark_name: benchmark name
   *   - limit: max number of events to return
   */
  app.get('/api/events', (req, res) => {
    const source = req.query.source || 'all';
    let events = getEventsForSource(state, source);

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

    // Apply limit and sorting only when needed
    const limit = parseInt(req.query.limit, 10) || events.length;
    if (limit < events.length || source === 'all') {
      events = events.slice().sort(compareEventsByTimestamp);
    }
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
