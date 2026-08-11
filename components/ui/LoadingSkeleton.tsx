export function LoadingSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-3 p-4" aria-hidden="true">
      {Array.from({ length: rows }).map((_, index) => (
        <div
          key={index}
          className="animate-pulse rounded-md border border-border bg-surface-muted px-3 py-3"
        >
          <div className="h-3 w-24 rounded bg-border" />
          <div className="mt-3 h-3 w-2/3 rounded bg-border" />
          <div className="mt-2 h-3 w-1/2 rounded bg-border" />
        </div>
      ))}
    </div>
  );
}
