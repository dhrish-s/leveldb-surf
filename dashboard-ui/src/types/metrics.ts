export interface MetricsEvent {
  query_id: number;
  benchmark_name: string;
  filter_type: string;
  query_type: string;
  latency_us: number;
  timestamp_us: number;
  actual_match: boolean;
  source: string;
  query_lo?: string;
  query_hi?: string;
  filter_may_match?: boolean;
  false_positive?: boolean;
  sstables_considered?: number;
  sstables_pruned?: number;
  sstables_opened?: number;
}

export interface Summary {
  total_events: number;
  avg_latency_us: number;
  p95_latency_us: number | null;
  false_positive_rate: number | null;
  actual_match_rate: number;
  filter_may_match_rate: number;
  total_considered: number;
  total_pruned: number;
  total_opened: number;
  count_by_filter_type: Record<string, number>;
  count_by_query_type: Record<string, number>;
  count_by_benchmark_name: Record<string, number>;
  avg_latency_by_filter_type: Record<string, number>;
  avg_latency_by_query_type: Record<string, number>;
  timestamps: {
    min_timestamp_us: number | null;
    max_timestamp_us: number | null;
  };
}

export interface Meta {
  sources: Record<string, string>;
  available_sources: string[];
  total_lines_read: number;
  malformed_lines_skipped: number;
  total_events: number;
  server_time: string;
  available_filter_types: string[];
  available_query_types: string[];
  available_benchmark_names: string[];
}

export interface CompareSummary {
  overall: Summary;
  bloom?: Summary;
  surf?: Summary;
}
