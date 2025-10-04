"use client";

import { motion } from "framer-motion";
import {
  Camera,
  CameraOff,
  Eye,
  Loader2,
  Mic,
  MicOff,
  Radio,
  ScanEye,
  Volume2,
  X,
} from "lucide-react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { VoiceBars } from "@/components/drishti/voice-bars";
import type { DemoPhoto } from "@/lib/drishti/constants";
import type { CameraState } from "@/hooks/use-camera";
import type { DrishtiStatus } from "@/hooks/use-drishti";
import type { VoiceCommandState } from "@/hooks/use-voice-commands";

interface CameraStageProps {
  cameraState: CameraState;
  cameraError: string | null;
  registerVideo: (el: HTMLVideoElement | null) => void;
  demo: DemoPhoto | null;
  status: DrishtiStatus;
  statusText: string;
  wakeState: VoiceCommandState;
  wakeHint: string;
  wakeBlockedHint: string;
  wakeUnsupportedHint: string;
  onRetryCamera: () => void;
  onUseDemo: () => void;
  onClearDemo: () => void;
}

function StatusIcon({ status }: { status: DrishtiStatus }) {
  const cls = "h-4 w-4 shrink-0";
  switch (status) {
    case "capturing":
      return <Camera className={`${cls} animate-bounce`} />;
    case "thinking":
      return <Loader2 className={`${cls} animate-spin`} />;
    case "listening":
      return <Mic className={`${cls} text-red-400`} />;
    case "speaking":
      return <Volume2 className={`${cls} animate-pulse text-amber-300`} />;
    default:
      return <Eye className={cls} />;
  }
}

