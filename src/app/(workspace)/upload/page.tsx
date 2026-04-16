"use client";

import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  FileText,
  FolderOpen,
  Library,
  Loader2,
  Plus,
  Upload as UploadIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CreateProjectDialog } from "@/components/create-project-dialog";
import { PageHeader } from "@/components/page-header";

type Stage = "idle" | "uploading" | "duplicate" | "done" | "error";
type PlacementMode = "library" | "project";

interface ProjectOption {
  id: string;
  slug: string;
  name: string;
  color: string | null;
  context_summary?: string | null;
}

interface UploadResult {
  id: string;
  status: string;
  title: string;
}

interface DuplicateResult {
  duplicate: true;
  existingDocId: string;
  existingTitle: string;
  existingStatus: string;
}

function displayClassification(value: string | null | undefined): string {
  if (value === "PRIVATE") return "Confidential";
  if (value === "PUBLIC") return "Open";
  if (value === "DOCTRINE") return "Open"; // legacy rows
  return value ?? "";
}

function formatRelative(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  const diffDays = Math.floor(
    (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/**
 * Upload page — drop a PDF, it lands in the library in `processing` state.
 *
 * The previous incarnation of this page ran a full Azure OCR pass via
 * `/api/intake/analyze` to produce a "review screen" before the upload
 * was committed. That screen has been killed:
 *   - Azure was being called twice per upload (once for the proposal,
 *     once for the real extraction). Killing it halves Azure spend.
 *   - The user has decided ahead of time whether the doc lives in the
 *     library or a project; the review step's "add as version vs. skip
 *     duplicate" branch was never the primary action.
 *   - SHA-based duplicate detection is preserved as a quick toast on
 *     submit — the cheap thing the review screen actually did well.
 *
 * Background processing: `/api/upload` returns in <1 s. The browser flips
 * to the Done card (or the duplicate toast). The library page then shows
 * the new doc with a `processing` pill that polls until ready.
 */
export default function UploadPage() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const [placementMode, setPlacementMode] = useState<PlacementMode>("library");
  const [linkToProjectId, setLinkToProjectId] = useState<string | null>(null);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);

  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [recentDocs, setRecentDocs] = useState<
    Array<{
      id: string;
      title: string;
      classification: string;
      created_at: string;
    }>
  >([]);

  const [uploaded, setUploaded] = useState<UploadResult | null>(null);
  const [duplicate, setDuplicate] = useState<DuplicateResult | null>(null);

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

  const reset = useCallback(() => {
    setStage("idle");
    setError(null);
    setUploaded(null);
    setDuplicate(null);
    setPendingFile(null);
  }, []);

  const sendToServer = useCallback(
    async (file: File, opts: { force?: boolean } = {}) => {
      setPendingFile(file);
      setStage("uploading");
      setError(null);
      setDuplicate(null);

      const effectiveProjectId =
        placementMode === "project" ? linkToProjectId : null;
      if (placementMode === "project" && !effectiveProjectId) {
        setError("Pick a project before you continue.");
        setStage("error");
        return;
      }

      try {
        // Step 1: signed-upload to Supabase Storage
        const signRes = await fetch("/api/storage/signed-upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileName: file.name, size: file.size }),
        });
        const signData = await signRes.json();
        if (!signRes.ok) {
          throw new Error(
            signData.error || "Failed to create signed upload URL",
          );
        }
        const { signedUrl, storagePath } = signData as {
          signedUrl: string;
          storagePath: string;
        };

        const putRes = await fetch(signedUrl, {
          method: "PUT",
          headers: { "Content-Type": "application/pdf" },
          body: file,
        });
        if (!putRes.ok) {
          const text = await putRes.text().catch(() => "");
          throw new Error(
            `Upload to storage failed (HTTP ${putRes.status})${text ? `: ${text.slice(0, 120)}` : ""}`,
          );
        }

        // Step 2: tell the API. It does SHA dedup + queue + after().
        const uploadRes = await fetch("/api/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            storagePath,
            fileName: file.name,
            ...(effectiveProjectId
              ? { linkToProject: effectiveProjectId }
              : {}),
            ...(opts.force ? { force: true } : {}),
          }),
        });
        const uploadData = await uploadRes.json();
        if (!uploadRes.ok) {
          throw new Error(
            uploadData.error || `Upload failed (HTTP ${uploadRes.status})`,
          );
        }

        if ("duplicate" in uploadData && uploadData.duplicate) {
          setDuplicate(uploadData as DuplicateResult);
          setStage("duplicate");
          return;
        }

        setUploaded(uploadData as UploadResult);
        setStage("done");
        loadRecent();
      } catch (e) {
        setError((e as Error).message);
        setStage("error");
      }
    },
    [placementMode, linkToProjectId, loadRecent],
  );

  const handleFiles = useCallback(
    (files: File[]) => {
      const pdf = files.find(
        (candidate) => candidate.type === "application/pdf",
      );
      if (!pdf) {
        setError("Please drop a PDF file");
        setStage("error");
        return;
      }
      if (pdf.size > 50 * 1024 * 1024) {
        setError("File exceeds 50 MB limit");
        setStage("error");
        return;
      }
      void sendToServer(pdf);
    },
    [sendToServer],
  );

  const forceUpload = useCallback(() => {
    if (!pendingFile) return;
    void sendToServer(pendingFile, { force: true });
  }, [pendingFile, sendToServer]);

  return (
    <>
      <PageHeader eyebrow="UPLOAD" title="Add a document" />
      <div
        className="flex flex-1 min-h-0 flex-col overflow-hidden"
        style={{ background: "var(--surface)" }}
      >
        <main className="flex-1 min-h-0 overflow-y-auto">
          <div className="mx-auto max-w-4xl px-6 py-10">
            {(stage === "idle" || stage === "uploading") && (
              <div className="grid gap-6 lg:grid-cols-[1.35fr_0.9fr]">
                <div className="space-y-4">
                  <DropZone
                    dragOver={dragOver}
                    setDragOver={setDragOver}
                    onFiles={handleFiles}
                    busy={stage === "uploading"}
                    busyLabel={pendingFile?.name}
                  />
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

            {stage === "duplicate" && duplicate && (
              <DuplicateCard
                duplicate={duplicate}
                onView={() =>
                  router.push(`/documents/${duplicate.existingDocId}`)
                }
                onForce={forceUpload}
                onCancel={reset}
              />
            )}

            {stage === "done" && uploaded && (
              <DoneCard
                title={uploaded.title}
                projectName={
                  placementMode === "project"
                    ? selectedProject?.name || null
                    : null
                }
                onViewLibrary={() => router.push("/documents")}
                onUploadMore={reset}
                onOpenDoc={() => router.push(`/documents/${uploaded.id}`)}
              />
            )}

            {stage === "error" && (
              <div className="space-y-3">
                <ErrorBanner message={error || "Something went wrong"} />
                <button
                  type="button"
                  onClick={reset}
                  className="rounded-md border border-[color:var(--border)] bg-[color:var(--surface-raised)] px-3 py-1.5 text-[12px] font-medium text-[color:var(--ink)] hover:bg-[color:var(--surface-sunken)]"
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
    </>
  );
}

function DropZone({
  dragOver,
  setDragOver,
  onFiles,
  busy,
  busyLabel,
}: {
  dragOver: boolean;
  setDragOver: (value: boolean) => void;
  onFiles: (files: File[]) => void;
  busy: boolean;
  busyLabel?: string;
}) {
  // <label htmlFor> + visually-hidden input is the canonical accessible
  // drop-zone pattern. The label is keyboard-focusable, Enter/Space
  // activates it natively, screen readers announce "Drop a PDF…" via the
  // label text, and drag/drop events fire on the label just like a div.
  // No `role` shim, no synthetic onKeyDown — biome's a11y rule is happy
  // and so is anyone using a screen reader.
  return (
    <label
      htmlFor="file-input"
      onDragOver={(e) => {
        if (busy) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        if (busy) return;
        e.preventDefault();
        setDragOver(false);
        onFiles(Array.from(e.dataTransfer.files));
      }}
      className={`block px-6 py-16 text-center transition-colors ${busy ? "cursor-default" : "cursor-pointer"}`}
      style={{
        background: dragOver
          ? "var(--surface-sunken)"
          : "var(--surface-raised)",
        border: dragOver ? "2px dashed var(--ink)" : "2px dashed var(--border)",
      }}
    >
      <div
        className="mx-auto mb-4 flex h-12 w-12 items-center justify-center"
        style={{
          background: "var(--surface-sunken)",
          borderRadius: "var(--radius-md)",
        }}
      >
        {busy ? (
          <Loader2
            className="h-5 w-5 animate-spin"
            style={{ color: "var(--ink-muted)" }}
            strokeWidth={1.5}
          />
        ) : (
          <UploadIcon
            className="h-5 w-5"
            style={{ color: "var(--ink-muted)" }}
            strokeWidth={1.5}
          />
        )}
      </div>
      {busy ? (
        <>
          <p className="text-sm font-medium" style={{ color: "var(--ink)" }}>
            Sending {busyLabel || "your document"}…
          </p>
          <p className="mt-1 text-xs" style={{ color: "var(--ink-muted)" }}>
            Extraction runs in the background. You&apos;ll see it in the library
            shortly.
          </p>
        </>
      ) : (
        <>
          <p className="text-sm font-medium" style={{ color: "var(--ink)" }}>
            Drop a PDF to add it
          </p>
          <p className="mt-1 text-xs" style={{ color: "var(--ink-muted)" }}>
            Up to 50 MB. Extraction runs automatically in the background.
          </p>
        </>
      )}
      <input
        id="file-input"
        type="file"
        accept=".pdf"
        className="hidden"
        disabled={busy}
        onChange={(e) => {
          onFiles(Array.from(e.target.files || []));
          // Reset so picking the same file twice still fires onChange
          // (browsers cache the FileList by default).
          e.target.value = "";
        }}
      />
    </label>
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
    <div className="rounded-md border border-[color:var(--border)] bg-[color:var(--surface-raised)] p-5">
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-[color:var(--ink-ghost)]">
        Where it should live
      </p>

      <div className="grid gap-2">
        <button
          type="button"
          onClick={() => setPlacementMode("library")}
          className={`rounded-md border px-4 py-3 text-left transition-all ${
            placementMode === "library"
              ? "border-[color:var(--border-strong)] bg-[color:var(--surface-sunken)]"
              : "border-[color:var(--border)] bg-[color:var(--surface-raised)] hover:border-[color:var(--border-strong)] hover:bg-[color:var(--surface-sunken)]"
          }`}
        >
          <div className="flex items-center gap-2">
            <Library className="h-4 w-4 text-[color:var(--ink-muted)]" />
            <span className="text-[14px] font-medium text-[color:var(--ink)]">
              Library only
            </span>
          </div>
          <p className="mt-1 text-[12px] text-[color:var(--ink-muted)]">
            General reference. Available globally; decide later where to link
            it.
          </p>
        </button>

        <button
          type="button"
          onClick={() => setPlacementMode("project")}
          className={`rounded-md border px-4 py-3 text-left transition-all ${
            placementMode === "project"
              ? "border-[color:var(--border-strong)] bg-[color:var(--surface-sunken)]"
              : "border-[color:var(--border)] bg-[color:var(--surface-raised)] hover:border-[color:var(--border-strong)] hover:bg-[color:var(--surface-sunken)]"
          }`}
        >
          <div className="flex items-center gap-2">
            <FolderOpen className="h-4 w-4 text-[color:var(--ink-muted)]" />
            <span className="text-[14px] font-medium text-[color:var(--ink)]">
              Link into a project
            </span>
          </div>
          <p className="mt-1 text-[12px] text-[color:var(--ink-muted)]">
            Primary source context for one workspace.
          </p>
        </button>
      </div>

      {placementMode === "project" && (
        <div className="mt-4 space-y-3 rounded-md border border-[color:var(--border)] bg-[color:var(--surface-sunken)]/70 p-4">
          {projects.length > 0 ? (
            <select
              value={linkToProjectId || ""}
              onChange={(e) => setLinkToProjectId(e.target.value || null)}
              disabled={projectsLoading}
              className="w-full rounded-md border border-[color:var(--border)] bg-[color:var(--surface-raised)] px-3 py-2 text-[13px] text-[color:var(--ink)] focus:border-[color:var(--ink)] focus:outline-none disabled:bg-[color:var(--surface-sunken)]"
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
            <div className="rounded-md border border-dashed border-[color:var(--border-strong)] bg-[color:var(--surface-raised)] px-3 py-3 text-[12px] text-[color:var(--ink-muted)]">
              No active projects yet. Create one first.
            </div>
          )}

          {selectedProject && (
            <p className="text-[12px] leading-relaxed text-[color:var(--ink-muted)]">
              Will link into{" "}
              <span className="font-medium text-[color:var(--ink)]">
                {selectedProject.name}
              </span>
              .
            </p>
          )}

          <button
            type="button"
            onClick={onCreateProject}
            className="inline-flex items-center gap-1.5 rounded-md border border-[color:var(--border)] bg-[color:var(--surface-raised)] px-3 py-1.5 text-[12px] font-medium text-[color:var(--ink)] hover:bg-[color:var(--surface-sunken)]"
          >
            <Plus className="h-3.5 w-3.5" />
            Create new project
          </button>
        </div>
      )}
    </div>
  );
}

function DoneCard({
  title,
  projectName,
  onViewLibrary,
  onUploadMore,
  onOpenDoc,
}: {
  title: string;
  projectName: string | null;
  onViewLibrary: () => void;
  onUploadMore: () => void;
  onOpenDoc: () => void;
}) {
  return (
    <div
      className="rounded-md border p-5"
      style={{
        borderColor: "var(--success)",
        background: "var(--success-bg)",
      }}
    >
      <div className="mb-4 flex items-start gap-3">
        <CheckCircle2
          className="mt-0.5 h-5 w-5 shrink-0"
          style={{ color: "var(--success)" }}
        />
        <div className="flex-1">
          <p className="text-[14px] font-semibold text-[color:var(--ink)]">
            Queued for extraction
          </p>
          <p className="mt-0.5 text-[13px] text-[color:var(--ink)]" dir="auto">
            {title}
          </p>
          <p className="mt-1 text-[12px] text-[color:var(--ink-muted)]">
            {projectName
              ? `Linked into ${projectName}. Background extraction is running — it'll show as ready in the library shortly.`
              : "Stored in the library. Background extraction is running — it'll show as ready shortly."}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onOpenDoc}
          className="flex items-center gap-1.5 rounded-md bg-[color:var(--ink)] px-3 py-1.5 text-[13px] font-medium text-[color:var(--surface-raised)] hover:bg-[color:var(--ink-strong)]"
        >
          Open the document
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onViewLibrary}
          className="rounded-md border border-[color:var(--border)] bg-[color:var(--surface-raised)] px-3 py-1.5 text-[13px] font-medium text-[color:var(--ink)] hover:bg-[color:var(--surface-sunken)]"
        >
          View library
        </button>
        <button
          type="button"
          onClick={onUploadMore}
          className="rounded-md border border-[color:var(--border)] bg-[color:var(--surface-raised)] px-3 py-1.5 text-[13px] font-medium text-[color:var(--ink)] hover:bg-[color:var(--surface-sunken)]"
        >
          Upload another
        </button>
      </div>
    </div>
  );
}

function DuplicateCard({
  duplicate,
  onView,
  onForce,
  onCancel,
}: {
  duplicate: DuplicateResult;
  onView: () => void;
  onForce: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="rounded-md border p-5"
      style={{
        borderColor: "var(--warning)",
        background: "var(--warning-bg)",
      }}
    >
      <div className="mb-4 flex items-start gap-3">
        <AlertCircle
          className="mt-0.5 h-5 w-5 shrink-0"
          style={{ color: "var(--warning)" }}
        />
        <div className="flex-1">
          <p className="text-[14px] font-semibold text-[color:var(--ink)]">
            Looks like a duplicate
          </p>
          <p className="mt-0.5 text-[13px] text-[color:var(--ink)]" dir="auto">
            {duplicate.existingTitle}
          </p>
          <p className="mt-1 text-[12px] text-[color:var(--ink-muted)]">
            The exact same file is already in your library
            {duplicate.existingStatus === "ready"
              ? "."
              : ` (currently ${duplicate.existingStatus}).`}{" "}
            You can open it instead, or upload anyway as a separate document.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onView}
          className="flex items-center gap-1.5 rounded-md bg-[color:var(--ink)] px-3 py-1.5 text-[13px] font-medium text-[color:var(--surface-raised)] hover:bg-[color:var(--ink-strong)]"
        >
          Open existing
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onForce}
          className="rounded-md border border-[color:var(--border)] bg-[color:var(--surface-raised)] px-3 py-1.5 text-[13px] font-medium text-[color:var(--ink)] hover:bg-[color:var(--surface-sunken)]"
        >
          Upload anyway
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-[color:var(--border)] bg-[color:var(--surface-raised)] px-3 py-1.5 text-[13px] font-medium text-[color:var(--ink-muted)] hover:bg-[color:var(--surface-sunken)]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      className="flex items-center gap-2 rounded-md border px-3 py-2 text-[13px]"
      style={{
        borderColor: "var(--danger)",
        background: "var(--danger-bg)",
        color: "var(--danger)",
      }}
    >
      <AlertCircle className="h-4 w-4 shrink-0" />
      {message}
    </div>
  );
}

