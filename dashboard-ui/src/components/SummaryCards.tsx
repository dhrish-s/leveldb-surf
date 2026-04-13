import React from 'react';
import { Summary, MetricsEvent } from '../types/metrics';
import { formatLatency, formatPercent, formatNumber, computeFilterTypeStats } from '../lib/metrics';
import { Activity } from 'lucide-react';

interface SummaryCardsProps {
  summary: Summary | null;
  events: MetricsEvent[];
}

export function SummaryCards({ summary, events }: SummaryCardsProps) {
  if (!summary) return null;

  const bloomStats = computeFilterTypeStats(events, 'bloom', summary);
  const surfStats = computeFilterTypeStats(events, 'surf', summary);

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-8">
        <Card
          title="Total Events"
          value={summary.total_events.toLocaleString()}
          icon={<Activity className="w-5 h-5 text-blue-600" />}
        />
        <Card
          title="Avg Latency"
          value={formatLatency(summary.avg_latency_us)}
          subtitle={`p95: ${formatLatency(summary.p95_latency_us || 0)}`}
        />
        <Card
          title="False Positives"
          value={formatPercent(summary.false_positive_rate)}
          subtitle={summary.false_positive_rate !== null ? 'of point gets' : 'N/A'}
        />
        <Card
          title="Actual Match"
          value={formatPercent(summary.actual_match_rate)}
        />
        <Card
          title="Filter May Match"
          value={formatPercent(summary.filter_may_match_rate)}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <Card
          title="Total Considered"
          value={formatNumber(summary.total_considered)}
        />
        <Card
          title="Total Pruned"
          value={formatNumber(summary.total_pruned)}
        />
        <Card
          title="Total Opened"
          value={formatNumber(summary.total_opened)}
        />
      </div>

      {/* Bloom vs SuRF Comparison */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <ComparisonCard
          title="Bloom Filter"
          stats={bloomStats}
          color="blue"
        />
        <ComparisonCard
          title="SuRF Filter"
          stats={surfStats}
          color="purple"
        />
      </div>
    </div>
  );
}

function Card({
  title,
  value,
  subtitle,
  icon,
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="card p-4">
      <div className="flex items-start justify-between mb-2">
        <p className="text-sm text-slate-600">{title}</p>
        {icon}
      </div>
      <p className="text-2xl font-bold text-slate-900">{value}</p>
      {subtitle && <p className="text-xs text-slate-500 mt-1">{subtitle}</p>}
    </div>
  );
}

function ComparisonCard({
  title,
  stats,
  color,
}: {
  title: string;
  stats: Partial<Summary>;
  color: 'blue' | 'purple';
}) {
  const bgColor = color === 'blue' ? 'bg-blue-50 border-blue-200' : 'bg-purple-50 border-purple-200';
  const textColor = color === 'blue' ? 'text-blue-700' : 'text-purple-700';

  return (
    <div className={`card p-6 border ${bgColor}`}>
      <h3 className={`text-lg font-semibold mb-4 ${textColor}`}>{title}</h3>
      <div className="space-y-3">
        <ComparisonStat
          label="Count"
          value={stats.total_events?.toLocaleString() || '0'}
        />
        <ComparisonStat
          label="Avg Latency"
          value={formatLatency(stats.avg_latency_us || 0)}
        />
        <ComparisonStat
          label="p95 Latency"
          value={formatLatency(stats.p95_latency_us || 0)}
        />
        <ComparisonStat
          label="False Positives"
          value={formatPercent(stats.false_positive_rate || null)}
        />
      </div>
    </div>
  );
}

function ComparisonStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center py-1">
      <span className="text-sm text-slate-600">{label}</span>
      <span className="font-semibold text-slate-900">{value}</span>
    </div>
  );
}
