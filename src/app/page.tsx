"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ChevronRight, Eye, Languages, Users } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import { useDrishti } from "@/hooks/use-drishti";
import { LANGS } from "@/lib/drishti/constants";
import { DEMO_PHOTOS } from "@/lib/drishti/constants";
import { ActionBar } from "@/components/drishti/action-bar";
import { AmbientBg } from "@/components/drishti/ambient-bg";
import { CameraStage } from "@/components/drishti/camera-stage";
import { DemoGallery } from "@/components/drishti/demo-gallery";
import { InsightFeed } from "@/components/drishti/insight-feed";
import { InstallBanner } from "@/components/pwa/install-banner";
import { MemoryPanel, type MemoryKind } from "@/components/drishti/memory-panel";
import { ModeSelector } from "@/components/drishti/mode-selector";
import { PipelineFooter } from "@/components/drishti/pipeline-footer";
import { SettingsPanel } from "@/components/drishti/settings-panel";
import { SosButton } from "@/components/drishti/sos-button";
import { StatStrip } from "@/components/drishti/stat-strip";
import {
  captureFromImageUrl,
  type CapturedFrame,
} from "@/lib/drishti/media";

export default function DrishtiPage() {
  const drishti = useDrishti();
  const {
    camera,
    mode,
    setMode,
    lang,
    setLang,
    speed,
    setSpeed,
    status,
    statusText,
    busy,
    live,
    setLive,
    nazar,
    setNazar,
    demo,
    selectDemo,
    feed,
    clearHistory,
    describe,
    startAsk,
    stopAsk,
    stopSpeaking,
    replay,
    listening,
    speaking,
    speechSupported,
    voiceCommandState,
    voiceCmdsOn,
    toggleVoiceCmds,
  } = drishti;

  /* Keyboard shortcuts: Space = describe, hold M = talk */
  useEffect(() => {
    const isTyping = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable);

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      if (e.code === "Space") {
        e.preventDefault();
        if (!e.repeat) void describe();
      } else if (e.code === "KeyM" && !e.repeat) {
        e.preventDefault();
        void startAsk();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "KeyM" && !isTyping(e.target)) {
        void stopAsk();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [describe, startAsk, stopAsk]);

  /* PWA home-screen shortcut: /?action=scan starts a scan right away */
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("action") !== "scan") {
      return;
    }
    const timer = setTimeout(() => void describe(), 800);
    return () => clearTimeout(timer);
  }, [describe]);

  const handleRetryCamera = useCallback(() => {
    void camera.start();
  }, [camera]);

  const handleUseDemo = useCallback(() => {
    selectDemo(DEMO_PHOTOS[0] ?? null);
  }, [selectDemo]);

  /* Pehchaan / Yaad: manage saved faces & items */
  const [memOpen, setMemOpen] = useState(false);
  const memoryKind: MemoryKind = mode === "yaad" ? "item" : "face";

  // Camera frame for registering a face/item — falls back to the matching
  // demo photo when the camera is unavailable (sandbox, denied permission)
  const captureMemoryFrame = useCallback(async (): Promise<CapturedFrame | null> => {
    try {
      const frame = camera.captureFrame(320);
      if (frame) return frame;
    } catch {
      /* fall through to demo image */
    }
    const fallbackUrl =
      memoryKind === "face" ? "/demo/person.png" : "/demo/keys.png";
    try {
      return await captureFromImageUrl(fallbackUrl, 320);
    } catch {
      return null;
    }
  }, [camera, memoryKind]);

  const wakeActiveHint =
    lang === "hi" ? "सुन रहा हूँ — “स्कैन” बोलें" : "Listening — say “scan”";
  const wakeBlockedHint =
    lang === "hi"
      ? "माइक ब्लॉक है — browser में mic की अनुमति दें"
      : "Mic blocked — browser me mic allow karo";
  const wakeUnsupportedHint =
    lang === "hi"
      ? "इस browser में voice wake नहीं चलता — बटन दबाएँ"
      : "Voice wake unsupported here — buttons dabao";

  return (
    <div className="relative isolate flex min-h-screen flex-col bg-neutral-950 text-neutral-100 [color-scheme:dark]">
      <AmbientBg />

      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-neutral-800 bg-neutral-950/85 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-2.5 px-3 py-2 sm:gap-3 sm:px-4 sm:py-3">
          <div className="relative shrink-0" aria-hidden>
            <span className="absolute inset-0 animate-ping rounded-xl bg-amber-400/25 [animation-duration:2.6s] sm:rounded-2xl" />
            <div className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-amber-300 to-orange-500 text-black shadow-lg shadow-amber-500/40 sm:h-11 sm:w-11 sm:rounded-2xl">
              <Eye className="h-5 w-5 sm:h-6 sm:w-6" />
            </div>
          </div>
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-lg font-extrabold tracking-tight sm:text-xl">
              <span className="drishti-gradient-text">Drishti</span>
              <span className="hidden rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-amber-300 md:inline">
                Working Prototype
              </span>
            </h1>
            <p className="hidden truncate text-xs text-neutral-400 min-[420px]:block">
              AI Eye for the Blind — aankh nahi, kaan se dekho
            </p>
          </div>

          <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
            {/* Quick language toggle */}
            <div
              className="flex items-center rounded-xl border border-neutral-800 bg-neutral-900 p-1"
              role="group"
              aria-label="Voice language quick toggle"
            >
              <Languages className="mx-1 h-4 w-4 text-neutral-500 sm:mx-1.5" aria-hidden />
              {LANGS.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  aria-pressed={lang === l.id}
                  onClick={() => setLang(l.id)}
                  aria-label={`Switch voice language to ${l.label}`}
                  className={`min-h-[32px] rounded-lg px-2.5 text-sm font-bold transition sm:px-3 ${
                    lang === l.id
                      ? "bg-amber-400 text-black"
                      : "text-neutral-400 hover:text-neutral-200"
                  }`}
                >
                  {l.short}
                </button>
              ))}
            </div>

            <SettingsPanel
              lang={lang}
              onLangChange={setLang}
              speed={speed}
              onSpeedChange={setSpeed}
              speechSupported={speechSupported}
              voiceCmdsOn={voiceCmdsOn}
              onVoiceCmdsChange={toggleVoiceCmds}
              voiceCommandState={voiceCommandState}
            />
          </div>
        </div>
      </header>

      {/* Screen-reader live status */}
      <div aria-live="polite" role="status" className="sr-only">
        {statusText}
      </div>

      {/* Main */}
      <main className="mx-auto w-full max-w-6xl flex-1 px-3 py-4 sm:px-4 sm:py-6">
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
        >
          <StatStrip />
        </motion.div>

        <div className="mt-4 grid gap-4 sm:mt-5 sm:gap-5 lg:grid-cols-5 lg:gap-6">
          {/* Left column: camera + controls (min-w-0 keeps the demo strip's
              intrinsic width from inflating the grid track on phones) */}
          <motion.section
            aria-label="Camera and controls"
            className="min-w-0 space-y-4 lg:col-span-3"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
          >
            <InstallBanner />

            <CameraStage
              cameraState={camera.state}
              cameraError={camera.error}
              registerVideo={camera.registerVideo}
              demo={demo}
              status={status}
              statusText={statusText}
              wakeState={voiceCommandState}
              wakeHint={wakeActiveHint}
              wakeBlockedHint={wakeBlockedHint}
              wakeUnsupportedHint={wakeUnsupportedHint}
              onRetryCamera={handleRetryCamera}
              onUseDemo={handleUseDemo}
              onClearDemo={() => selectDemo(null)}
            />

            {/* Primary actions sit right under the camera — one glance / one
                thumb-reach away on phones */}
            <ActionBar
              status={status}
              busy={busy}
              listening={listening}
              speaking={speaking}
              live={live}
              nazar={nazar}
              onDescribe={() => void describe()}
              onStartAsk={() => void startAsk()}
              onStopAsk={() => void stopAsk()}
              onStopSpeaking={stopSpeaking}
              onLiveChange={setLive}
              onNazarChange={setNazar}
            />

            <ModeSelector mode={mode} onChange={setMode} disabled={busy} />

            {(mode === "pehchaan" || mode === "yaad") && (
              <button
                type="button"
                onClick={() => setMemOpen(true)}
                aria-label={
                  mode === "pehchaan"
                    ? "Apne log add karo ya manage karo"
                    : "Cheezein add karo ya manage karo"
                }
                className="flex w-full items-center justify-between rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-sm font-semibold text-amber-200 transition hover:bg-amber-400/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
              >
                <span className="flex items-center gap-2">
                  <Users className="h-4 w-4" aria-hidden />
                  {mode === "pehchaan"
                    ? "Apne log add / manage karo"
                    : "Cheezein add / manage karo"}
                </span>
                <ChevronRight className="h-4 w-4" aria-hidden />
              </button>
            )}

            <DemoGallery demo={demo} onSelect={selectDemo} />
          </motion.section>

          {/* Right column: insights */}
          <motion.section
            aria-label="Insight history"
            className="min-w-0 lg:col-span-2 lg:sticky lg:top-20 lg:self-start"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: "easeOut", delay: 0.12 }}
          >
            <InsightFeed feed={feed} onReplay={replay} onClear={clearHistory} />
          </motion.section>
        </div>
      </main>

      <PipelineFooter />

      <SosButton />
      <MemoryPanel
        open={memOpen}
        onOpenChange={setMemOpen}
        kind={memoryKind}
        onCapture={captureMemoryFrame}
      />

      <Toaster position="top-center" richColors closeButton />
    </div>
  );
}
