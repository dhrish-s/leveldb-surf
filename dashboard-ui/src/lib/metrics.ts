import { MetricsEvent, Summary } from '../types/metrics';

export function formatLatency(us: number): string {
  if (us < 1000) return `${us}µs`;
  if (us < 1000000) return `${(us / 1000).toFixed(1)}ms`;
  return `${(us / 1000000).toFixed(2)}s`;
}

export function formatPercent(value: number | null): string {
  if (value === null || value === undefined) return '-';
  return `${(value * 100).toFixed(2)}%`;
}

export function formatNumber(value: number): string {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return value.toString();
}

export function getFilterColor(filterType: string): string {
  switch (filterType) {
    case 'bloom':
      return 'bg-blue-100 text-blue-800';
    case 'surf':
      return 'bg-purple-100 text-purple-800';
    default:
      return 'bg-gray-100 text-gray-800';
  }
}

export function getQueryTypeColor(queryType: string): string {
  switch (queryType) {
    case 'point_get':
      return 'bg-green-100 text-green-800';
    case 'range_scan':
      return 'bg-orange-100 text-orange-800';
    case 'point_seek':
      return 'bg-yellow-100 text-yellow-800';
    default:
      return 'bg-gray-100 text-gray-800';
  }
}

export function computeFilterTypeStats(
  events: MetricsEvent[],
  filterType: string,
  summary: Summary
): Partial<Summary> {
  const filtered = events.filter((e) => e.filter_type === filterType);
  if (filtered.length === 0) {
    return {
      total_events: 0,
      avg_latency_us: 0,
      p95_latency_us: null,
      false_positive_rate: null,
    };
  }

  const latencies = filtered.map((e) => e.latency_us).sort((a, b) => a - b);
  const avg = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
  const p95Index = Math.ceil((latencies.length * 95) / 100) - 1;
  const p95 = latencies[Math.max(0, p95Index)];

  let falsePositives = 0;
  let falsePositiveCount = 0;
  for (const e of filtered) {
    if (e.false_positive !== undefined) {
      falsePositiveCount++;
      if (e.false_positive) {
        falsePositives++;
      }
    }
  }

  return {
    total_events: filtered.length,
    avg_latency_us: avg,
    p95_latency_us: p95,
    false_positive_rate: falsePositiveCount > 0 ? falsePositives / falsePositiveCount : null,
  };
}
