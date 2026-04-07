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
    <div className="flex-1 flex items-center justify-center p-6 bg-white">
      <div className="max-w-md text-center space-y-4">
        <h1 className="text-xl font-semibold text-slate-900">
          This page hit an error
        </h1>
        <p className="text-sm text-slate-500">
          {error.message || "An unexpected error occurred while loading this page."}
        </p>
        {error.digest && (
          <p className="text-[11px] text-slate-400 font-['JetBrains_Mono']">
            digest: {error.digest}
          </p>
        )}
        <div className="flex gap-2 justify-center pt-2">
          <button
            type="button"
            onClick={reset}
            className="text-[13px] font-medium text-white bg-slate-900 hover:bg-slate-800 border-none rounded-lg px-4 py-2 cursor-pointer"
          >
            Try again
          </button>
          <Link
            href="/"
            className="text-[13px] font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg px-4 py-2 no-underline"
          >
            Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}
