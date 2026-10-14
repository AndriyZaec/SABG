import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

const ErrorToastContext = createContext<((message: string) => void) | null>(null);

export function ErrorToastProvider({ children }: { children: ReactNode }) {
  const [error, setError] = useState<{ message: string } | null>(null);
  const showError = useCallback((message: string) => setError({ message }), []);

  useEffect(() => {
    if (error === null) return;
    const timeout = window.setTimeout(() => setError(null), 5_000);
    return () => window.clearTimeout(timeout);
  }, [error]);

  return (
    <ErrorToastContext.Provider value={showError}>
      {children}
      <div className="nb-error-toast-region" role="alert" aria-atomic="true">
        {error !== null && (
          <div className="nb-error-toast">
            <p className="nb-error-toast__message">{error.message}</p>
            <button
              className="nb-error-toast__close"
              type="button"
              aria-label="Dismiss error"
              onClick={() => setError(null)}
            >
              ×
            </button>
          </div>
        )}
      </div>
    </ErrorToastContext.Provider>
  );
}

export function useErrorToast(): { showError: (message: string) => void } {
  const showError = useContext(ErrorToastContext);
  if (showError === null) throw new Error("useErrorToast must be used within ErrorToastProvider");
  return { showError };
}
