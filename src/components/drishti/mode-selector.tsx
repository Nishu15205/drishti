"use client";

import {
  Banknote,
  BookOpen,
  PackageSearch,
  Pill,
  ScanEye,
  Users,
} from "lucide-react";
import { MODES, type ModeId } from "@/lib/drishti/constants";

const MODE_ICONS: Record<ModeId, typeof ScanEye> = {
  scene: ScanEye,
  currency: Banknote,
  medicine: Pill,
  text: BookOpen,
  pehchaan: Users,
  yaad: PackageSearch,
};

interface ModeSelectorProps {
  mode: ModeId;
  onChange: (mode: ModeId) => void;
  disabled?: boolean;
}

export function ModeSelector({ mode, onChange, disabled }: ModeSelectorProps) {
  return (
    <div
      className="grid grid-cols-2 gap-2 sm:grid-cols-3"
      role="group"
      aria-label="Analysis mode"
    >
      {MODES.map((m) => {
        const Icon = MODE_ICONS[m.id];
        const active = mode === m.id;
        return (
          <button
            key={m.id}
            type="button"
            aria-pressed={active}
            title={m.hint}
            disabled={disabled}
            onClick={() => onChange(m.id)}
            className={`flex min-h-[60px] flex-col items-center justify-center gap-0.5 rounded-xl border px-2 py-2.5 text-center transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 disabled:opacity-50 sm:min-h-[68px] sm:py-3 ${
              active
                ? "border-amber-400 bg-gradient-to-b from-amber-300 to-amber-500 font-semibold text-black shadow-[0_10px_32px_-10px_rgba(251,191,36,0.65)]"
                : "border-neutral-800 bg-neutral-900 text-neutral-300 hover:-translate-y-0.5 hover:border-neutral-600 hover:bg-neutral-800"
            }`}
          >
            <span
              className={`mb-1 flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
                active ? "bg-black/10" : "bg-neutral-800/80"
              }`}
              aria-hidden
            >
              <Icon className="h-4.5 w-4.5" />
            </span>
            <span className="text-sm leading-tight">{m.label}</span>
            <span
              className={`text-[10px] uppercase tracking-widest leading-tight ${
                active ? "text-black/60" : "text-neutral-500"
              }`}
            >
              {m.sublabel}
            </span>
          </button>
        );
      })}
    </div>
  );
}
