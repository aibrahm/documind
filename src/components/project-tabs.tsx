"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "documents", label: "Documents" },
  { id: "negotiations", label: "Negotiations" },
  { id: "chats", label: "Chats" },
  { id: "memory", label: "Memory" },
] as const;

export type TabId = (typeof TABS)[number]["id"];

interface ProjectTabsProps {
  activeTab: TabId;
}

export function ProjectTabs({ activeTab }: ProjectTabsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const handleClick = (tab: TabId) => {
    const sp = new URLSearchParams(searchParams.toString());
    if (tab === "overview") {
      sp.delete("tab");
    } else {
      sp.set("tab", tab);
    }
    const query = sp.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  return (
    <nav
      className="border-b border-slate-200 px-6 flex gap-1 shrink-0"
      role="tablist"
    >
      {TABS.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={activeTab === tab.id}
          onClick={() => handleClick(tab.id)}
          className={`px-4 py-2.5 text-[13px] font-medium border-b-2 -mb-px transition-colors cursor-pointer bg-transparent ${
            activeTab === tab.id
              ? "border-slate-900 text-slate-900"
              : "border-transparent text-slate-500 hover:text-slate-900"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
