"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Copy,
  FileText,
  FolderOpen,
  GitBranch,
  Library,
  Link2,
  Loader2,
  Plus,
  Sparkles,
  Upload as UploadIcon,
} from "lucide-react";
import { CreateProjectDialog } from "@/components/create-project-dialog";
import {
  DOCUMENT_TYPES,
  type DocumentType,
  type LanguageCode,
} from "@/lib/extraction-schema";

type Action = "new" | "version" | "duplicate" | "related";
type Classification = "PRIVATE" | "PUBLIC" | "DOCTRINE";
type Stage = "idle" | "analyzing" | "review" | "uploading" | "done" | "error";
type DocumentTypeChoice = DocumentType | "auto";
type PlacementMode = "library" | "project";

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
    language: LanguageCode;
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
  suggestedProjects?: SuggestedProject[];
}

interface ProjectOption {
  id: string;
  slug: string;
  name: string;
  color: string | null;
  context_summary?: string | null;
}

const ACTION_COPY: Record<
  Action,
  { label: string; description: string; icon: typeof Plus }
> = {
  new: {
    label: "Add as a new document",
    description: "Keep this as a distinct source in your library.",
    icon: Plus,
  },
  version: {
    label: "Add as a new version",
    description: "Use this when it replaces or supersedes an existing document.",
    icon: GitBranch,
  },
  duplicate: {
    label: "Skip and use the existing document",
    description: "Use this when the upload is effectively the same file again.",
    icon: Copy,
  },
  related: {
    label: "Add and link as related",
    description: "Keep this as a separate source but note the overlap.",
    icon: Link2,
  },
};

const CLASSIFICATION_LABELS: Record<Classification, string> = {
  PRIVATE: "Private",
  PUBLIC: "Public",
  DOCTRINE: "Doctrine",
};

const DOCUMENT_TYPE_COPY: Record<DocumentType, string> = {
  law: "Law / statute",
  decree: "Decree / official decision",
  contract: "Contract",
  mou: "MoU",
  report: "Report",
  memo: "Memo",
  policy: "Policy",
  letter: "Letter",
  financial: "Financial",
  other: "Other",
};

function normalizeDetectedDocumentType(value: string): DocumentType | null {
  return DOCUMENT_TYPES.includes(value as DocumentType) ? (value as DocumentType) : null;
}

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

