import React from 'react';
import { MetricsEvent } from '../types/metrics';

interface EventInspectorProps {
  event: MetricsEvent | null;
}

export function EventInspector({ event }: EventInspectorProps) {
  if (!event) {
    return (
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="card p-6 bg-slate-50">
          <p className="text-slate-600">Select an event to view details</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      <div className="card p-6">
        <h3 className="text-lg font-bold text-slate-900 mb-4">
          Event #{event.query_id}
        </h3>
        <pre className="bg-slate-100 rounded p-4 text-xs overflow-auto max-h-60">
          {JSON.stringify(event, null, 2)}
        </pre>
      </div>
    </div>
  );
}
