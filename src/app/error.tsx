'use client';

import { useEffect } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log the error to the console so the user can see it in DevTools
    console.error('Root Error Boundary caught an error:', error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center animate-fade-in">
      <div className="bg-red-50 p-4 rounded-full mb-6">
        <AlertTriangle size={48} className="text-red-500" />
      </div>
      <h2 className="text-2xl font-bold text-slate-900 mb-2">Something went wrong</h2>
      <p className="text-slate-500 max-w-md mb-8">
        The application encountered a runtime error. This could be due to a hydration mismatch or a missing configuration.
      </p>
      
      {error.message && (
        <div className="bg-slate-100 p-4 rounded-lg mb-8 max-w-2xl w-full text-left overflow-auto">
          <p className="text-xs font-mono text-slate-800 break-words">
            {error.message}
          </p>
          {error.digest && (
            <p className="text-[10px] font-mono text-slate-400 mt-2">
              Error ID: {error.digest}
            </p>
          )}
        </div>
      )}

      <div className="flex gap-4">
        <button
          onClick={() => reset()}
          className="premium-button premium-button-primary gap-2 h-11 px-8"
        >
          <RotateCcw size={18} /> Try Again
        </button>
        <button
          onClick={() => window.location.reload()}
          className="premium-button premium-button-secondary h-11 px-8"
        >
          Hard Reload
        </button>
      </div>
    </div>
  );
}