export default function UploadPage() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [storagePath, setStoragePath] = useState<string | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const [chosenAction, setChosenAction] = useState<Action>("new");
  const [chosenClassification, setChosenClassification] =
    useState<Classification>("PRIVATE");
  const [chosenTitle, setChosenTitle] = useState("");
  const [chosenDocumentType, setChosenDocumentType] =
    useState<DocumentTypeChoice>("auto");
  const [chosenTargetId, setChosenTargetId] = useState<string | null>(null);

  const [placementMode, setPlacementMode] = useState<PlacementMode>("library");
  const [linkToProjectId, setLinkToProjectId] = useState<string | null>(null);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);

  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [recentDocs, setRecentDocs] = useState<
    Array<{ id: string; title: string; classification: string; created_at: string }>
  >([]);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === linkToProjectId) ?? null,
    [projects, linkToProjectId],
  );

  const loadRecent = useCallback(() => {
    fetch("/api/documents")
      .then((r) => r.json())
      .then((d) =>
        setRecentDocs(
          (d.documents || [])
            .filter((doc: { status: string }) => doc.status === "ready")
            .slice(0, 6),
        ),
      )
      .catch(() => {});
  }, []);

  const loadProjects = useCallback(() => {
    setProjectsLoading(true);
    fetch("/api/projects?status=active")
      .then((r) => r.json())
      .then((d) => setProjects(d.projects || []))
      .catch(() => setProjects([]))
      .finally(() => setProjectsLoading(false));
  }, []);

  useEffect(() => {
    loadRecent();
    loadProjects();
  }, [loadRecent, loadProjects]);

  const analyzeFile = useCallback(async (uploadedFile: File) => {
    setFile(uploadedFile);
    setStoragePath(null);
    setStage("analyzing");
    setError(null);
    setProposal(null);

    try {
      const signRes = await fetch("/api/storage/signed-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: uploadedFile.name, size: uploadedFile.size }),
      });
      const signData = await signRes.json();
      if (!signRes.ok) {
        throw new Error(signData.error || "Failed to create signed upload URL");
      }

      const { signedUrl, storagePath: path } = signData as {
        signedUrl: string;
        storagePath: string;
      };

      const uploadRes = await fetch(signedUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/pdf" },
        body: uploadedFile,
      });
      if (!uploadRes.ok) {
        const text = await uploadRes.text().catch(() => "");
        throw new Error(
          `Upload to storage failed (HTTP ${uploadRes.status})${
            text ? `: ${text.slice(0, 120)}` : ""
          }`,
        );
      }
      setStoragePath(path);

      const res = await fetch("/api/librarian/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storagePath: path, fileName: uploadedFile.name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Analysis failed");

      const nextProposal: Proposal = data.proposal;
      setProposal(nextProposal);
      setChosenAction(nextProposal.recommendation.action);
      setChosenClassification(nextProposal.detected.suggestedClassification);
      setChosenTitle(nextProposal.detected.suggestedTitle);
      setChosenDocumentType(
        normalizeDetectedDocumentType(nextProposal.detected.documentType) || "auto",
      );
      setChosenTargetId(nextProposal.recommendation.targetDocumentId || null);
      setLinkToProjectId((current) => current || nextProposal.suggestedProject?.id || null);
      setStage("review");
    } catch (e) {
      setError((e as Error).message);
      setStage("error");
    }
  }, []);

  const handleFiles = useCallback(
    (files: File[]) => {
      const pdf = files.find((candidate) => candidate.type === "application/pdf");
      if (!pdf) {
        setError("Please drop a PDF file");
        return;
      }
      if (pdf.size > 50 * 1024 * 1024) {
        setError("File exceeds 50 MB limit");
        return;
      }
      setError(null);
      void analyzeFile(pdf);
    },
    [analyzeFile],
  );

  const confirmUpload = useCallback(async () => {
    if (!file || !proposal || !storagePath) return;

    const effectiveProjectId = placementMode === "project" ? linkToProjectId : null;
    if (placementMode === "project" && !effectiveProjectId) {
      setError("Pick a project before you continue.");
      setStage("review");
      return;
    }

    setStage("uploading");
    setError(null);

    try {
      const resolvedDocumentType =
        chosenDocumentType === "auto"
          ? normalizeDetectedDocumentType(proposal.detected.documentType)
          : chosenDocumentType;

      const body: Record<string, unknown> = {
        storagePath,
        fileName: file.name,
        classification: chosenClassification,
        title: chosenTitle,
        languageHint: proposal.detected.language,
      };

      if (resolvedDocumentType) {
        body.documentType = resolvedDocumentType;
        body.skipClassification = true;
      }
      if (chosenAction === "version" && chosenTargetId) {
        body.versionOf = chosenTargetId;
      }
      if (chosenAction === "related" && chosenTargetId) {
        body.relatedTo = chosenTargetId;
      }
      if (effectiveProjectId) {
        body.linkToProject = effectiveProjectId;
      }

      const res = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Upload failed");

      setStage("done");
      loadRecent();
    } catch (e) {
      setError((e as Error).message);
      setStage("error");
    }
  }, [
    chosenAction,
    chosenClassification,
    chosenDocumentType,
    chosenTargetId,
    chosenTitle,
    file,
    linkToProjectId,
    loadRecent,
    placementMode,
    proposal,
    storagePath,
  ]);

  const handleDuplicateSkip = useCallback(() => {
    if (!chosenTargetId) return;
    router.push(`/documents/${chosenTargetId}`);
  }, [chosenTargetId, router]);

  const reset = useCallback(() => {
    setStage("idle");
    setFile(null);
    setStoragePath(null);
    setProposal(null);
    setError(null);
    setChosenAction("new");
    setChosenClassification("PRIVATE");
    setChosenTitle("");
    setChosenDocumentType("auto");
    setChosenTargetId(null);
  }, []);

  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-hidden bg-white">
      <main className="flex-1 min-h-0 overflow-y-auto">
        <div className="mx-auto max-w-4xl px-6 py-10">
          <div className="mb-8 max-w-2xl">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-slate-50 px-3 py-1 text-slate-600">
              <Library className="h-4 w-4" />
              <span className="text-[14px] font-medium">Library</span>
            </div>
            <h1 className="text-[30px] font-semibold tracking-tight text-slate-950">
              Add a document
            </h1>
            <p className="mt-2 text-[14px] leading-relaxed text-slate-500">
              Upload a document once, keep it in the library, and optionally link it into a
              project so project chats can use it as source context.
            </p>
          </div>

          {stage === "idle" && (
            <div className="grid gap-6 lg:grid-cols-[1.35fr_0.9fr]">
              <div className="space-y-4">
                <DropZone
                  dragOver={dragOver}
                  setDragOver={setDragOver}
                  onFiles={handleFiles}
                />
                {error && <ErrorBanner message={error} />}
              </div>

              <aside className="space-y-4">
                <PlacementPanel
                  placementMode={placementMode}
                  setPlacementMode={setPlacementMode}
                  linkToProjectId={linkToProjectId}
                  setLinkToProjectId={setLinkToProjectId}
                  projects={projects}
                  projectsLoading={projectsLoading}
                  selectedProject={selectedProject}
                  onCreateProject={() => setCreateProjectOpen(true)}
                />
                <RecentSidebar
                  docs={recentDocs}
                  onClick={(id) => router.push(`/documents/${id}`)}
                />
              </aside>
            </div>
          )}

          {stage === "analyzing" && file && (
            <AnalyzingCard
              fileName={file.name}
              fileSize={file.size}
              placementMode={placementMode}
              projectName={selectedProject?.name || null}
            />
          )}

          {stage === "review" && proposal && file && (
            <ReviewCard
              file={file}
              proposal={proposal}
              placementMode={placementMode}
              setPlacementMode={setPlacementMode}
              linkToProjectId={linkToProjectId}
              setLinkToProjectId={setLinkToProjectId}
              projects={projects}
              projectsLoading={projectsLoading}
              selectedProject={selectedProject}
              chosenAction={chosenAction}
              setChosenAction={setChosenAction}
              chosenClassification={chosenClassification}
              setChosenClassification={setChosenClassification}
              chosenTitle={chosenTitle}
              setChosenTitle={setChosenTitle}
              chosenDocumentType={chosenDocumentType}
              setChosenDocumentType={setChosenDocumentType}
              chosenTargetId={chosenTargetId}
              setChosenTargetId={setChosenTargetId}
              setCreateProjectOpen={setCreateProjectOpen}
              onConfirm={confirmUpload}
              onSkipDuplicate={handleDuplicateSkip}
              onCancel={reset}
            />
          )}

          {stage === "uploading" && file && (
            <UploadingCard
              fileName={chosenTitle || file.name}
              placementMode={placementMode}
              projectName={selectedProject?.name || null}
            />
          )}

          {stage === "done" && file && (
            <DoneCard
              title={chosenTitle || file.name}
              projectName={placementMode === "project" ? selectedProject?.name || null : null}
              onAskAbout={() => router.push("/")}
              onViewAll={() => router.push("/documents")}
              onUploadMore={reset}
            />
          )}

          {stage === "error" && (
            <div className="space-y-3">
              <ErrorBanner message={error || "Something went wrong"} />
              <button
                type="button"
                onClick={reset}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-medium text-slate-700 hover:bg-slate-50"
              >
                Try again
              </button>
            </div>
          )}
        </div>
      </main>

      <CreateProjectDialog
        open={createProjectOpen}
        onOpenChange={setCreateProjectOpen}
        onCreated={async (slug) => {
          try {
            await loadProjects();
            const res = await fetch(`/api/projects/${slug}`);
            if (res.ok) {
              const data = await res.json();
              if (data.project?.id) {
                setPlacementMode("project");
                setLinkToProjectId(data.project.id);
              }
            }
          } catch (err) {
            console.error("post-create resolve failed:", err);
          }
          setCreateProjectOpen(false);
        }}
      />
    </div>
  );
}

