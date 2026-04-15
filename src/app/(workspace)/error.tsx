"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function WorkspaceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Workspace error boundary:", error);
  }, [error]);

  return (
    <div className="flex-1 flex items-center justify-center p-6 bg-[color:var(--surface-raised)]">
      <div className="max-w-md text-center space-y-4">
        <h1 className="text-xl font-semibold text-[color:var(--ink)]">
          This page hit an error
        </h1>
        <p className="text-sm text-[color:var(--ink-muted)]">
          {error.message || "An unexpected error occurred while loading this page."}
        </p>
        {error.digest && (
          <p className="text-[11px] text-[color:var(--ink-ghost)] font-['JetBrains_Mono']">
            digest: {error.digest}
          </p>
        )}
        <div className="flex gap-2 justify-center pt-2">
          <button
            type="button"
            onClick={reset}
            className="text-[13px] font-medium text-white bg-[color:var(--ink)] hover:bg-[color:var(--ink-strong)] border-none rounded-lg px-4 py-2 cursor-pointer"
          >
            Try again
          </button>
          <Link
            href="/"
            className="text-[13px] font-medium text-[color:var(--ink)] bg-[color:var(--surface-raised)] hover:bg-[color:var(--surface-sunken)] border border-[color:var(--border)] rounded-lg px-4 py-2 no-underline"
          >
            Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}
