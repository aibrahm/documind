"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/page-header";

interface WorkspaceProfile {
  full_name: string;
  title: string;
  organization: string;
  organization_short: string | null;
  email: string | null;
  phone: string | null;
  signature: string;
  preferred_language: string;
}

const EMPTY_PROFILE: WorkspaceProfile = {
  full_name: "",
  title: "",
  organization: "",
  organization_short: "",
  email: "",
  phone: "",
  signature: "",
  preferred_language: "en",
};

export default function WorkspaceSettingsPage() {
  const [profile, setProfile] = useState<WorkspaceProfile>(EMPTY_PROFILE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/workspace-profile");
        const data = await response.json();
        if (!cancelled && data.profile) {
          setProfile({
            full_name: data.profile.full_name || "",
            title: data.profile.title || "",
            organization: data.profile.organization || "",
            organization_short: data.profile.organization_short || "",
            email: data.profile.email || "",
            phone: data.profile.phone || "",
            signature: data.profile.signature || "",
            preferred_language: data.profile.preferred_language || "en",
          });
        }
      } catch {
        if (!cancelled) setNotice("Failed to load workspace profile");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const update = (field: keyof WorkspaceProfile, value: string) => {
    setProfile((current) => ({ ...current, [field]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    setNotice(null);
    try {
      const response = await fetch("/api/workspace-profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to save profile");
      }
      setProfile({
        full_name: data.profile.full_name || "",
        title: data.profile.title || "",
        organization: data.profile.organization || "",
        organization_short: data.profile.organization_short || "",
        email: data.profile.email || "",
        phone: data.profile.phone || "",
        signature: data.profile.signature || "",
        preferred_language: data.profile.preferred_language || "en",
      });
      setNotice("Workspace profile saved");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Failed to save profile");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader eyebrow="SETTINGS" title="Operator identity" />
      <div className="h-full overflow-y-auto" style={{ background: "var(--surface)" }}>
      <div className="mx-auto max-w-4xl px-6 py-8">
        <p className="text-sm leading-relaxed mb-6" style={{ color: "var(--ink-muted)" }}>
          The sender identity the assistant uses when drafting emails, memos,
          letters, and other first-person outputs on your behalf.
        </p>

        <div className="grid gap-5 md:grid-cols-2">
          <Field label="Full name">
            <Input
              value={profile.full_name}
              onChange={(event) => update("full_name", event.target.value)}
              placeholder="Mohamed Ibrahim"
              disabled={loading}
            />
          </Field>
          <Field label="Title">
            <Input
              value={profile.title}
              onChange={(event) => update("title", event.target.value)}
              placeholder="Vice Chairman"
              disabled={loading}
            />
          </Field>
          <Field label="Organization">
            <Input
              value={profile.organization}
              onChange={(event) => update("organization", event.target.value)}
              placeholder="Golden Triangle Economic Zone Authority"
              disabled={loading}
            />
          </Field>
          <Field label="Short name">
            <Input
              value={profile.organization_short ?? ""}
              onChange={(event) => update("organization_short", event.target.value)}
              placeholder="GTEZ"
              disabled={loading}
            />
          </Field>
          <Field label="Email">
            <Input
              value={profile.email ?? ""}
              onChange={(event) => update("email", event.target.value)}
              placeholder="name@example.com"
              disabled={loading}
            />
          </Field>
          <Field label="Phone">
            <Input
              value={profile.phone ?? ""}
              onChange={(event) => update("phone", event.target.value)}
              placeholder="+20 ..."
              disabled={loading}
            />
          </Field>
        </div>

        <div className="mt-6 max-w-2xl">
          <Field label="Signature">
            <Textarea
              value={profile.signature}
              onChange={(event) => update("signature", event.target.value)}
              rows={6}
              placeholder={"Mohamed Ibrahim\nVice Chairman\nGolden Triangle Economic Zone Authority\nArab Republic of Egypt"}
              disabled={loading}
            />
          </Field>
        </div>

        {notice && (
          <div
            className="mt-5 px-4 py-3 text-sm"
            style={{
              background: "var(--surface-sunken)",
              borderTop: "1px solid var(--border)",
              borderBottom: "1px solid var(--border)",
              color: "var(--ink-muted)",
            }}
          >
            {notice}
          </div>
        )}

        <div className="mt-6">
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={loading || saving}
            className="px-4 py-2 text-sm font-medium cursor-pointer transition-colors disabled:opacity-50"
            style={{
              background: "var(--ink)",
              color: "var(--surface-raised)",
              border: "none",
              borderRadius: "var(--radius-md)",
            }}
          >
            {saving ? "Saving..." : "Save profile"}
          </button>
        </div>
      </div>
      </div>
    </>
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
    <label className="block space-y-1.5">
      <span
        className="block text-xs font-medium"
        style={{ color: "var(--ink-faint)", letterSpacing: "0.04em" }}
      >
        {label.toUpperCase()}
      </span>
      {children}
    </label>
  );
}
