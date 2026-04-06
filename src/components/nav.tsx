"use client";

import { usePathname, useRouter } from "next/navigation";
import { Search, FileText, Upload, Circle, BookOpen } from "lucide-react";

interface NavProps {
  meta?: {
    time?: number | null;
    model?: string | null;
    stages?: number | null;
  };
}

const links = [
  { label: "Intelligence", href: "/", icon: Search },
  { label: "Documents", href: "/documents", icon: FileText },
  { label: "Upload", href: "/upload", icon: Upload },
  { label: "Doctrines", href: "/doctrines", icon: BookOpen },
];

export function Nav({ meta }: NavProps) {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <nav className="flex items-center justify-between px-5 h-12 bg-[#1E293B] shrink-0">
      <div className="flex items-center gap-6">
        <button
          onClick={() => router.push("/")}
          className="text-[15px] tracking-tight text-white bg-transparent border-none cursor-pointer p-0 flex items-baseline"
        >
          <span className="font-bold">Docu</span>
          <span className="font-light text-slate-300">Mind</span>
        </button>

        <div className="w-px h-5 bg-slate-600" />

        <div className="flex gap-0.5">
          {links.map((l) => {
            const active =
              pathname === l.href ||
              (l.href !== "/" && pathname.startsWith(l.href));
            const Icon = l.icon;

            return (
              <button
                key={l.href}
                onClick={() => router.push(l.href)}
                className={`flex items-center gap-1.5 text-[13px] font-medium border-none px-3 py-1.5 rounded-md cursor-pointer transition-colors ${
                  active
                    ? "bg-white/10 text-white font-semibold"
                    : "bg-transparent text-slate-400 hover:text-slate-300"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {l.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-3">
        {meta?.model && (
          <span className="font-['JetBrains_Mono'] text-[10px] tracking-wider text-violet-400 bg-white/10 px-2 py-0.5 rounded">
            {meta.model.toUpperCase()}
          </span>
        )}

        {meta?.stages != null && (
          <span className="font-['JetBrains_Mono'] text-[10px] tracking-wider text-slate-500">
            {meta.stages} STAGES
          </span>
        )}

        {meta?.time != null && (
          <span className="font-['JetBrains_Mono'] text-[10px] tracking-wider text-slate-500">
            {meta.time}ms
          </span>
        )}

        <div className="flex items-center gap-1.5">
          <Circle className="w-1.5 h-1.5 fill-green-500 text-green-500 drop-shadow-[0_0_4px_#22c55e]" />
          <span className="font-['JetBrains_Mono'] text-[10px] tracking-wider text-slate-500">
            ONLINE
          </span>
        </div>
      </div>
    </nav>
  );
}
