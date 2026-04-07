"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
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

export function CreateProjectDialog({
  open,
  onOpenChange,
  onCreated,
}: CreateProjectDialogProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [selectedColor, setSelectedColor] = useState<string>(COLORS[5].value);
  const formRef = useRef<HTMLFormElement>(null);

  const handleSubmit = (formData: FormData) => {
    setError(null);
    formData.set("color", selectedColor);
    startTransition(async () => {
      const result = await createProjectAction(formData);
      if (!result.ok) {
        setError(result.error || "Something went wrong");
        return;
      }
      formRef.current?.reset();
      setSelectedColor(COLORS[5].value);
      onOpenChange(false);
      if (onCreated) {
        onCreated(result.slug!);
      } else {
        router.push(`/projects/${result.slug}`);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
        </DialogHeader>
        <form ref={formRef} action={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[11px] font-['JetBrains_Mono'] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
              Name
            </label>
            <Input
              name="name"
              placeholder="El Sewedy Safaga Industrial Zone"
              autoFocus
              required
              minLength={2}
            />
          </div>
          <div>
            <label className="block text-[11px] font-['JetBrains_Mono'] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
              Description
            </label>
            <Textarea
              name="description"
              rows={3}
              placeholder="What is this project about?"
            />
          </div>
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
                  className={`w-7 h-7 rounded-full border-2 transition-all ${
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
              <span className="text-slate-400 normal-case font-normal ml-1">
                (optional, lucide icon name)
              </span>
            </label>
            <Input name="icon" placeholder="folder-open" />
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
            <Button type="submit" disabled={isPending}>
              {isPending ? "Creating..." : "Create project"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
