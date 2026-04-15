import { Skeleton } from "@/components/ui-system";

export default function Loading() {
  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
      {/* Header skeleton */}
      <div className="border-b border-[color:var(--border)] px-6 py-4 space-y-3">
        <Skeleton className="h-7 w-64" />
        <div className="flex gap-2">
          <Skeleton className="h-6 w-20" />
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-6 w-20" />
        </div>
        <div className="flex gap-6 pt-1">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-20" />
        </div>
      </div>
      {/* Tab bar skeleton */}
      <div className="border-b border-[color:var(--border)] px-6 py-2 flex gap-4">
        <Skeleton className="h-6 w-20" />
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-6 w-16" />
        <Skeleton className="h-6 w-16" />
      </div>
      {/* Content skeleton */}
      <div className="flex-1 p-6 space-y-4">
        <Skeleton className="h-24 w-full max-w-3xl mx-auto" />
        <Skeleton className="h-4 w-96" />
        <Skeleton className="h-4 w-80" />
      </div>
    </div>
  );
}
