"use client";

import { Eye, Loader2, Mic, Radio, ScanEye, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { DrishtiStatus } from "@/hooks/use-drishti";

interface ActionBarProps {
  status: DrishtiStatus;
  busy: boolean;
  listening: boolean;
  speaking: boolean;
  live: boolean;
  nazar: boolean;
  onDescribe: () => void;
  onStartAsk: () => void;
  onStopAsk: () => void;
  onStopSpeaking: () => void;
  onLiveChange: (value: boolean) => void;
  onNazarChange: (value: boolean) => void;
}

export function ActionBar({
  status,
  busy,
  listening,
  speaking,
  live,
  nazar,
  onDescribe,
  onStartAsk,
  onStopAsk,
  onStopSpeaking,
  onLiveChange,
  onNazarChange,
}: ActionBarProps) {
  const handleMicKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if ((e.code === "Space" || e.code === "Enter") && !e.repeat) {
      e.preventDefault();
      void onStartAsk();
    }
  };

  const handleMicKeyUp = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.code === "Space" || e.code === "Enter") {
      e.preventDefault();
      void onStopAsk();
    }
  };

  return (
    <section aria-label="Controls" className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* Primary: describe surroundings */}
        <Button
          type="button"
          disabled={busy}
          onClick={onDescribe}
          aria-label="Describe my surroundings"
          className={`relative h-20 overflow-hidden rounded-2xl bg-gradient-to-b from-amber-300 to-amber-500 text-lg font-extrabold text-black shadow-[0_14px_44px_-12px_rgba(251,191,36,0.6)] transition hover:from-amber-200 hover:to-amber-400 focus-visible:ring-2 focus-visible:ring-amber-200 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950 disabled:opacity-60 sm:text-xl ${
            busy ? "" : "drishti-shine"
          }`}
        >
          {busy ? (
            <Loader2 className="mr-2 h-6 w-6 animate-spin" aria-hidden />
          ) : (
            <ScanEye className="mr-2 h-7 w-7" aria-hidden />
          )}
          {busy ? "Dekh raha hoon…" : "Kya hai aas-paas?"}
        </Button>

        {/* Secondary: hold-to-talk Q&A */}
        <button
          type="button"
          disabled={busy && !listening}
          aria-pressed={listening}
          aria-label={listening ? "Release to send question" : "Hold to ask a question by voice"}
          onPointerDown={(e) => {
            e.preventDefault();
            void onStartAsk();
          }}
          onPointerUp={() => void onStopAsk()}
          onPointerLeave={() => {
            if (listening) void onStopAsk();
          }}
          onContextMenu={(e) => e.preventDefault()}
          onKeyDown={handleMicKeyDown}
          onKeyUp={handleMicKeyUp}
          className={`relative flex h-20 touch-none select-none items-center justify-center overflow-hidden rounded-2xl border-2 text-lg font-bold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950 disabled:opacity-60 ${
            listening
              ? "border-red-500 bg-red-600 text-white shadow-[0_0_50px_-10px_rgba(239,68,68,0.7)]"
              : "border-neutral-700 bg-neutral-900 text-neutral-100 hover:border-neutral-500 hover:bg-neutral-800"
          }`}
        >
          {listening && (
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 animate-ping rounded-[14px] border-2 border-red-400/70"
            />
          )}
          <Mic className="mr-2 h-7 w-7" aria-hidden />
          {listening ? "Sun raha hoon… chhod do" : "Mic dabao, poochho"}
        </button>
      </div>

      <div className="space-y-3 rounded-2xl border border-neutral-800 bg-neutral-900/60 px-4 py-3 backdrop-blur">
        <label className="flex cursor-pointer items-center gap-3 text-sm font-medium text-neutral-300">
          <Switch
            checked={live}
            onCheckedChange={onLiveChange}
            aria-label="Live feedback — quick one-line update every ~3 seconds"
            className="data-[state=checked]:bg-amber-400 data-[state=unchecked]:bg-neutral-700"
          />
          <Radio className="h-4 w-4 text-amber-400" aria-hidden />
          Live Feedback
          <span className="text-xs font-normal text-neutral-500">
            har ~3 sec camera ka turant chhota feedback
          </span>
        </label>

        <label className="flex cursor-pointer items-center gap-3 text-sm font-medium text-neutral-300">
          <Switch
            checked={nazar}
            onCheckedChange={onNazarChange}
            aria-label="Nazar mode — silent danger watch, speaks only when something is risky"
            className="data-[state=checked]:bg-red-500 data-[state=unchecked]:bg-neutral-700"
          />
          <Eye className="h-4 w-4 text-red-400" aria-hidden />
          Nazar mode
          <span className="text-xs font-normal text-neutral-500">
            sirf khatra hone par bolunga — har 5 sec check
          </span>
        </label>

        {speaking && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onStopSpeaking}
            aria-label="Stop speaking"
            className="h-10 border-red-500/60 bg-transparent text-red-300 hover:bg-red-500/10 hover:text-red-200"
          >
            <VolumeX className="mr-1.5 h-4 w-4" aria-hidden />
            Bolna band karo
          </Button>
        )}
      </div>

      {/* Hidden helper for screen readers about status */}
      <p className="sr-only">Current status: {status}</p>
    </section>
  );
}
