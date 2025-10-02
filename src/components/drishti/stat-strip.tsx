"use client";

import { Gauge, Globe2, Layers, WifiOff } from "lucide-react";

/**
 * Home-screen highlight strip — the numbers that matter, one glance.
 * Values are the real measured ones from the Task 11 latency work.
 */
const STATS = [
  { icon: Gauge, value: "~3 sec", label: "pehli awaaz tak" },
  { icon: Layers, value: "6 modes", label: "scene se yaad tak" },
  { icon: Globe2, value: "Hindi + English", label: "dvi-bhashi voice" },
  { icon: WifiOff, value: "Installable PWA", label: "install & go" },
] as const;

export function StatStrip() {
  return (
    <ul
      className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-2.5"
      aria-label="Drishti highlights"
    >
      {STATS.map(({ icon: Icon, value, label }) => (
        <li
          key={value}
          className="flex items-center gap-2.5 rounded-xl border border-neutral-800 bg-neutral-900/60 px-3 py-2.5 backdrop-blur"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-400/10 text-amber-400">
            <Icon className="h-4 w-4" aria-hidden />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-bold text-neutral-100">
              {value}
            </span>
            <span className="block truncate text-[11px] text-neutral-500">
              {label}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}
