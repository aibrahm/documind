// src/lib/types.ts
//
// Shared TypeScript types used across the chat surface. UI components and
// pages should import these from `@/lib/types` rather than from each other —
// keeping pages/components from becoming the canonical home of shared types.
//
// The field shapes here mirror the definitions that previously lived in
// `src/app/page.tsx` and `src/components/chat-input.tsx`. Do not change a
// shape here without updating every consumer.

// ── Source ──
// A retrieved document chunk OR a web result. Discriminated union by `type`.
export type Source =
  | {
      id: string;
      type: "document";
      title: string;
      pageNumber: number;
      documentId: string;
      sectionTitle?: string | null;
      classification?: string;
      language?: string | null;
      contextCard?: Record<string, unknown> | null;
    }
  | { id: string; type: "web"; title: string; url: string };

// ── AttachmentMeta ──
// Metadata about an ephemeral chat attachment, persisted on the user message
// so the chip renders correctly when reloading conversation history.
export interface AttachmentMeta {
  title: string;
  pageCount: number;
  size: number;
}

// ── PinnedItem ──
// User-pinned reference from the `@` picker. Either a specific document (full
// chunks loaded as primary evidence) or an entity (resolved to document
// mentions via name search).
export interface PinnedItem {
  kind: "document" | "entity";
  id: string;
  label: string;
  type?: string; // entity type or document type
  doc_count?: number; // for entities
}
