"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

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
    <div className="h-full overflow-y-auto bg-white">
      <div className="mx-auto max-w-4xl px-6 py-10">
        <div className="max-w-2xl">
          <p className="font-['JetBrains_Mono'] text-[10px] uppercase tracking-wider text-slate-400">
            Workspace profile
          </p>
          <h1 className="mt-2 text-[30px] font-semibold tracking-tight text-slate-900">
            Operator identity
          </h1>
          <p className="mt-3 text-[14px] leading-7 text-slate-600">
            This is the sender identity the assistant should use when drafting
            emails, memos, letters, and other first-person outputs on your behalf.
          </p>
        </div>

        <div className="mt-8 grid gap-6 md:grid-cols-2">
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
          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            {notice}
          </div>
        )}

        <div className="mt-6">
          <Button type="button" onClick={() => void handleSave()} disabled={loading || saving}>
            {saving ? "Saving..." : "Save profile"}
          </Button>
        </div>
      </div>
    </div>
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
    <label className="block space-y-2">
      <span className="font-['JetBrains_Mono'] text-[10px] uppercase tracking-wider text-slate-400">
        {label}
      </span>
      {children}
    </label>
  );
}
