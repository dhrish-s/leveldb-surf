import React from 'react';
import { TrendingUp } from 'lucide-react';
import { Meta } from '../types/metrics';

interface HeaderProps {
  meta: Meta | null;
}

export function Header({ meta }: HeaderProps) {
  return (
    <div className="bg-white border-b border-slate-200 shadow-sm">
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="flex items-center gap-3 mb-2">
          <TrendingUp className="w-8 h-8 text-blue-600" />
          <h1 className="text-3xl font-bold text-slate-900">
            LevelDB Metrics Dashboard
          </h1>
        </div>
        <p className="text-slate-600 mb-4">
          Bloom vs SuRF Filter Performance Comparison
        </p>
        {meta && (
          <div className="text-sm text-slate-500">
            <p>File: {meta.metrics_file}</p>
            <p>Events: {meta.total_events.toLocaleString()} | Last updated: {new Date(meta.server_time).toLocaleTimeString()}</p>
          </div>
        )}
      </div>
    </div>
  );
}
