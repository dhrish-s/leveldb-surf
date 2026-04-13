import React from 'react';
import { Meta, FilterState } from '../types/metrics';
import { Filter } from 'lucide-react';

interface FilterBarProps {
  meta: Meta | null;
  filters: FilterState;
  onFilterChange: (filters: FilterState) => void;
}

export function FilterBar({ meta, filters, onFilterChange }: FilterBarProps) {
  if (!meta) return null;

  const updateFilter = (key: keyof FilterState, value: string | number) => {
    onFilterChange({ ...filters, [key]: value });
  };

  return (
    <div className="bg-white border-b border-slate-200">
      <div className="max-w-7xl mx-auto px-6 py-4">
        <div className="flex items-center gap-2 mb-3">
          <Filter className="w-5 h-5 text-slate-600" />
          <h2 className="font-semibold text-slate-700">Filters</h2>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">
              Filter Type
            </label>
            <select
              value={filters.filter_type}
              onChange={(e) => updateFilter('filter_type', e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All</option>
              {meta.available_filter_types.map((ft) => (
                <option key={ft} value={ft}>
                  {ft.charAt(0).toUpperCase() + ft.slice(1)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">
              Query Type
            </label>
            <select
              value={filters.query_type}
              onChange={(e) => updateFilter('query_type', e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All</option>
              {meta.available_query_types.map((qt) => (
                <option key={qt} value={qt}>
                  {qt}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">
              Benchmark
            </label>
            <select
              value={filters.benchmark_name}
              onChange={(e) => updateFilter('benchmark_name', e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All</option>
              {meta.available_benchmark_names.map((bn) => (
                <option key={bn} value={bn}>
                  {bn}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">
              Limit
            </label>
            <select
              value={filters.limit}
              onChange={(e) => updateFilter('limit', parseInt(e.target.value))}
              className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value={100}>100</option>
              <option value={500}>500</option>
              <option value={1000}>1000</option>
              <option value={10000}>10000</option>
              <option value={999999}>All</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}
