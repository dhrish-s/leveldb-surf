import React from 'react';
import { Loader } from 'lucide-react';

export function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center py-12">
      <Loader className="w-8 h-8 animate-spin text-blue-600 mb-4" />
      <p className="text-slate-600">Loading metrics...</p>
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="bg-red-50 border border-red-200 rounded-lg p-6 max-w-md mx-auto">
      <h3 className="font-semibold text-red-900 mb-2">Error</h3>
      <p className="text-red-800">{message}</p>
    </div>
  );
}

export function EmptyState() {
  return (
    <div className="text-center py-12">
      <p className="text-slate-600 mb-2">No metrics data available</p>
      <p className="text-sm text-slate-500">
        Make sure the backend server is running and has loaded a metrics file.
      </p>
    </div>
  );
}