function DropZone({
  dragOver,
  setDragOver,
  onFiles,
}: {
  dragOver: boolean;
  setDragOver: (value: boolean) => void;
  onFiles: (files: File[]) => void;
}) {
  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
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
        className={`cursor-pointer rounded-[24px] border-2 border-dashed px-6 py-14 text-center transition-all ${
          dragOver
            ? "scale-[1.01] border-slate-900 bg-slate-50"
            : "border-slate-200 bg-slate-50/60 hover:border-slate-300 hover:bg-slate-50"
        }`}
      >
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-200 bg-white shadow-sm">
          <UploadIcon className="h-5 w-5 text-slate-400" />
        </div>
        <p className="text-[15px] font-medium text-slate-900">Drop a PDF to add it</p>
        <p className="mt-1 text-[12px] text-slate-400">
          OCR and document suggestions run automatically. Up to 50 MB.
        </p>
        <input
          id="file-input"
          type="file"
          accept=".pdf"
          className="hidden"
          onChange={(e) => onFiles(Array.from(e.target.files || []))}
        />
      </div>
    </div>
  );
}

function PlacementPanel({
  placementMode,
  setPlacementMode,
  linkToProjectId,
  setLinkToProjectId,
  projects,
  projectsLoading,
  selectedProject,
  onCreateProject,
}: {
  placementMode: PlacementMode;
  setPlacementMode: (value: PlacementMode) => void;
  linkToProjectId: string | null;
  setLinkToProjectId: (value: string | null) => void;
  projects: ProjectOption[];
  projectsLoading: boolean;
  selectedProject: ProjectOption | null;
  onCreateProject: () => void;
}) {
  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
        Where it should live
      </p>

      <div className="grid gap-2">
        <button
          type="button"
          onClick={() => setPlacementMode("library")}
          className={`rounded-2xl border px-4 py-3 text-left transition-all ${
            placementMode === "library"
              ? "border-slate-300 bg-slate-50"
              : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
          }`}
        >
          <div className="flex items-center gap-2">
            <Library className="h-4 w-4 text-slate-500" />
            <span className="text-[14px] font-medium text-slate-900">Library only</span>
          </div>
          <p className="mt-1 text-[12px] text-slate-500">
            Keep it available globally and decide later where to link it.
          </p>
        </button>

        <button
          type="button"
          onClick={() => setPlacementMode("project")}
          className={`rounded-2xl border px-4 py-3 text-left transition-all ${
            placementMode === "project"
              ? "border-slate-300 bg-slate-50"
              : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
          }`}
        >
          <div className="flex items-center gap-2">
            <FolderOpen className="h-4 w-4 text-slate-500" />
            <span className="text-[14px] font-medium text-slate-900">Link into a project</span>
          </div>
          <p className="mt-1 text-[12px] text-slate-500">
            Keep it in the library and make it primary source context for one workspace.
          </p>
        </button>
      </div>

      {placementMode === "project" && (
        <div className="mt-4 space-y-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
          {projects.length > 0 ? (
            <select
              value={linkToProjectId || ""}
              onChange={(e) => setLinkToProjectId(e.target.value || null)}
              disabled={projectsLoading}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-900 focus:border-slate-400 focus:outline-none disabled:bg-slate-100"
            >
              <option value="">
                {projectsLoading ? "Loading projects..." : "Choose a project"}
              </option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white px-3 py-3 text-[12px] text-slate-500">
              No active projects yet. Create one first.
            </div>
          )}

          {selectedProject && (
            <p className="text-[12px] leading-relaxed text-slate-500">
              This document will stay in the library and be linked into{" "}
              <span className="font-medium text-slate-700">{selectedProject.name}</span>.
            </p>
          )}

          <button
            type="button"
            onClick={onCreateProject}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-medium text-slate-700 hover:bg-slate-50"
          >
            <Plus className="h-3.5 w-3.5" />
            Create new project
          </button>
        </div>
      )}
    </div>
  );
}

