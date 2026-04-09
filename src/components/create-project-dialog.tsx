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
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create project</DialogTitle>
          <DialogDescription>
            Start with the work itself. Describe what this project is about, then adjust the generated name if needed.
          </DialogDescription>
        </DialogHeader>
        <form ref={formRef} action={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[11px] font-['JetBrains_Mono'] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
              What is this project about?
            </label>
            <Textarea
              name="project_prompt"
              rows={5}
              value={projectPrompt}
              onChange={(event) => {
                const nextPrompt = event.target.value;
                setProjectPrompt(nextPrompt);
                if (!manualName) {
                  setProjectName(deriveProjectName(nextPrompt));
                }
              }}
              placeholder="Ongoing work with Elsewedy on industrial development options in the Golden Triangle, including proposal review, emails, and briefing notes."
              autoFocus
              required
              minLength={8}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            {PROMPT_EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => {
                  setProjectPrompt(example);
                  if (!manualName) {
                    setProjectName(deriveProjectName(example));
                  }
                }}
                className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-left text-[12px] text-slate-600 hover:border-slate-300 hover:bg-slate-50"
              >
                {example}
              </button>
            ))}
          </div>

          <div>
            <label className="block text-[11px] font-['JetBrains_Mono'] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
              Suggested project name
            </label>
            <Input
              name="name"
              value={projectName}
              onChange={(event) => {
                setManualName(true);
                setProjectName(event.target.value);
              }}
              placeholder="Elsewedy"
            />
          </div>
          {projectPrompt.trim().length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center gap-2 text-slate-500">
                <Sparkles className="h-4 w-4" />
                <p className="text-[11px] font-semibold uppercase tracking-wider">
                  Project context preview
                </p>
              </div>
              <p className="mt-2 text-[13px] leading-relaxed text-slate-700" dir="auto">
                {deriveContextSummary(projectPrompt)}
              </p>
            </div>
          )}

          <div className="rounded-xl border border-slate-200 bg-white">
            <button
              type="button"
              onClick={() => setAdvancedOpen((value) => !value)}
              className="flex w-full items-center justify-between px-4 py-3 text-left"
            >
              <span className="text-[12px] font-medium text-slate-700">
                Advanced options
              </span>
              <span className="text-[11px] text-slate-400">
                {advancedOpen ? "Hide" : "Show"}
              </span>
            </button>
            {advancedOpen && (
              <div className="border-t border-slate-100 px-4 py-4 space-y-4">
                <div>
                  <label className="block text-[11px] font-['JetBrains_Mono'] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
                    Color
                  </label>
                  <div className="flex gap-2">
                    {COLORS.map((c) => (
                      <button
                        key={c.value}
                        type="button"
                        onClick={() => setSelectedColor(c.value)}
                        className={`h-7 w-7 rounded-full border-2 transition-all ${
                          selectedColor === c.value
                            ? "border-slate-900 scale-110"
                            : "border-transparent hover:scale-105"
                        }`}
                        style={{ background: c.value }}
                        aria-label={c.label}
                      />
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] font-['JetBrains_Mono'] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
                    Icon
                    <span className="ml-1 font-normal normal-case text-slate-400">
                      (optional, lucide icon name)
                    </span>
                  </label>
                  <Input
                    name="icon"
                    value={projectIcon}
                    onChange={(event) => setProjectIcon(event.target.value)}
                    placeholder="folder-open"
                  />
                </div>
              </div>
            )}
          </div>

          {error && (
            <p className="text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-md">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isPending || collapseWhitespace(projectName).length < 2 || collapseWhitespace(projectPrompt).length < 8}
            >
              {isPending ? "Creating..." : "Create project"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
