import React from 'react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ComposedChart,
} from 'recharts';
import { Summary, MetricsEvent } from '../types/metrics';

interface ComparisonChartsProps {
  summary: Summary | null;
  events: MetricsEvent[];
}

export function ComparisonCharts({ summary, events }: ComparisonChartsProps) {
  if (!summary || events.length === 0) return null;

  const latencyByIndex = events.map((e, i) => ({
    index: i,
    latency: e.latency_us,
    filter: e.filter_type,
  }));

  const latencyByFilterType = Object.entries(summary.avg_latency_by_filter_type).map(([ft, lat]) => ({
    filter_type: ft,
    latency: lat,
  }));

  const eventsByQueryType = Object.entries(summary.count_by_query_type).map(([qt, count]) => ({
    query_type: qt,
    count,
  }));

  const eventsByBenchmark = Object.entries(summary.count_by_benchmark_name).map(([bn, count]) => ({
    benchmark_name: bn,
    count,
  }));

  const pruneData = [
    {
      type: 'Considered',
      count: summary.total_considered,
    },
    {
      type: 'Pruned',
      count: summary.total_pruned,
    },
    {
      type: 'Opened',
      count: summary.total_opened,
    },
  ];

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      <h2 className="text-2xl font-bold text-slate-900 mb-6">Analytics</h2>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
        {/* Latency over time */}
        <ChartCard title="Latency Over Event Index">
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={latencyByIndex.slice(-500)}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="index" stroke="#94a3b8" />
              <YAxis stroke="#94a3b8" />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#f8fafc',
                  border: '1px solid #e2e8f0',
                }}
              />
              <Legend />
              <Line
                dataKey="latency"
                stroke="#3b82f6"
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Latency by filter type */}
        <ChartCard title="Avg Latency by Filter Type">
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={latencyByFilterType}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="filter_type" stroke="#94a3b8" />
              <YAxis stroke="#94a3b8" />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#f8fafc',
                  border: '1px solid #e2e8f0',
                }}
              />
              <Bar dataKey="latency" fill="#3b82f6" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
        {/* Events by query type */}
        <ChartCard title="Event Count by Query Type">
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={eventsByQueryType}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="query_type" stroke="#94a3b8" angle={-45} textAnchor="end" height={80} />
              <YAxis stroke="#94a3b8" />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#f8fafc',
                  border: '1px solid #e2e8f0',
                }}
              />
              <Bar dataKey="count" fill="#8b5cf6" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Pruned vs Opened */}
        <ChartCard title="SSTable Filter Results">
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={pruneData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="type" stroke="#94a3b8" />
              <YAxis stroke="#94a3b8" />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#f8fafc',
                  border: '1px solid #e2e8f0',
                }}
              />
              <Bar dataKey="count" fill="#06b6d4" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 gap-8">
        {/* Events by benchmark */}
        <ChartCard title="Events by Benchmark">
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={eventsByBenchmark}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="benchmark_name" stroke="#94a3b8" angle={-45} textAnchor="end" height={80} />
              <YAxis stroke="#94a3b8" />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#f8fafc',
                  border: '1px solid #e2e8f0',
                }}
              />
              <Bar dataKey="count" fill="#10b981" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card p-6">
      <h3 className="text-lg font-semibold text-slate-900 mb-4">{title}</h3>
      {children}
    </div>
  );
}
