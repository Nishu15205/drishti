"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { captureFromVideo, type CapturedFrame } from "@/lib/drishti/media";

export type CameraState = "idle" | "starting" | "live" | "error";

export interface UseCameraResult {
  state: CameraState;
  error: string | null;
  registerVideo: (el: HTMLVideoElement | null) => void;
  captureFrame: (maxWidth?: number) => CapturedFrame | null;
  start: () => Promise<boolean>;
  stop: () => void;
}

export function useCamera(): UseCameraResult {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [state, setState] = useState<CameraState>("idle");
  const [error, setError] = useState<string | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    const el = videoRef.current;
    if (el) el.srcObject = null;
    setState("idle");
  }, []);

  const start = useCallback(async () => {
    if (streamRef.current) return true;
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      setError("Camera not supported in this browser. Use the demo photos below.");
      setState("error");
      return false;
    }
    setState("starting");
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "environment",
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      streamRef.current = stream;
      const el = videoRef.current;
      if (el) {
        el.srcObject = stream;
        void el.play().catch(() => undefined);
      }
      setState("live");
      return true;
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      if (name === "NotAllowedError") {
        setError("Camera permission denied. Allow camera access, or use demo photos below.");
      } else if (name === "NotFoundError" || name === "OverconstrainedError") {
        setError("No camera found on this device. Use the demo photos below.");
      } else {
        setError("Camera unavailable. Use the demo photos below.");
      }
      setState("error");
      return false;
    }
  }, []);

  const registerVideo = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el;
  }, []);

  const captureFrame = useCallback(
    (maxWidth?: number): CapturedFrame | null => {
      const video = videoRef.current;
      if (!video || state !== "live") return null;
      return captureFromVideo(video, maxWidth);
    },
    [state]
  );

  useEffect(() => () => stop(), [stop]);

  return { state, error, registerVideo, captureFrame, start, stop };
}
