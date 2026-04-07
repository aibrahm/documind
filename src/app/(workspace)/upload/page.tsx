"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Upload as UploadIcon,
  X,
  FileText,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ArrowRight,
  Sparkles,
  GitBranch,
  Copy,
  Link2,
  Plus,
} from "lucide-react";

// ============================================================
// TYPES — mirror /api/librarian/analyze response
// ============================================================

type Action = "new" | "version" | "duplicate" | "related";
type Classification = "PRIVATE" | "PUBLIC" | "DOCTRINE";

interface RelatedDoc {
  documentId: string;
  title: string;
  type: string;
  classification: string;
  createdAt: string;
  similarity: number;
  reason: string;
  isCurrent: boolean;
  versionNumber: number;
}

interface SuggestedProject {
  id: string;
  slug: string;
  name: string;
  color: string | null;
  overlapCount: number;
  reason: string;
}

interface Proposal {
  detected: {
    title: string;
    suggestedTitle: string;
    documentType: string;
    language: "ar" | "en" | "mixed";
    pageCount: number;
    fileSize: number;
    suggestedClassification: Classification;
    classificationReason: string;
    entities: Array<{ name: string; type: string; nameEn?: string }>;
    firstPagePreview: string;
  };
  related: RelatedDoc[];
  recommendation: {
    action: Action;
    reason: string;
    targetDocumentId?: string;
    confidence: "high" | "medium" | "low";
  };
  suggestedProject?: SuggestedProject | null;
}

type Stage = "idle" | "analyzing" | "review" | "uploading" | "done" | "error";

// ============================================================
// CONSTANTS
// ============================================================

const CLASS_COPY: Record<Classification, { label: string; description: string; dot: string }> = {
  PRIVATE: {
    label: "Private",
    description: "Sensitive. Encrypted at rest. Default for memos, drafts, financial proposals.",
    dot: "bg-rose-500",
  },
  PUBLIC: {
    label: "Public",
    description: "Open information. Default for published laws, decrees, official reports.",
    dot: "bg-blue-500",
  },
  DOCTRINE: {
    label: "Doctrine",
    description: "Foundational. Always-on context for every analysis. Use sparingly.",
    dot: "bg-emerald-500",
  },
};

const ACTION_COPY: Record<Action, { icon: typeof Plus; label: string; color: string }> = {
  new: { icon: Plus, label: "Add as new document", color: "text-emerald-600" },
  version: { icon: GitBranch, label: "Add as new version", color: "text-blue-600" },
  duplicate: { icon: Copy, label: "Skip — duplicate", color: "text-amber-600" },
  related: { icon: Link2, label: "Add and link as related", color: "text-violet-600" },
};

