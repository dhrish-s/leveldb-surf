/**
 * Utility to compute percentile from sorted values
 */
function percentile(data, p) {
  if (data.length === 0) return null;
  const sorted = data.slice().sort((a, b) => a - b);
  const index = Math.ceil(sorted.length * p / 100) - 1;
  return sorted[Math.max(0, index)];
}

/**
 * Compute summary metrics from events
 */
function computeSummary(events) {
  if (events.length === 0) {
    return getDefaultSummary();
  }

  const summary = {
    total_events: events.length,
    avg_latency_us: 0,
    p95_latency_us: null,
    false_positive_rate: null,
    actual_match_rate: 0,
    filter_may_match_rate: 0,
    total_considered: 0,
    total_pruned: 0,
    total_opened: 0,
    count_by_filter_type: {},
    count_by_query_type: {},
    count_by_benchmark_name: {},
    avg_latency_by_filter_type: {},
    avg_latency_by_query_type: {},
    timestamps: {
      min_timestamp_us: null,
      max_timestamp_us: null,
    },
  };

  let latencies = [];
  let falsePositives = 0;
  let falsePositiveCount = 0;
  let actualMatches = 0;
  let filterMayMatches = 0;
  let latenciesByFilterType = {};
  let latenciesByQueryType = {};
  let countsByFilterType = {};
  let countsByQueryType = {};
  let minTimestamp = Infinity;
  let maxTimestamp = -Infinity;

  for (const event of events) {
    // Latency stats
    if (event.latency_us !== undefined) {
      latencies.push(event.latency_us);
      const ft = event.filter_type || 'unknown';
      const qt = event.query_type || 'unknown';

      if (!latenciesByFilterType[ft]) latenciesByFilterType[ft] = [];
      if (!latenciesByQueryType[qt]) latenciesByQueryType[qt] = [];

      latenciesByFilterType[ft].push(event.latency_us);
      latenciesByQueryType[qt].push(event.latency_us);
    }

    // Filter type counts
    const ft = event.filter_type || 'unknown';
    countsByFilterType[ft] = (countsByFilterType[ft] || 0) + 1;

    // Query type counts
    const qt = event.query_type || 'unknown';
    countsByQueryType[qt] = (countsByQueryType[qt] || 0) + 1;

    // Benchmark name counts
    const bn = event.benchmark_name || 'unknown';
    summary.count_by_benchmark_name[bn] = (summary.count_by_benchmark_name[bn] || 0) + 1;

    // Actual match rate
    if (event.actual_match !== undefined) {
      actualMatches += event.actual_match ? 1 : 0;
    }

    // Filter may match rate
    if (event.filter_may_match !== undefined) {
      filterMayMatches += event.filter_may_match ? 1 : 0;
    }

    // False positive (only when filter_may_match is true but actual_match is false)
    if (event.false_positive !== undefined) {
      falsePositiveCount++;
      if (event.false_positive) {
        falsePositives++;
      }
    }

    // SSTable counters
    if (event.sstables_considered !== undefined) {
      summary.total_considered += event.sstables_considered;
    }
    if (event.sstables_pruned !== undefined) {
      summary.total_pruned += event.sstables_pruned;
    }
    if (event.sstables_opened !== undefined) {
      summary.total_opened += event.sstables_opened;
    }

    // Timestamp tracking
    if (event.timestamp_us !== undefined) {
      minTimestamp = Math.min(minTimestamp, event.timestamp_us);
      maxTimestamp = Math.max(maxTimestamp, event.timestamp_us);
    }
  }

  // Finalize aggregates
  if (latencies.length > 0) {
    summary.avg_latency_us = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
    summary.p95_latency_us = percentile(latencies, 95);
  }

  if (falsePositiveCount > 0) {
    summary.false_positive_rate = Math.round((falsePositives / falsePositiveCount) * 10000) / 10000;
  }

  if (events.length > 0) {
    summary.actual_match_rate = Math.round((actualMatches / events.length) * 10000) / 10000;
    summary.filter_may_match_rate = Math.round((filterMayMatches / events.length) * 10000) / 10000;
  }

  // Compute average latencies by filter type
  for (const [ft, lats] of Object.entries(latenciesByFilterType)) {
    if (lats.length > 0) {
      summary.avg_latency_by_filter_type[ft] = Math.round(lats.reduce((a, b) => a + b, 0) / lats.length);
    }
  }

  // Compute average latencies by query type
  for (const [qt, lats] of Object.entries(latenciesByQueryType)) {
    if (lats.length > 0) {
      summary.avg_latency_by_query_type[qt] = Math.round(lats.reduce((a, b) => a + b, 0) / lats.length);
    }
  }

  summary.count_by_filter_type = countsByFilterType;
  summary.count_by_query_type = countsByQueryType;

  if (minTimestamp !== Infinity) {
    summary.timestamps.min_timestamp_us = minTimestamp;
  }
  if (maxTimestamp !== -Infinity) {
    summary.timestamps.max_timestamp_us = maxTimestamp;
  }

  return summary;
}

/**
 * Default summary when no events exist
 */
function getDefaultSummary() {
  return {
    total_events: 0,
    avg_latency_us: 0,
    p95_latency_us: null,
    false_positive_rate: null,
    actual_match_rate: 0,
    filter_may_match_rate: 0,
    total_considered: 0,
    total_pruned: 0,
    total_opened: 0,
    count_by_filter_type: {},
    count_by_query_type: {},
    count_by_benchmark_name: {},
    avg_latency_by_filter_type: {},
    avg_latency_by_query_type: {},
    timestamps: {
      min_timestamp_us: null,
      max_timestamp_us: null,
    },
  };
}

module.exports = {
  computeSummary,
  percentile,
};