function AnalyzingCard({
  fileName,
  fileSize,
  placementMode,
  projectName,
}: {
  fileName: string;
  fileSize: number;
  placementMode: PlacementMode;
  projectName: string | null;
}) {
  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-slate-800 to-slate-600">
          <Sparkles className="h-5 w-5 text-white" />
        </div>
        <div>
          <p className="text-[14px] font-semibold text-slate-900">Preparing the document</p>
          <p className="text-[12px] text-slate-400">
            OCR, title suggestions, duplicate checks, and project-fit hints are running now.
          </p>
        </div>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
        <div className="flex items-center gap-3">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-slate-400" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] text-slate-800" dir="auto">
              {fileName}
            </p>
            <p className="text-[11px] text-slate-400">
              {formatBytes(fileSize)}
              {placementMode === "project" && projectName
                ? ` · will link to ${projectName}`
                : " · library only"}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function ReviewCard({
  file,
  proposal,
  placementMode,
  setPlacementMode,
  linkToProjectId,
  setLinkToProjectId,
  projects,
  projectsLoading,
  selectedProject,
  chosenAction,
  setChosenAction,
  chosenClassification,
  setChosenClassification,
  chosenTitle,
  setChosenTitle,
  chosenDocumentType,
  setChosenDocumentType,
  chosenTargetId,
  setChosenTargetId,
  setCreateProjectOpen,
  onConfirm,
  onSkipDuplicate,
  onCancel,
}: {
  file: File;
  proposal: Proposal;
  placementMode: PlacementMode;
  setPlacementMode: (value: PlacementMode) => void;
  linkToProjectId: string | null;
  setLinkToProjectId: (value: string | null) => void;
  projects: ProjectOption[];
  projectsLoading: boolean;
  selectedProject: ProjectOption | null;
  chosenAction: Action;
  setChosenAction: (value: Action) => void;
  chosenClassification: Classification;
  setChosenClassification: (value: Classification) => void;
  chosenTitle: string;
  setChosenTitle: (value: string) => void;
  chosenDocumentType: DocumentTypeChoice;
  setChosenDocumentType: (value: DocumentTypeChoice) => void;
  chosenTargetId: string | null;
  setChosenTargetId: (value: string | null) => void;
  setCreateProjectOpen: (value: boolean) => void;
  onConfirm: () => void;
  onSkipDuplicate: () => void;
  onCancel: () => void;
}) {
  const { detected, recommendation, related, suggestedProject } = proposal;
  const hasOverlap = related.length > 0;
  const suggestedDocType =
    normalizeDetectedDocumentType(detected.documentType) || null;
  const recommendationMeta = ACTION_COPY[recommendation.action];
  const RecommendationIcon = recommendationMeta.icon;

  return (
    <div className="space-y-5">
      <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-5 flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-slate-800 to-slate-600">
            <RecommendationIcon className="h-5 w-5 text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold text-slate-900">
              Ready to add this document
            </p>
            <p className="mt-1 text-[13px] leading-relaxed text-slate-500">
              {recommendation.reason}
            </p>
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="flex items-center gap-3">
                <FileText className="h-4 w-4 shrink-0 text-slate-400" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] text-slate-800" dir="auto">
                    {file.name}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    {detected.pageCount} {detected.pageCount === 1 ? "page" : "pages"} ·{" "}
                    {formatBytes(detected.fileSize)} · {detected.language.toUpperCase()}
                  </p>
                </div>
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Title
              </label>
              <input
                type="text"
                value={chosenTitle}
                onChange={(e) => setChosenTitle(e.target.value)}
                dir="auto"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[14px] text-slate-900 focus:border-slate-400 focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Document type
              </label>
              <select
                value={chosenDocumentType}
                onChange={(e) => setChosenDocumentType(e.target.value as DocumentTypeChoice)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-900 focus:border-slate-400 focus:outline-none"
              >
                <option value="auto">
                  Auto{suggestedDocType ? ` (${DOCUMENT_TYPE_COPY[suggestedDocType]})` : ""}
                </option>
                {DOCUMENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {DOCUMENT_TYPE_COPY[type]}
                  </option>
                ))}
              </select>
            </div>

            <PlacementPanel
              placementMode={placementMode}
              setPlacementMode={setPlacementMode}
              linkToProjectId={linkToProjectId}
              setLinkToProjectId={setLinkToProjectId}
              projects={projects}
              projectsLoading={projectsLoading}
              selectedProject={selectedProject}
              onCreateProject={() => setCreateProjectOpen(true)}
            />

            {placementMode === "library" && suggestedProject && (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-[12px] font-medium text-slate-800">
                  Suggested project match
                </p>
                <p className="mt-1 text-[12px] leading-relaxed text-slate-500">
                  {suggestedProject.name} looks like the best existing fit. You can keep this
                  as library-only or link it there now.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setPlacementMode("project");
                    setLinkToProjectId(suggestedProject.id);
                  }}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-medium text-slate-700 hover:bg-slate-50"
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                  Link to {suggestedProject.name}
                </button>
              </div>
            )}
          </div>

          <div className="space-y-4">
            {hasOverlap ? (
              <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                <p className="mb-1 text-[14px] font-semibold text-slate-900">
                  Possible overlap
                </p>
                <p className="mb-4 text-[12px] leading-relaxed text-slate-500">
                  Pick the closest existing document if you want to version, skip, or link this
                  upload. Otherwise keep it as a new source.
                </p>

                <div className="space-y-2">
                  {related.slice(0, 4).map((item) => (
                    <button
                      key={item.documentId}
                      type="button"
                      onClick={() =>
                        setChosenTargetId(
                          chosenTargetId === item.documentId ? null : item.documentId,
                        )
                      }
                      className={`w-full rounded-2xl border px-3 py-3 text-left transition-all ${
                        chosenTargetId === item.documentId
                          ? "border-slate-300 bg-slate-50"
                          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <FileText className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-medium text-slate-800" dir="auto">
                            {item.title}
                          </p>
                          <p className="mt-0.5 text-[11px] text-slate-400">
                            {item.type} · {item.classification} · v{item.versionNumber} ·{" "}
                            {formatRelative(item.createdAt)}
                          </p>
                          <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                            {item.reason}
                          </p>
                        </div>
                        <span className="text-[11px] font-medium text-slate-400">
                          {(item.similarity * 100).toFixed(0)}%
                        </span>
                      </div>
                    </button>
                  ))}
                </div>

                <div className="mt-4 space-y-2">
                  {(Object.keys(ACTION_COPY) as Action[]).map((action) => {
                    const meta = ACTION_COPY[action];
                    const Icon = meta.icon;
                    const requiresTarget = action !== "new";
                    const disabled = requiresTarget && !chosenTargetId;
                    const active = chosenAction === action;
                    return (
                      <button
                        key={action}
                        type="button"
                        disabled={disabled}
                        onClick={() => !disabled && setChosenAction(action)}
                        className={`w-full rounded-2xl border px-3 py-3 text-left transition-all ${
                          active
                            ? "border-slate-300 bg-slate-50"
                            : disabled
                              ? "cursor-not-allowed border-slate-100 bg-slate-50 text-slate-300"
                              : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <Icon className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <p className="text-[13px] font-medium text-slate-800">
                                {meta.label}
                              </p>
                              {action === recommendation.action && (
                                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
                                  Recommended
                                </span>
                              )}
                            </div>
                            <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                              {meta.description}
                            </p>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-[14px] font-semibold text-slate-900">No strong overlap found</p>
                <p className="mt-1 text-[12px] leading-relaxed text-slate-500">
                  This looks like a distinct document, so you can usually keep the default and
                  continue.
                </p>
              </div>
            )}

            <details className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
              <summary className="cursor-pointer list-none text-[13px] font-medium text-slate-800">
                Advanced review
              </summary>
              <div className="mt-4 space-y-4 border-t border-slate-100 pt-4">
                <div>
                  <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Classification
                  </label>
                  <select
                    value={chosenClassification}
                    onChange={(e) =>
                      setChosenClassification(e.target.value as Classification)
                    }
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-900 focus:border-slate-400 focus:outline-none"
                  >
                    {(Object.keys(CLASSIFICATION_LABELS) as Classification[]).map((value) => (
                      <option key={value} value={value}>
                        {CLASSIFICATION_LABELS[value]}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                    {detected.classificationReason}
                  </p>
                </div>

                {detected.entities.length > 0 && (
                  <div>
                    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                      Detected entities
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {detected.entities.map((entity, index) => (
                        <span
                          key={`${entity.name}-${index}`}
                          className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-600"
                          dir="auto"
                        >
                          {entity.name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {detected.firstPagePreview && (
                  <div>
                    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                      First-page preview
                    </p>
                    <div className="max-h-48 overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-[12px] leading-relaxed text-slate-600">
                      <p dir="auto">{detected.firstPagePreview}</p>
                    </div>
                  </div>
                )}
              </div>
            </details>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-[13px] font-medium text-slate-700 hover:bg-slate-50"
        >
          Cancel
        </button>
        {chosenAction === "duplicate" ? (
          <button
            type="button"
            onClick={onSkipDuplicate}
            disabled={!chosenTargetId}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-[13px] font-medium text-white hover:bg-amber-700 disabled:opacity-50"
          >
            Open the existing document
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        ) : (
          <button
            type="button"
            onClick={onConfirm}
            disabled={chosenAction !== "new" && !chosenTargetId}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-[13px] font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            Confirm and process
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

function UploadingCard({
  fileName,
  placementMode,
  projectName,
}: {
  fileName: string;
  placementMode: PlacementMode;
  projectName: string | null;
}) {
  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-3 flex items-center gap-3">
        <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
        <p className="text-[14px] font-medium text-slate-900">Processing</p>
      </div>
      <p className="mb-1 text-[13px] text-slate-700" dir="auto">
        {fileName}
      </p>
      <p className="text-[12px] leading-relaxed text-slate-500">
        Running OCR and deterministic parsing. This usually takes 30-90 seconds.
        {placementMode === "project" && projectName ? ` It will also link into ${projectName}.` : ""}
      </p>
    </div>
  );
}

function DoneCard({
  title,
  projectName,
  onAskAbout,
  onViewAll,
  onUploadMore,
}: {
  title: string;
  projectName: string | null;
  onAskAbout: () => void;
  onViewAll: () => void;
  onUploadMore: () => void;
}) {
  return (
    <div className="rounded-[28px] border border-emerald-200 bg-emerald-50/40 p-5">
      <div className="mb-4 flex items-start gap-3">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
        <div className="flex-1">
          <p className="text-[14px] font-semibold text-slate-900">Document added</p>
          <p className="mt-0.5 text-[13px] text-slate-700" dir="auto">
            {title}
          </p>
          <p className="mt-1 text-[12px] text-slate-500">
            {projectName
              ? `Stored in the library and linked into ${projectName}.`
              : "Stored in the library and ready to use."}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onAskAbout}
          className="flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-slate-800"
        >
          Ask about it
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onViewAll}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[13px] font-medium text-slate-700 hover:bg-slate-50"
        >
          View library
        </button>
        <button
          type="button"
          onClick={onUploadMore}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[13px] font-medium text-slate-700 hover:bg-slate-50"
        >
          Upload another
        </button>
      </div>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-[13px] text-red-700">
      <AlertCircle className="h-4 w-4 shrink-0" />
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
    <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
        Recent library documents
      </p>
      {docs.length === 0 ? (
        <p className="text-[12px] leading-relaxed text-slate-500">
          Your latest ready documents will appear here.
        </p>
      ) : (
        <div className="space-y-1">
          {docs.map((doc) => (
            <button
              key={doc.id}
              type="button"
              onClick={() => onClick(doc.id)}
              className="flex w-full items-center gap-2.5 rounded-lg border border-transparent bg-transparent px-2.5 py-2 text-left transition-all hover:border-slate-200 hover:bg-slate-50"
            >
              <FileText className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] text-slate-700" dir="auto">
                  {doc.title}
                </p>
                <p className="text-[10px] text-slate-400">
                  {doc.classification} · {formatRelative(doc.created_at)}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
