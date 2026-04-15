"use client";

interface ParsedDocumentContextCard {
  summary_en: string;
  summary_ar: string | null;
  topics: string[];
  key_parties: string[];
  key_obligations: string[];
  key_dates: string[];
  document_role: string;
  fits_with_projects: string[];
  fit_rationale: string;
}

interface DocumentContextCardProps {
  card: unknown;
  preferredLanguage?: string | null;
  variant?: "full" | "compact";
  bordered?: boolean;
  className?: string;
}

function toTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseDocumentContextCard(value: unknown): ParsedDocumentContextCard | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;

  const summaryEn = toTrimmedString(raw.summary_en);
  const summaryAr = toTrimmedString(raw.summary_ar) || null;
  const topics = toStringList(raw.topics);
  const keyParties = toStringList(raw.key_parties);
  const keyObligations = toStringList(raw.key_obligations);
  const keyDates = toStringList(raw.key_dates);
  const documentRole = toTrimmedString(raw.document_role);
  const fitsWithProjects = toStringList(raw.fits_with_projects);
  const fitRationale = toTrimmedString(raw.fit_rationale);

  const hasVisibleContent =
    summaryEn ||
    summaryAr ||
    topics.length > 0 ||
    keyParties.length > 0 ||
    keyObligations.length > 0 ||
    keyDates.length > 0 ||
    documentRole ||
    fitRationale;

  if (!hasVisibleContent) return null;

  return {
    summary_en: summaryEn,
    summary_ar: summaryAr,
    topics,
    key_parties: keyParties,
    key_obligations: keyObligations,
    key_dates: keyDates,
    document_role: documentRole,
    fits_with_projects: fitsWithProjects,
    fit_rationale: fitRationale,
  };
}

function ChipList({ items }: { items: string[] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {items.map((item) => (
        <span
          key={item}
          dir="auto"
          className="rounded-full border border-[color:var(--border)] bg-[color:var(--surface-sunken)] px-2 py-0.5 text-[11px] text-[color:var(--ink-muted)]"
        >
          {item}
        </span>
      ))}
    </div>
  );
}

function DetailBlock({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  if (!value) return null;

  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--ink-ghost)]">
        {label}
      </p>
      <p dir="auto" className="mt-1 text-[12px] leading-relaxed text-[color:var(--ink)]">
        {value}
      </p>
    </div>
  );
}

export function DocumentContextCard({
  card,
  preferredLanguage,
  variant = "full",
  bordered = true,
  className = "",
}: DocumentContextCardProps) {
  const parsed = parseDocumentContextCard(card);
  if (!parsed) return null;

  const summary =
    preferredLanguage === "ar" && parsed.summary_ar
      ? parsed.summary_ar
      : parsed.summary_en || parsed.summary_ar || "";

  if (variant === "compact") {
    return (
      <div className={className}>
        {summary && (
          <p
            dir="auto"
            className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-[color:var(--ink-muted)]"
          >
            {summary}
          </p>
        )}
        {parsed.topics.length > 0 && (
          <ChipList items={parsed.topics.slice(0, 3)} />
        )}
      </div>
    );
  }

  return (
    <div
      className={`${bordered ? "rounded-md border border-[color:var(--border)] bg-[color:var(--surface-sunken)]/70 p-4" : ""} ${className}`.trim()}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--ink-ghost)]">
        Context
      </p>
      {summary && (
        <p dir="auto" className="mt-2 text-[13px] leading-relaxed text-[color:var(--ink)]">
          {summary}
        </p>
      )}

      <div className="mt-4 space-y-4">
        <DetailBlock label="Document role" value={parsed.document_role} />
        <DetailBlock label="Why it fits" value={parsed.fit_rationale} />

        {parsed.key_parties.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--ink-ghost)]">
              Key parties
            </p>
            <ChipList items={parsed.key_parties.slice(0, 6)} />
          </div>
        )}

        {parsed.key_dates.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--ink-ghost)]">
              Key dates
            </p>
            <ChipList items={parsed.key_dates.slice(0, 6)} />
          </div>
        )}

        {parsed.key_obligations.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--ink-ghost)]">
              Key obligations
            </p>
            <div className="mt-2 space-y-1.5">
              {parsed.key_obligations.slice(0, 4).map((item) => (
                <p
                  key={item}
                  dir="auto"
                  className="rounded-md border border-[color:var(--border)] bg-[color:var(--surface-raised)] px-3 py-2 text-[12px] leading-relaxed text-[color:var(--ink-muted)]"
                >
                  {item}
                </p>
              ))}
            </div>
          </div>
        )}

        {parsed.topics.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--ink-ghost)]">
              Topics
            </p>
            <ChipList items={parsed.topics.slice(0, 8)} />
          </div>
        )}
      </div>
    </div>
  );
}
