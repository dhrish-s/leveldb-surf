import React, { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { FilterBar } from './components/FilterBar';
import { SummaryCards } from './components/SummaryCards';
import { ComparisonCharts } from './components/ComparisonCharts';
import { EventTable } from './components/EventTable';
import { EventInspector } from './components/EventInspector';
import { LoadingState, ErrorState, EmptyState } from './components/LoadingState';
import { fetchMeta, fetchSummary, fetchEvents, fetchHealth } from './lib/api';
import { Meta, Summary, MetricsEvent, FilterState } from './types/metrics';
import './index.css';

function App() {
  const [health, setHealth] = useState(false);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [events, setEvents] = useState<MetricsEvent[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<MetricsEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterState>({
    filter_type: 'all',
    query_type: 'all',
    benchmark_name: 'all',
    limit: 500,
  });

  // Initial load and polling
  useEffect(() => {
    async function loadData() {
      try {
        setError(null);
        
        // Check health first
        const isHealthy = await fetchHealth();
        if (!isHealthy) {
          setError('Backend server not responding. Make sure it is running on http://localhost:3001');
          setLoading(false);
          return;
        }
        setHealth(true);

        // Fetch all data in parallel
        const [metaData, summaryData, eventsData] = await Promise.all([
          fetchMeta(),
          fetchSummary(),
          fetchEvents(filters),
        ]);

        setMeta(metaData);
        setSummary(summaryData);
        setEvents(eventsData);
        setLoading(false);
      } catch (err) {
        console.error('Error loading data:', err);
        setError('Failed to load metrics. Check the console for details.');
        setLoading(false);
      }
    }

    loadData();

    // Poll every 2 seconds
    const interval = setInterval(loadData, 2000);
    return () => clearInterval(interval);
  }, [filters]);

  const handleFilterChange = (newFilters: FilterState) => {
    setFilters(newFilters);
    setSelectedEvent(null);
  };

  if (!health) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
        <Header meta={null} />
        <div className="max-w-7xl mx-auto px-6 py-12">
          <ErrorState message="Backend server not responding. Make sure it is running on http://localhost:3001" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <Header meta={meta} />
      <FilterBar meta={meta} filters={filters} onFilterChange={handleFilterChange} />

      {loading && (
        <div className="max-w-7xl mx-auto px-6 py-12">
          <LoadingState />
        </div>
      )}

      {error && (
        <div className="max-w-7xl mx-auto px-6 py-12">
          <ErrorState message={error} />
        </div>
      )}

      {!loading && !error && (
        <>
          {summary && events.length > 0 ? (
            <>
              <SummaryCards summary={summary} events={events} />
              <ComparisonCharts summary={summary} events={events} />
              <EventTable events={events} onSelectEvent={setSelectedEvent} />
              {selectedEvent && <EventInspector event={selectedEvent} />}
            </>
          ) : (
            <div className="max-w-7xl mx-auto px-6 py-12">
              <EmptyState />
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default App;