export function CameraStage({
  cameraState,
  cameraError,
  registerVideo,
  demo,
  status,
  statusText,
  wakeState,
  wakeHint,
  wakeBlockedHint,
  wakeUnsupportedHint,
  onRetryCamera,
  onUseDemo,
  onClearDemo,
}: CameraStageProps) {
  const showIdleOverlay = !demo && cameraState !== "live";

  return (
    <div className="relative w-full rounded-2xl bg-gradient-to-br from-amber-400/70 via-neutral-800 to-orange-500/60 p-px shadow-[0_0_70px_-18px_rgba(251,191,36,0.5)]">
      <div
        className="relative aspect-[4/3] w-full overflow-hidden rounded-[15px] bg-neutral-900 sm:aspect-video"
        role="img"
        aria-label={
          demo
            ? `Demo photo: ${demo.label}`
            : "Live camera view — what Drishti can see"
        }
      >
      {/* Live video stays mounted so the stream survives demo switches */}
      <video
        ref={registerVideo}
        playsInline
        muted
        autoPlay
        className={demo ? "hidden" : "h-full w-full object-cover"}
      />

      {demo && (
        <Image
          src={demo.url}
          alt={`Demo photo: ${demo.label}`}
          fill
          priority
          sizes="(max-width: 1024px) 100vw, 60vw"
          className="object-cover"
        />
      )}

      {/* Scanning beam while the VLM thinks */}
      {status === "thinking" && (
        <>
          <motion.div
            aria-hidden
            className="pointer-events-none absolute left-0 right-0 h-24 bg-gradient-to-b from-transparent via-amber-300/15 to-transparent blur-xl"
            initial={{ top: "-25%" }}
            animate={{ top: ["-25%", "110%"] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: "linear" }}
          />
          <motion.div
            aria-hidden
            className="pointer-events-none absolute left-0 right-0 h-20 bg-gradient-to-b from-transparent via-amber-400/25 to-transparent"
            initial={{ top: "-25%" }}
            animate={{ top: ["-25%", "110%"] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: "linear" }}
          />
        </>
      )}

      {/* Viewfinder corner brackets — camera-target feel (painted after
          video/overlays so they stay visible, badges painted later sit on top) */}
      <div aria-hidden className="pointer-events-none absolute inset-2 sm:inset-3">
        <span className="absolute left-0 top-0 h-5 w-5 rounded-tl-md border-l-2 border-t-2 border-amber-300/50" />
        <span className="absolute right-0 top-0 h-5 w-5 rounded-tr-md border-r-2 border-t-2 border-amber-300/50" />
        <span className="absolute bottom-0 left-0 h-5 w-5 rounded-bl-md border-b-2 border-l-2 border-amber-300/50" />
        <span className="absolute bottom-0 right-0 h-5 w-5 rounded-br-md border-b-2 border-r-2 border-amber-300/50" />
      </div>

      {/* Idle / error overlay */}
      {showIdleOverlay && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-neutral-950/80 p-6 text-center backdrop-blur-sm">
          {cameraState === "starting" ? (
            <>
              <Loader2 className="h-10 w-10 animate-spin text-amber-400" aria-hidden />
              <p className="font-medium text-neutral-200">Camera start ho raha hai…</p>
            </>
          ) : (
            <>
              <CameraOff className="h-10 w-10 text-neutral-500" aria-hidden />
              <p className="max-w-sm text-sm text-neutral-300">
                {cameraError ?? "Camera band hai."}
              </p>
              <div className="mt-1 flex flex-wrap justify-center gap-2">
                <Button
                  onClick={onRetryCamera}
                  className="bg-amber-400 font-semibold text-black hover:bg-amber-300"
                >
                  <Camera className="mr-2 h-4 w-4" aria-hidden />
                  Camera retry
                </Button>
                <Button
                  variant="outline"
                  onClick={onUseDemo}
                  className="border-neutral-700 bg-neutral-900 text-neutral-100 hover:bg-neutral-800"
                >
                  <ScanEye className="mr-2 h-4 w-4" aria-hidden />
                  Demo photo se shuru karo
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Demo badge */}
      {demo && (
        <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-amber-400 px-3 py-1 text-xs font-bold text-black shadow-lg">
          <ScanEye className="h-3.5 w-3.5" aria-hidden />
          DEMO · {demo.label}
          <button
            type="button"
            onClick={onClearDemo}
            aria-label="Close demo photo and return to camera"
            className="ml-1 rounded-full p-0.5 hover:bg-black/15"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      )}

      {/* Wake-word mic badge — har state dikhe taaki user ko pata rahe
          mic sun raha hai ya nahi (blind UX: invisible mic = confusion) */}
      {(wakeState === "listening" || wakeState === "starting") && (
        <div
          className={`absolute left-3 flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-xs font-semibold text-amber-300 backdrop-blur ${
            demo ? "top-12" : "top-3"
          }`}
          role="status"
        >
          <Mic className="h-3.5 w-3.5 animate-pulse" aria-hidden />
          {wakeHint}
        </div>
      )}
      {wakeState === "denied" && (
        <div
          className={`absolute left-3 flex items-center gap-1.5 rounded-full bg-red-950/80 px-2.5 py-1 text-xs font-semibold text-red-300 backdrop-blur ${
            demo ? "top-12" : "top-3"
          }`}
          role="status"
        >
          <MicOff className="h-3.5 w-3.5" aria-hidden />
          {wakeBlockedHint}
        </div>
      )}
      {wakeState === "unsupported" && (
        <div
          className={`absolute left-3 flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-xs font-semibold text-neutral-300 backdrop-blur ${
            demo ? "top-12" : "top-3"
          }`}
          role="status"
        >
          <MicOff className="h-3.5 w-3.5" aria-hidden />
          {wakeUnsupportedHint}
        </div>
      )}

      {/* Live badge */}
      {!demo && cameraState === "live" && (
        <div className="absolute right-3 top-3 flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1 text-xs font-semibold text-neutral-100 backdrop-blur">
          <Radio className="h-3.5 w-3.5 animate-pulse text-red-500" aria-hidden />
          LIVE
        </div>
      )}

      {/* Status pill */}
      <div
        className={`absolute bottom-3 left-3 flex max-w-[calc(100%-1.5rem)] items-center gap-2 rounded-full px-3.5 py-2 text-xs font-medium backdrop-blur sm:text-sm ${
          status === "listening"
            ? "bg-red-600/90 text-white"
            : "bg-black/70 text-neutral-100"
        }`}
      >
        {status === "speaking" ? (
          <VoiceBars className="shrink-0 text-amber-300" />
        ) : (
          <StatusIcon status={status} />
        )}
        <span className="truncate">{statusText}</span>
        {status === "listening" && (
          <span className="h-2 w-2 shrink-0 animate-ping rounded-full bg-white" aria-hidden />
        )}
      </div>
      </div>
    </div>
  );
}