function formatRelative(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  const diffDays = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ============================================================
// PAGE
// ============================================================

export default function UploadPage() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // User overrides
  const [chosenAction, setChosenAction] = useState<Action>("new");
  const [chosenClassification, setChosenClassification] = useState<Classification>("PRIVATE");
  const [chosenTitle, setChosenTitle] = useState("");
  const [chosenTargetId, setChosenTargetId] = useState<string | null>(null);
  // Phase 07: link-to-project toggle (set from librarian suggestion)
  const [linkToProjectId, setLinkToProjectId] = useState<string | null>(null);

  // Recent uploads sidebar
  const [recentDocs, setRecentDocs] = useState<
    Array<{ id: string; title: string; classification: string; created_at: string }>
  >([]);

  const loadRecent = useCallback(() => {
    fetch("/api/documents")
      .then((r) => r.json())
      .then((d) =>
        setRecentDocs(
          (d.documents || [])
            .filter((dd: { status: string }) => dd.status === "ready")
            .slice(0, 5),
        ),
      )
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadRecent();
  }, [loadRecent]);

  // ── Analyze step ──
  const analyzeFile = useCallback(async (f: File) => {
    setFile(f);
    setStage("analyzing");
    setError(null);
    setProposal(null);

    try {
      const fd = new FormData();
      fd.append("file", f);
      const res = await fetch("/api/librarian/analyze", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Analysis failed");
      const p: Proposal = data.proposal;
      setProposal(p);
      setChosenAction(p.recommendation.action);
      setChosenClassification(p.detected.suggestedClassification);
      setChosenTitle(p.detected.suggestedTitle);
      setChosenTargetId(p.recommendation.targetDocumentId || null);
      // Phase 07: default to linking when the librarian found a project match
      setLinkToProjectId(p.suggestedProject?.id || null);
      setStage("review");
    } catch (e) {
      setError((e as Error).message);
      setStage("error");
    }
  }, []);

  // ── File input ──
  const handleFiles = useCallback(
    (files: File[]) => {
      const pdf = files.find((f) => f.type === "application/pdf");
      if (!pdf) {
        setError("Please drop a PDF file");
        return;
      }
      if (pdf.size > 50 * 1024 * 1024) {
        setError("File exceeds 50 MB limit");
        return;
      }
      setError(null);
      analyzeFile(pdf);
    },
    [analyzeFile],
  );

  // ── Confirm step ──
  const confirmUpload = useCallback(async () => {
    if (!file || !proposal) return;
    setStage("uploading");
    setError(null);

    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("classification", chosenClassification);
      fd.append("title", chosenTitle);
      if (chosenAction === "version" && chosenTargetId) fd.append("versionOf", chosenTargetId);
      if (chosenAction === "related" && chosenTargetId) fd.append("relatedTo", chosenTargetId);
      if (linkToProjectId) fd.append("linkToProject", linkToProjectId);

      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Upload failed");
      setStage("done");
      loadRecent();
    } catch (e) {
      setError((e as Error).message);
      setStage("error");
    }
  }, [file, proposal, chosenAction, chosenClassification, chosenTitle, chosenTargetId, loadRecent]);

  const handleDuplicateSkip = useCallback(() => {
    if (!chosenTargetId) return;
    router.push(`/documents/${chosenTargetId}`);
  }, [chosenTargetId, router]);

  const reset = useCallback(() => {
    setStage("idle");
    setFile(null);
    setProposal(null);
    setError(null);
    setChosenAction("new");
    setChosenClassification("PRIVATE");
    setChosenTitle("");
    setChosenTargetId(null);
  }, []);

  return (
    <div className="flex flex-1 flex-col bg-white overflow-hidden">
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-10">
          <h1 className="text-[28px] font-semibold text-slate-900 tracking-tight">
            Add to knowledge base
          </h1>
          <p className="text-[14px] text-slate-500 mt-1 mb-2">
            The librarian analyzes each document, finds related ones, and proposes how to file it.
          </p>
          <p className="text-[12px] text-slate-400 mb-8">
            Just want to discuss one file?{" "}
            <button
              type="button"
              onClick={() => router.push("/")}
              className="text-slate-500 hover:text-slate-900 underline underline-offset-2 bg-transparent border-none cursor-pointer p-0 text-[12px]"
            >
              Drop it directly into chat
            </button>{" "}
            instead — it stays scoped to that conversation.
          </p>

          {/* ────── STAGE: idle ────── */}
          {stage === "idle" && (
            <>
              <DropZone
                dragOver={dragOver}
                setDragOver={setDragOver}
                onFiles={handleFiles}
              />
              {error && <ErrorBanner message={error} />}
              {recentDocs.length > 0 && (
                <RecentSidebar docs={recentDocs} onClick={(id) => router.push(`/documents/${id}`)} />
              )}
            </>
          )}

          {/* ────── STAGE: analyzing ────── */}
          {stage === "analyzing" && file && (
            <AnalyzingCard fileName={file.name} fileSize={file.size} />
          )}

          {/* ────── STAGE: review ────── */}
          {stage === "review" && proposal && file && (
            <ReviewCard
              file={file}
              proposal={proposal}
              chosenAction={chosenAction}
              setChosenAction={setChosenAction}
              chosenClassification={chosenClassification}
              setChosenClassification={setChosenClassification}
              chosenTitle={chosenTitle}
              setChosenTitle={setChosenTitle}
              chosenTargetId={chosenTargetId}
              setChosenTargetId={setChosenTargetId}
              linkToProjectId={linkToProjectId}
              setLinkToProjectId={setLinkToProjectId}
              onConfirm={confirmUpload}
              onSkipDuplicate={handleDuplicateSkip}
              onCancel={reset}
            />
          )}

          {/* ────── STAGE: uploading ────── */}
          {stage === "uploading" && file && (
            <UploadingCard fileName={chosenTitle || file.name} />
          )}

          {/* ────── STAGE: done ────── */}
          {stage === "done" && file && (
            <DoneCard
              title={chosenTitle || file.name}
              onAskAbout={() => router.push("/")}
              onViewAll={() => router.push("/documents")}
              onUploadMore={reset}
            />
          )}

          {/* ────── STAGE: error ────── */}
          {stage === "error" && (
            <>
              <ErrorBanner message={error || "Something went wrong"} />
              <button
                type="button"
                onClick={reset}
                className="mt-3 text-[12px] font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 cursor-pointer"
              >
                Try again
              </button>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

// ============================================================
// SUBCOMPONENTS
// ============================================================

function DropZone({
  dragOver,
  setDragOver,
  onFiles,
}: {
  dragOver: boolean;
  setDragOver: (b: boolean) => void;
  onFiles: (files: File[]) => void;
}) {
  return (
    <div
      onClick={() => document.getElementById("file-input")?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        onFiles(Array.from(e.dataTransfer.files));
      }}
      className={`border-2 border-dashed rounded-xl p-14 text-center cursor-pointer transition-all ${
        dragOver
          ? "border-slate-900 bg-slate-50 scale-[1.01]"
          : "border-slate-200 bg-slate-50/50 hover:border-slate-300 hover:bg-slate-50"
      }`}
    >
      <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-white border border-slate-200 flex items-center justify-center shadow-sm">
        <UploadIcon className="w-5 h-5 text-slate-400" />
      </div>
      <p className="text-[14px] font-medium text-slate-900 mb-1">Drop a PDF to get started</p>
      <p className="text-[12px] text-slate-400">Up to 50 MB</p>
      <input
        id="file-input"
        type="file"
        accept=".pdf"
        className="hidden"
        onChange={(e) => onFiles(Array.from(e.target.files || []))}
      />
    </div>
  );
}

function AnalyzingCard({ fileName, fileSize }: { fileName: string; fileSize: number }) {
  return (
    <div className="border border-slate-200 rounded-xl p-6 bg-white">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-slate-800 to-slate-600 flex items-center justify-center">
          <Sparkles className="w-5 h-5 text-white" />
        </div>
        <div>
          <p className="text-[14px] font-semibold text-slate-900">Librarian</p>
          <p className="text-[12px] text-slate-400">Analyzing your document...</p>
        </div>
      </div>
      <div className="flex items-center gap-3 px-3 py-2.5 bg-slate-50 rounded-lg">
        <Loader2 className="w-4 h-4 text-slate-400 animate-spin shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[13px] text-slate-700 truncate" dir="auto">
            {fileName}
          </p>
          <p className="font-['JetBrains_Mono'] text-[10px] text-slate-400">
            {formatBytes(fileSize)}
          </p>
        </div>
      </div>
    </div>
  );
}

function ReviewCard({
  file,
  proposal,
  chosenAction,
  setChosenAction,
  chosenClassification,
  setChosenClassification,
  chosenTitle,
  setChosenTitle,
  chosenTargetId,
  setChosenTargetId,
  linkToProjectId,
  setLinkToProjectId,
  onConfirm,
  onSkipDuplicate,
  onCancel,
}: {
  file: File;
  proposal: Proposal;
  chosenAction: Action;
  setChosenAction: (a: Action) => void;
  chosenClassification: Classification;
  setChosenClassification: (c: Classification) => void;
  chosenTitle: string;
  setChosenTitle: (t: string) => void;
  chosenTargetId: string | null;
  setChosenTargetId: (id: string | null) => void;
  linkToProjectId: string | null;
  setLinkToProjectId: (id: string | null) => void;
  onConfirm: () => void;
  onSkipDuplicate: () => void;
  onCancel: () => void;
}) {
  const { detected, related, recommendation, suggestedProject } = proposal;
  const RecommendedIcon = ACTION_COPY[recommendation.action].icon;

  return (
    <div className="space-y-4">
      {/* Librarian header */}
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-slate-800 to-slate-600 flex items-center justify-center shrink-0">
          <Sparkles className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1">
          <p className="text-[14px] font-semibold text-slate-900 mb-1">Librarian</p>
          <p className="text-[13px] text-slate-600 leading-relaxed">
            {recommendation.reason}
          </p>
        </div>
      </div>

      {/* Detected card */}
      <div className="border border-slate-200 rounded-xl overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 bg-slate-50/50 border-b border-slate-100">
          <FileText className="w-4 h-4 text-slate-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[13px] text-slate-900 truncate" dir="auto">
              {file.name}
            </p>
            <p className="font-['JetBrains_Mono'] text-[10px] text-slate-400">
              {detected.pageCount} {detected.pageCount === 1 ? "page" : "pages"} ·{" "}
              {formatBytes(detected.fileSize)} · {detected.language.toUpperCase()}
            </p>
          </div>
        </div>

        <div className="px-4 py-4 space-y-4">
          {/* Title */}
          <div>
            <label className="font-['JetBrains_Mono'] text-[10px] font-semibold uppercase tracking-wider text-slate-400 block mb-1.5">
              Title
            </label>
            <input
              type="text"
              value={chosenTitle}
              onChange={(e) => setChosenTitle(e.target.value)}
              dir="auto"
              className="w-full font-['IBM_Plex_Sans_Arabic'] text-[14px] text-slate-900 bg-white border border-slate-200 rounded-lg px-3 py-2 focus:border-slate-400 focus:outline-none"
            />
          </div>

          {/* Type + entities */}
          <div className="flex flex-wrap items-start gap-x-6 gap-y-3 text-[12px]">
            <div>
              <p className="font-['JetBrains_Mono'] text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
                Type
              </p>
              <span className="font-['JetBrains_Mono'] text-[11px] uppercase text-slate-700">
                {detected.documentType}
              </span>
            </div>
            {detected.entities.length > 0 && (
              <div className="flex-1 min-w-0">
                <p className="font-['JetBrains_Mono'] text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
                  Detected entities
                </p>
                <div className="flex flex-wrap gap-1">
                  {detected.entities.slice(0, 8).map((e, i) => (
                    <span
                      key={i}
                      className="text-[11px] text-slate-600 bg-slate-50 border border-slate-100 rounded px-1.5 py-0.5 font-['IBM_Plex_Sans_Arabic']"
                      dir="auto"
                    >
                      {e.name}
                    </span>
                  ))}
                  {detected.entities.length > 8 && (
                    <span className="text-[11px] text-slate-400">
                      +{detected.entities.length - 8} more
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Classification picker */}
          <div>
            <label className="font-['JetBrains_Mono'] text-[10px] font-semibold uppercase tracking-wider text-slate-400 block mb-1.5">
              Classification
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(CLASS_COPY) as Classification[]).map((c) => {
                const isActive = chosenClassification === c;
                const meta = CLASS_COPY[c];
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setChosenClassification(c)}
                    className={`text-left px-3 py-2 rounded-lg border transition-all cursor-pointer ${
                      isActive
                        ? "bg-slate-50 border-slate-300 shadow-sm"
                        : "bg-white border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
                      <span className="text-[12px] font-medium text-slate-900">{meta.label}</span>
                    </div>
                    <p className="text-[10px] text-slate-500 leading-snug">{meta.description}</p>
                  </button>
                );
              })}
            </div>
            {detected.classificationReason && (
              <p className="text-[11px] text-slate-400 mt-1.5">
                Suggested: <span className="text-slate-600">{detected.classificationReason}</span>
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Phase 07: project suggestion pill */}
      {suggestedProject && (
        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 bg-slate-50/50 border-b border-slate-100">
            <p className="font-['JetBrains_Mono'] text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Project match
            </p>
          </div>
          <div className="px-4 py-3 flex items-center gap-3">
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ background: suggestedProject.color || "#64748B" }}
            />
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-medium text-slate-900 truncate">
                {suggestedProject.name}
              </p>
              <p className="text-[11px] text-slate-500">
                {suggestedProject.reason}
              </p>
            </div>
            <label className="flex items-center gap-1.5 cursor-pointer text-[12px] text-slate-700">
              <input
                type="checkbox"
                checked={linkToProjectId === suggestedProject.id}
                onChange={(e) =>
                  setLinkToProjectId(e.target.checked ? suggestedProject.id : null)
                }
                className="w-4 h-4 cursor-pointer"
              />
              Link on confirm
            </label>
          </div>
        </div>
      )}

      {/* Related documents */}
      {related.length > 0 && (
        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 bg-slate-50/50 border-b border-slate-100">
            <p className="font-['JetBrains_Mono'] text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Related documents in your KB
            </p>
          </div>
          <div className="divide-y divide-slate-100">
            {related.map((r) => {
              const isTarget = chosenTargetId === r.documentId;
              return (
                <button
                  key={r.documentId}
                  type="button"
                  onClick={() => setChosenTargetId(isTarget ? null : r.documentId)}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors cursor-pointer border-none ${
                    isTarget ? "bg-blue-50/50" : "bg-transparent hover:bg-slate-50"
                  }`}
                >
                  <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] text-slate-900 truncate" dir="auto">
                      {r.title}
                    </p>
                    <p className="font-['JetBrains_Mono'] text-[10px] text-slate-400">
                      {r.type} · {r.classification} · v{r.versionNumber}
                      {!r.isCurrent ? " (old)" : ""} · {formatRelative(r.createdAt)} · {r.reason}
                    </p>
                  </div>
                  <span className="font-['JetBrains_Mono'] text-[10px] text-slate-400 shrink-0">
                    {(r.similarity * 100).toFixed(0)}%
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Action picker */}
      <div className="border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 bg-slate-50/50 border-b border-slate-100">
          <p className="font-['JetBrains_Mono'] text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Action
          </p>
        </div>
        <div className="px-4 py-3 space-y-1">
          {(Object.keys(ACTION_COPY) as Action[]).map((a) => {
            const meta = ACTION_COPY[a];
            const Icon = meta.icon;
            const isActive = chosenAction === a;
            const isRecommended = a === recommendation.action;
            // Action validity: version/duplicate/related need a target
            const requiresTarget = a !== "new";
            const isDisabled = requiresTarget && !chosenTargetId;
            return (
              <button
                key={a}
                type="button"
                onClick={() => !isDisabled && setChosenAction(a)}
                disabled={isDisabled}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left border transition-all cursor-pointer ${
                  isActive
                    ? "bg-slate-50 border-slate-300"
                    : isDisabled
                      ? "bg-transparent border-transparent opacity-40 cursor-not-allowed"
                      : "bg-transparent border-transparent hover:bg-slate-50"
                }`}
              >
                <Icon className={`w-4 h-4 shrink-0 ${meta.color}`} />
                <span className="flex-1 text-[13px] text-slate-700">{meta.label}</span>
                {isRecommended && (
                  <span className="font-['JetBrains_Mono'] text-[9px] uppercase tracking-wider text-slate-400">
                    Recommended
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {chosenAction !== "new" && !chosenTargetId && (
          <div className="px-4 py-2 bg-amber-50/50 border-t border-amber-100 text-[11px] text-amber-700">
            Pick a related document above first.
          </div>
        )}
      </div>

      {/* Submit row */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="text-[13px] font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg px-4 py-2 cursor-pointer"
        >
          Cancel
        </button>
        {chosenAction === "duplicate" ? (
          <button
            type="button"
            onClick={onSkipDuplicate}
            disabled={!chosenTargetId}
            className="flex-1 flex items-center justify-center gap-2 text-[13px] font-medium text-white bg-amber-600 hover:bg-amber-700 border-none rounded-lg px-4 py-2 cursor-pointer disabled:opacity-50"
          >
            Open the existing document
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        ) : (
          <button
            type="button"
            onClick={onConfirm}
            disabled={chosenAction !== "new" && !chosenTargetId}
            className="flex-1 flex items-center justify-center gap-2 text-[13px] font-medium text-white bg-slate-900 hover:bg-slate-800 border-none rounded-lg px-4 py-2 cursor-pointer disabled:opacity-50"
          >
            Confirm and process
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

function UploadingCard({ fileName }: { fileName: string }) {
  return (
    <div className="border border-slate-200 rounded-xl p-6">
      <div className="flex items-center gap-3 mb-3">
        <Loader2 className="w-4 h-4 text-slate-400 animate-spin" />
        <p className="text-[14px] font-medium text-slate-900">Processing</p>
      </div>
      <p className="text-[13px] text-slate-600 mb-1" dir="auto">
        {fileName}
      </p>
      <p className="text-[12px] text-slate-400">
        Running full extraction with vision OCR. This usually takes 30–90 seconds.
      </p>
    </div>
  );
}

function DoneCard({
  title,
  onAskAbout,
  onViewAll,
  onUploadMore,
}: {
  title: string;
  onAskAbout: () => void;
  onViewAll: () => void;
  onUploadMore: () => void;
}) {
  return (
    <div className="border border-emerald-200 bg-emerald-50/30 rounded-xl p-5">
      <div className="flex items-start gap-3 mb-4">
        <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="text-[14px] font-semibold text-slate-900 mb-0.5">Added to knowledge base</p>
          <p className="text-[13px] text-slate-700 truncate" dir="auto">
            {title}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onAskAbout}
          className="flex items-center gap-1.5 text-[13px] font-medium text-white bg-slate-900 hover:bg-slate-800 border-none rounded-lg px-3 py-1.5 cursor-pointer"
        >
          Ask DocuMind about it
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={onViewAll}
          className="text-[13px] font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 cursor-pointer"
        >
          View all documents
        </button>
        <button
          type="button"
          onClick={onUploadMore}
          className="text-[13px] font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 cursor-pointer"
        >
          Upload another
        </button>
      </div>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 text-[13px] text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
      <AlertCircle className="w-4 h-4 shrink-0" />
      {message}
    </div>
  );
}

function RecentSidebar({
  docs,
  onClick,
}: {
  docs: Array<{ id: string; title: string; classification: string; created_at: string }>;
  onClick: (id: string) => void;
}) {
  return (
    <div className="mt-8">
      <p className="font-['JetBrains_Mono'] text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-3">
        Recently added
      </p>
      <div className="space-y-1">
        {docs.map((d) => (
          <button
            key={d.id}
            type="button"
            onClick={() => onClick(d.id)}
            className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-slate-50 border border-transparent hover:border-slate-200 transition-all cursor-pointer bg-transparent text-left"
          >
            <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span className="flex-1 text-[12px] text-slate-700 truncate" dir="auto">
              {d.title}
            </span>
            <span className="font-['JetBrains_Mono'] text-[9px] text-slate-400 uppercase">
              {d.classification}
            </span>
            <X
              className="w-3 h-3 text-transparent"
              aria-hidden
            />
          </button>
        ))}
      </div>
    </div>
  );
}
