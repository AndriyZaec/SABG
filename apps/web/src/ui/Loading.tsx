/** Minimal loading indicator used for Suspense fallbacks and async states. */
export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <p role="status" aria-live="polite" style={{ opacity: 0.7 }}>
      {label}
    </p>
  );
}
