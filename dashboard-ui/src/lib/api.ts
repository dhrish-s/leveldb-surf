import { Meta, Summary, CompareSummary, MetricsEvent, FilterState } from '../types/metrics';

const API_BASE = '/api';

export async function fetchMeta(): Promise<Meta> {
  try {
    const res = await fetch(`${API_BASE}/meta`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  } catch (err) {
    console.error('Failed to fetch meta:', err);
    return {
      sources: {},
      available_sources: [],
      total_lines_read: 0,
      malformed_lines_skipped: 0,
      total_events: 0,
      server_time: new Date().toISOString(),
      available_filter_types: [],
      available_query_types: [],
      available_benchmark_names: [],
    };
  }
}

export async function fetchSummary(source: string = 'all'): Promise<Summary | CompareSummary> {
  try {
    const params = new URLSearchParams();
    if (source !== 'all') {
      params.set('source', source);
    }
    const res = await fetch(`${API_BASE}/summary?${params.toString()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  } catch (err) {
    console.error('Failed to fetch summary:', err);
    const defaultSummary: Summary = {
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
      timestamps: { min_timestamp_us: null, max_timestamp_us: null },
    };
    if (source === 'all') {
      return {
        overall: defaultSummary,
        bloom: defaultSummary,
        surf: defaultSummary,
      };
    }
    return defaultSummary;
  }
}

export async function fetchEvents(filters: Partial<FilterState>, source: string = 'all'): Promise<MetricsEvent[]> {
  try {
    const params = new URLSearchParams();
    if (source !== 'all') {
      params.set('source', source);
    }
    if (filters.filter_type && filters.filter_type !== 'all') {
      params.set('filter_type', filters.filter_type);
    }
    if (filters.query_type && filters.query_type !== 'all') {
      params.set('query_type', filters.query_type);
    }
    if (filters.benchmark_name && filters.benchmark_name !== 'all') {
      params.set('benchmark_name', filters.benchmark_name);
    }
    if (filters.limit && filters.limit > 0) {
      params.set('limit', filters.limit.toString());
    }

    const res = await fetch(`${API_BASE}/events?${params.toString()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.events || [];
  } catch (err) {
    console.error('Failed to fetch events:', err);
    return [];
  }
}

export async function fetchHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/health`);
    return res.ok;
  } catch {
    return false;
  }
}