function RecentSidebar({
  docs,
  onClick,
}: {
  docs: Array<{
    id: string;
    title: string;
    classification: string;
    created_at: string;
  }>;
  onClick: (id: string) => void;
}) {
  return (
    <div className="rounded-md border border-[color:var(--border)] bg-[color:var(--surface-raised)] p-5">
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-[color:var(--ink-ghost)]">
        Recent library documents
      </p>
      {docs.length === 0 ? (
        <p className="text-[12px] leading-relaxed text-[color:var(--ink-muted)]">
          Your latest ready documents will appear here.
        </p>
      ) : (
        <div className="space-y-1">
          {docs.map((doc) => (
            <button
              key={doc.id}
              type="button"
              onClick={() => onClick(doc.id)}
              className="flex w-full items-center gap-2.5 rounded-md border border-transparent bg-transparent px-2.5 py-2 text-left transition-all hover:border-[color:var(--border)] hover:bg-[color:var(--surface-sunken)]"
            >
              <FileText className="h-3.5 w-3.5 shrink-0 text-[color:var(--ink-ghost)]" />
              <div className="min-w-0 flex-1">
                <p
                  className="truncate text-[12px] text-[color:var(--ink)]"
                  dir="auto"
                >
                  {doc.title}
                </p>
                <p className="text-[10px] text-[color:var(--ink-ghost)]">
                  {displayClassification(doc.classification)} ·{" "}
                  {formatRelative(doc.created_at)}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
