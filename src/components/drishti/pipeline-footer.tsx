"use client";

import { BrainCircuit, Camera, Eye, Mic, Volume2 } from "lucide-react";

const PIPELINE = [
  { icon: Camera, label: "Camera" },
  { icon: Eye, label: "VLM · vision" },
  { icon: BrainCircuit, label: "LLM · answers" },
  { icon: Volume2, label: "TTS · voice out" },
  { icon: Mic, label: "ASR · voice in" },
];

export function PipelineFooter() {
  return (
    <footer className="mt-auto border-t border-neutral-800 bg-neutral-950/90 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-3 px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:flex-row">
        <p className="text-center text-xs text-neutral-500 sm:text-left">
          <span className="drishti-gradient-text text-sm font-extrabold">
            Drishti
          </span>{" "}
          <span className="font-semibold text-neutral-300">
            — AI Eye for the Blind
          </span>{" "}
          · Team AlgoAura · MERI College of Engineering &amp; Technology, Rohtak
        </p>
        <ul
          className="flex flex-wrap items-center justify-center gap-1.5"
          aria-label="AI pipeline"
        >
          {PIPELINE.map(({ icon: Icon, label }, i) => (
            <li key={label} className="flex items-center gap-1.5">
              <span className="flex items-center gap-1 rounded-full border border-neutral-800 bg-neutral-900/80 px-2.5 py-1 text-[10px] font-medium text-neutral-400 backdrop-blur">
                <Icon
                  className="h-3 w-3 text-amber-400 drop-shadow-[0_0_5px_rgba(251,191,36,0.8)]"
                  aria-hidden
                />
                {label}
              </span>
              {i < PIPELINE.length - 1 && (
                <span className="text-neutral-700" aria-hidden>
                  ·
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </footer>
  );
}
