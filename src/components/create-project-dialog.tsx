"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { createProjectAction } from "@/lib/actions/projects";

interface CreateProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Optional callback after successful creation. If provided, the dialog
   * delegates navigation to the caller. Default behavior: router.push to
   * the new workspace.
   */
  onCreated?: (slug: string) => void;
}

const COLORS = [
  { value: "#3B82F6", label: "Blue" },
  { value: "#10B981", label: "Green" },
  { value: "#F59E0B", label: "Amber" },
  { value: "#EF4444", label: "Red" },
  { value: "#8B5CF6", label: "Purple" },
  { value: "#64748B", label: "Slate" },
];

const PROMPT_EXAMPLES = [
  "Work with Elsewedy on industrial development options, proposal review, and chairman briefing notes.",
  "Law amendment project for the economic zones framework, including legal research, draft comments, and meeting prep.",
  "Solar developer outreach and evaluation, including company research, email drafting, and project comparison.",
];

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function deriveProjectName(prompt: string): string {
  const cleaned = collapseWhitespace(
    prompt
      .replace(/^(work on|work with|ongoing work with|project for|project on|regarding|about)\s+/i, "")
      .replace(/^(العمل على|العمل مع|مشروع|بشأن|حول)\s+/u, ""),
  );
  if (!cleaned) return "";

  const firstSentence = cleaned.split(/[.!؟\n]/)[0]?.trim() || cleaned;
  const words = firstSentence.split(/\s+/).filter(Boolean);
  if (words.length <= 6) return firstSentence;
  return words.slice(0, 6).join(" ");
}

function deriveContextSummary(prompt: string): string {
  const cleaned = collapseWhitespace(prompt);
  if (!cleaned) return "";
  if (cleaned.length <= 180) return cleaned;
  const sentence = cleaned.split(/[.!؟]/)[0]?.trim();
  if (sentence && sentence.length >= 24) return sentence;
  return `${cleaned.slice(0, 177).trim()}...`;
}

