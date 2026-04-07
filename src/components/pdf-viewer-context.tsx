"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { FileText, X } from "lucide-react";

interface PdfState {
  url: string;
  page: number;
  title: string;
}

interface PdfViewerContextValue {
  openPdf: (state: PdfState) => void;
  closePdf: () => void;
  /** Convenience: opens a PDF from a document id by hitting /api/documents/[id]/url */
  openDocument: (documentId: string, page: number, title: string) => Promise<void>;
}

const PdfViewerContext = createContext<PdfViewerContextValue | null>(null);

export function usePdfViewer(): PdfViewerContextValue {
  const ctx = useContext(PdfViewerContext);
  if (!ctx) {
    throw new Error("usePdfViewer must be used inside <PdfViewerProvider>");
  }
  return ctx;
}

/**
 * Provider that lives at the workspace layout level. Renders the PDF panel
 * as a fixed right sidebar overlaying any page within (workspace). Pages can
 * call usePdfViewer().openDocument(...) from anywhere.
 */
export function PdfViewerProvider({ children }: { children: ReactNode }) {
  const [pdf, setPdf] = useState<PdfState | null>(null);

  const openPdf = useCallback((state: PdfState) => {
    setPdf(state);
  }, []);

  const closePdf = useCallback(() => {
    setPdf(null);
  }, []);

  const openDocument = useCallback(
    async (documentId: string, page: number, title: string) => {
      try {
        const res = await fetch(`/api/documents/${documentId}/url`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (data.url) {
          setPdf({ url: data.url, page, title });
        }
      } catch (err) {
        console.error("openDocument failed:", err);
      }
    },
    [],
  );

  return (
    <PdfViewerContext.Provider value={{ openPdf, closePdf, openDocument }}>
      <div className="flex-1 flex min-w-0 overflow-hidden">
        <div className="flex-1 min-w-0 overflow-hidden">{children}</div>
        {pdf && (
          <div className="w-[480px] shrink-0 border-l border-slate-200 bg-white flex flex-col">
            <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                <span
                  className="text-sm text-slate-700 truncate"
                  dir="auto"
                  title={pdf.title}
                >
                  {pdf.title}
                </span>
                <span className="font-['JetBrains_Mono'] text-[10px] text-slate-400 shrink-0">
                  p.{pdf.page}
                </span>
              </div>
              <button
                type="button"
                onClick={closePdf}
                className="text-slate-400 hover:text-slate-700 bg-transparent border-none cursor-pointer p-1"
                title="Close PDF viewer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1">
              <iframe
                src={`${pdf.url}#page=${pdf.page}`}
                className="w-full h-full border-none"
                title={pdf.title}
              />
            </div>
          </div>
        )}
      </div>
    </PdfViewerContext.Provider>
  );
}