export function CreateProjectDialog({
  open,
  onOpenChange,
  onCreated,
}: CreateProjectDialogProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [selectedColor, setSelectedColor] = useState<string>(COLORS[5].value);
  const [projectPrompt, setProjectPrompt] = useState("");
  const [projectName, setProjectName] = useState("");
  const [projectIcon, setProjectIcon] = useState("");
  const [manualName, setManualName] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const resetDraft = () => {
    formRef.current?.reset();
    setError(null);
    setSelectedColor(COLORS[5].value);
    setProjectPrompt("");
    setProjectName("");
    setProjectIcon("");
    setManualName(false);
    setAdvancedOpen(false);
  };

  const handleSubmit = (formData: FormData) => {
    setError(null);
    const derivedName = collapseWhitespace(projectName || deriveProjectName(projectPrompt));
    const contextSummary = deriveContextSummary(projectPrompt);
    formData.set("name", derivedName);
    formData.set("description", projectPrompt);
    formData.set("context_summary", contextSummary);
    formData.set("color", selectedColor);
    formData.set("icon", projectIcon);
    startTransition(async () => {
      const result = await createProjectAction(formData);
      if (!result.ok) {
        setError(result.error || "Something went wrong");
        return;
      }
      resetDraft();
      onOpenChange(false);
      if (onCreated) {
        onCreated(result.slug!);
      } else {
        router.push(`/projects/${result.slug}`);
      }
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) resetDraft();
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent
        className="sm:max-w-2xl p-0 gap-0"
        style={{
          background: "var(--surface-raised)",
          border: "1px solid var(--border)",
          borderRadius: 0,
        }}
      >
        {/* Header strip — same language as PageHeader */}
        <DialogHeader
          className="px-6 py-4 text-left space-y-0"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <div
            className="text-xs font-medium mb-1"
            style={{ color: "var(--ink-faint)", letterSpacing: "0.04em" }}
          >
            NEW PROJECT
          </div>
          <DialogTitle
            className="text-xl font-semibold tracking-tight"
            style={{ color: "var(--ink)", letterSpacing: "-0.015em" }}
          >
            Create project
          </DialogTitle>
          <DialogDescription
            className="mt-1 text-sm"
            style={{ color: "var(--ink-muted)" }}
          >
            Describe the work. We&apos;ll generate a name from it.
          </DialogDescription>
        </DialogHeader>

        <form ref={formRef} action={handleSubmit} className="px-6 py-5 space-y-5">
          <Field label="WHAT IS THIS PROJECT ABOUT?">
            <Textarea
              name="project_prompt"
              rows={4}
              value={projectPrompt}
              onChange={(event) => {
                const nextPrompt = event.target.value;
                setProjectPrompt(nextPrompt);
                if (!manualName) setProjectName(deriveProjectName(nextPrompt));
              }}
              placeholder="Ongoing work with Elsewedy on industrial development in the Golden Triangle, including proposal review and briefing notes."
              autoFocus
              required
              minLength={8}
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-md)",
                color: "var(--ink)",
              }}
            />
          </Field>

          <div className="flex flex-wrap gap-1">
            {PROMPT_EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => {
                  setProjectPrompt(example);
                  if (!manualName) setProjectName(deriveProjectName(example));
                }}
                className="text-left text-xs px-2.5 py-1.5 transition-colors"
                style={{
                  background: "var(--surface-sunken)",
                  color: "var(--ink-muted)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-sm)",
                }}
              >
                {example.slice(0, 60)}…
              </button>
            ))}
          </div>

          <Field label="PROJECT NAME">
            <Input
              name="name"
              value={projectName}
              onChange={(event) => {
                setManualName(true);
                setProjectName(event.target.value);
              }}
              placeholder="Elsewedy"
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-md)",
                color: "var(--ink)",
              }}
            />
          </Field>

          {projectPrompt.trim().length > 0 && (
            <div
              className="p-4"
              style={{
                background: "var(--surface-sunken)",
                borderTop: "1px solid var(--border)",
                borderBottom: "1px solid var(--border)",
                marginInline: "-1.5rem",
              }}
            >
              <div
                className="flex items-center gap-2 text-xs font-medium"
                style={{
                  color: "var(--ink-faint)",
                  letterSpacing: "0.04em",
                }}
              >
                <Sparkles className="h-3.5 w-3.5" strokeWidth={1.75} />
                CONTEXT PREVIEW
              </div>
              <p
                className="mt-2 text-sm leading-relaxed"
                style={{ color: "var(--ink)" }}
                dir="auto"
              >
                {deriveContextSummary(projectPrompt)}
              </p>
            </div>
          )}

          <div>
            <button
              type="button"
              onClick={() => setAdvancedOpen((value) => !value)}
              className="flex items-center gap-2 text-xs font-medium cursor-pointer"
              style={{
                color: "var(--ink-muted)",
                background: "transparent",
                border: "none",
                padding: 0,
              }}
            >
              {advancedOpen ? "− Hide" : "+ Show"} advanced options
            </button>
            {advancedOpen && (
              <div className="mt-4 space-y-4">
                <Field label="COLOR">
                  <div className="flex gap-2">
                    {COLORS.map((c) => (
                      <button
                        key={c.value}
                        type="button"
                        onClick={() => setSelectedColor(c.value)}
                        className="h-6 w-6 transition-all cursor-pointer"
                        style={{
                          background: c.value,
                          borderRadius: "var(--radius-sm)",
                          border:
                            selectedColor === c.value
                              ? "2px solid var(--ink)"
                              : "1px solid var(--border)",
                        }}
                        aria-label={c.label}
                      />
                    ))}
                  </div>
                </Field>
                <Field label="ICON (LUCIDE NAME)">
                  <Input
                    name="icon"
                    value={projectIcon}
                    onChange={(event) => setProjectIcon(event.target.value)}
                    placeholder="folder-open"
                    style={{
                      background: "var(--surface)",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius-md)",
                      color: "var(--ink)",
                    }}
                  />
                </Field>
              </div>
            )}
          </div>

          {error && (
            <p
              className="text-sm px-3 py-2"
              style={{
                color: "var(--danger)",
                background: "var(--danger-bg)",
                border: "1px solid var(--danger)",
                borderRadius: "var(--radius-sm)",
              }}
            >
              {error}
            </p>
          )}
        </form>

        {/* Footer strip — flush bottom, ink primary action */}
        <div
          className="flex justify-end gap-2 px-6 py-4"
          style={{
            background: "var(--surface)",
            borderTop: "1px solid var(--border)",
          }}
        >
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
            className="px-4 py-2 text-sm font-medium cursor-pointer transition-colors disabled:opacity-50"
            style={{
              background: "var(--surface-raised)",
              color: "var(--ink-muted)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            form={undefined}
            onClick={() => formRef.current?.requestSubmit()}
            disabled={
              isPending ||
              collapseWhitespace(projectName).length < 2 ||
              collapseWhitespace(projectPrompt).length < 8
            }
            className="px-4 py-2 text-sm font-medium cursor-pointer transition-colors disabled:opacity-50"
            style={{
              background: "var(--ink)",
              color: "var(--surface-raised)",
              border: "none",
              borderRadius: "var(--radius-md)",
            }}
          >
            {isPending ? "Creating..." : "Create project"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        className="block text-xs font-medium mb-1.5"
        style={{ color: "var(--ink-faint)", letterSpacing: "0.04em" }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}
