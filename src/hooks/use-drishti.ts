"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  DEMO_PHOTOS,
  DEFAULT_SPEEDS,
  type DemoPhoto,
  type Lang,
  type ModeId,
} from "@/lib/drishti/constants";
import {
  beep,
  cancelSpeech,
  captureFromImageUrl,
  FRAME_MAX_WIDTH,
  FRAME_MAX_WIDTH_OCR,
  isPlaybackActive,
  playbackRateFor,
  speakFromStream,
  speakText,
  startRecording,
  type CapturedFrame,
  type RecordingSession,
} from "@/lib/drishti/media";
import { useCamera } from "@/hooks/use-camera";
import { useVoiceCommands, type VoiceCommandState } from "@/hooks/use-voice-commands";

export type DrishtiStatus =
  | "idle"
  | "capturing"
  | "thinking"
  | "listening"
  | "speaking";

export interface HistoryItem {
  id: string;
  kind: "describe" | "ask";
  mode: string;
  language: string;
  question?: string | null;
  answer: string;
  thumb?: string | null;
  source: string;
  createdAt: string;
}

// User request: "camera move ho raha hai toh har ~3 sec jo camera dekhe
// uska turant chhota feedback" — live ticks hit a dedicated fast endpoint
// (/api/live, one short sentence) instead of the full scan pipeline.
const LIVE_INTERVAL_MS = 3000;
const MAX_LISTEN_MS = 10000;

const STATUS_TEXT: Record<Lang, Record<DrishtiStatus, string>> = {
  en: {
    idle: "Say “scan” — or tap the describe button.",
    capturing: "Capturing…",
    thinking: "Drishti is looking…",
    listening: "Listening… release to ask.",
    speaking: "Speaking… tap stop to interrupt.",
  },
  hi: {
    idle: "“स्कैन” बोलिए — या बटन दबाएँ।",
    capturing: "फोटो ली जा रही है…",
    thinking: "दृष्टि देख रहा है…",
    listening: "सुन रहा हूँ… छोड़कर पूछें।",
    speaking: "बोल रहा हूँ… रोकने के लिए स्टॉप दबाएँ।",
  },
};

export function useDrishti() {
  const camera = useCamera();

  const [mode, setModeState] = useState<ModeId>("scene");
  const [lang, setLangState] = useState<Lang>("en");
  // Each language keeps its own pace (EN calm, HI fast) — switching language
  // restores that language's last-used speed
  const [speeds, setSpeeds] = useState<Record<Lang, number>>({ ...DEFAULT_SPEEDS });
  const [status, setStatus] = useState<DrishtiStatus>("idle");
  const [live, setLiveState] = useState(false);
  const [demo, setDemo] = useState<DemoPhoto | null>(null);
  const [feed, setFeed] = useState<HistoryItem[]>([]);
  const [speechSupported, setSpeechSupported] = useState(true);
  const speechWarnedRef = useRef(false);

  // Always-on wake-word mic ("scan" bolne par auto scan) — user can disable
  const [voiceCmdsOn, setVoiceCmdsOn] = useState(true);
  const [wakeSuppressed, setWakeSuppressed] = useState(false);
  const voiceDeniedWarnedRef = useRef(false);

  const recordingRef = useRef<RecordingSession | null>(null);
  const listenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusRef = useRef<DrishtiStatus>("idle");
  const frameRef = useRef<CapturedFrame | null>(null);
  const demoRef = useRef<DemoPhoto | null>(null);
  const langRef = useRef<Lang>("en");
  const speedRef = useRef<number>(DEFAULT_SPEEDS.en);
  const modeRef = useRef<ModeId>("scene");
  const feedRef = useRef<HistoryItem[]>([]);
  // Demo photos are static — capture+encode once per photo, reuse forever
  const demoFrameCacheRef = useRef<Map<string, CapturedFrame>>(new Map());

  statusRef.current = status;
  demoRef.current = demo;
  langRef.current = lang;
  const speed = speeds[lang];
  speedRef.current = speed;
  modeRef.current = mode;
  feedRef.current = feed;

  const statusText = STATUS_TEXT[lang][status];
  const busy = status === "capturing" || status === "thinking";

  /* ----------------------- status helpers ----------------------- */

  // When the current "speaking" phase began — the stall watchdog measures
  // from this moment so a legitimately long answer is never interrupted.
  const speakingSinceRef = useRef(0);
  // True while a describe/ask NDJSON speech stream is being consumed. The
  // watchdog pauses while this is set: a server stream can have multi-second
  // gaps between chunks (synthesis latency) that are NOT stalls.
  const streamActiveRef = useRef(false);

  const safeSetStatus = useCallback((next: DrishtiStatus) => {
    if (next === "speaking" && statusRef.current !== "speaking") {
      speakingSinceRef.current = Date.now();
    }
    setStatus(next);
    statusRef.current = next;
  }, []);

  /* ---------------------- live tick plumbing -------------------- */
  // Declared EARLY: describe/identify/startAsk abort an in-flight live
  // tick, so their dependency arrays need stopLiveTick defined first.

  const liveBusyRef = useRef(false);
  const liveAbortRef = useRef<AbortController | null>(null);
  const lastLiveTextRef = useRef<{ text: string; at: number }>({
    text: "",
    at: 0,
  });

  const stopLiveTick = useCallback(() => {
    liveAbortRef.current?.abort();
    liveAbortRef.current = null;
  }, []);

  // describe is declared BEFORE setLive but turns live off when the camera
  // is unavailable — a ref bridges the declaration order (useCallback deps
  // arrays evaluate immediately at render, so putting setLive in describe's
  // deps throws a TDZ ReferenceError).
  const setLiveRef = useRef<(on: boolean) => void>(() => {});

  /**
   * THE one way to interrupt whatever is playing: bump the playback token
   * AND reset the status. Every cancelSpeech() call site must either use
   * this or reset the status itself — a bare cancelSpeech() leaves the
   * status stuck at "speaking" forever: the cancelled flow's onDone never
   * fires, so the wake-word mic stays closed (app stops hearing "scan" —
   * user-reported bug) and every new scan is silently blocked.
   */
  const interruptSpeech = useCallback(() => {
    cancelSpeech();
    if (statusRef.current === "speaking") safeSetStatus("idle");
  }, [safeSetStatus]);

  /* ------------------------- history ---------------------------- */

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/history");
      if (!res.ok) return;
      const data = (await res.json()) as { items?: HistoryItem[] };
      setFeed(Array.isArray(data.items) ? data.items : []);
    } catch {
      /* history is non-critical */
    }
  }, []);

  const clearHistory = useCallback(async () => {
    interruptSpeech();
    setFeed([]);
    try {
      await fetch("/api/history", { method: "DELETE" });
    } catch {
      /* ignore */
    }
  }, [interruptSpeech]);

  const prependFeed = useCallback((item: HistoryItem) => {
    setFeed((prev) => [item, ...prev].slice(0, 50));
  }, []);

  /* -------------------------- speech ---------------------------- */

  const speak = useCallback(
    (text: string, itemLang: Lang = langRef.current) => {
      safeSetStatus("speaking");
      speakText({
        text,
        lang: itemLang,
        speed: speedRef.current,
        onDone: () => {
          if (statusRef.current === "speaking") safeSetStatus("idle");
        },
        onError: (message) => {
          setSpeechSupported(false);
          safeSetStatus("idle");
          console.warn("[drishti] speech error:", message);
          if (!speechWarnedRef.current) {
            speechWarnedRef.current = true;
            toast.warning("Voice output unavailable", {
              description: "Speaker / audio output check karo. Text feed mein sab dikh raha hai.",
            });
          }
        },
      });
    },
    [safeSetStatus]
  );

  const stopSpeaking = useCallback(() => {
    cancelSpeech();
    if (statusRef.current === "speaking") safeSetStatus("idle");
  }, [safeSetStatus]);

  /* ------------------------ frame capture ----------------------- */

  const captureFrame = useCallback(async (): Promise<CapturedFrame | null> => {
    // Reading modes need sharper frames; scene stays small & fast
    const maxWidth =
      modeRef.current === "scene" ? FRAME_MAX_WIDTH : FRAME_MAX_WIDTH_OCR;
    const activeDemo = demoRef.current;
    if (activeDemo) {
      const cached = demoFrameCacheRef.current.get(activeDemo.id);
      if (cached) return cached;
      const frame = await captureFromImageUrl(activeDemo.url, maxWidth);
      if (frame) demoFrameCacheRef.current.set(activeDemo.id, frame);
      return frame;
    }
    try {
      return camera.captureFrame(maxWidth);
    } catch {
      return null;
    }
  }, [camera.captureFrame]);

  /* ----------------- identify (pehchaan / yaad) ------------------ */

  const identify = useCallback(async () => {
    stopLiveTick(); // manual action wins over an in-flight live tick
    if (statusRef.current !== "idle") return;
    safeSetStatus("capturing");
    beep(720, 90);

    let frame: CapturedFrame | null = null;
    try {
      frame = await captureFrame();
    } catch {
      frame = null;
    }
    if (!frame) {
      safeSetStatus("idle");
      toast.error("No camera frame", {
        description: "Camera allow karo ya neeche demo photo chuno.",
      });
      return;
    }
    frameRef.current = frame;

    safeSetStatus("thinking");
    const mode = modeRef.current; // "pehchaan" | "yaad"
    try {
      const res = await fetch(
        mode === "pehchaan" ? "/api/recognize" : "/api/find-item",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: frame.image, lang: langRef.current }),
        }
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(
          data?.error ??
            (mode === "pehchaan" ? "Pehchaan failed" : "Search failed")
        );
      }
      const data = (await res.json()) as { spoken?: string };
      const spoken = (data.spoken ?? "").trim();
      if (!spoken) throw new Error("Empty response");
      prependFeed({
        id: `local-${Date.now()}`,
        kind: "describe",
        mode,
        language: langRef.current,
        question: null,
        answer: spoken,
        thumb: frame.thumb,
        source: demoRef.current ? `demo:${demoRef.current.id}` : "camera",
        createdAt: new Date().toISOString(),
      });
      speak(spoken);
    } catch (err) {
      safeSetStatus("idle");
      const message = err instanceof Error ? err.message : "Please try again";
      toast.error(
        mode === "pehchaan" ? "Pehchaan failed" : "Search failed",
        { description: message }
      );
      console.error("[drishti] identify failed:", err);
    }
  }, [captureFrame, prependFeed, safeSetStatus, speak, stopLiveTick]);

  /* -------------------------- describe -------------------------- */

  const describe = useCallback(async () => {
    // An in-flight live tick must never block a manual scan — abort it.
    stopLiveTick();
    // Tapping describe while a voice answer plays should interrupt the
    // speech, not silently do nothing (blind UX: no dead buttons).
    if (statusRef.current === "speaking") interruptSpeech();
    if (statusRef.current !== "idle") return;
    // Pehchaan/Yaad use a different endpoint (compare vs saved memories)
    if (modeRef.current === "pehchaan" || modeRef.current === "yaad") {
      return identify();
    }
    safeSetStatus("capturing");
    beep(720, 90);

    let frame: CapturedFrame | null = null;
    try {
      frame = await captureFrame();
    } catch {
      frame = null;
    }
    if (!frame) {
      safeSetStatus("idle");
      setLiveRef.current(false); // live mode needs a working camera
      toast.error("No camera frame", {
        description: "Camera allow karo ya neeche demo photo chuno.",
      });
      console.warn("[drishti] no frame available");
      return;
    }
    frameRef.current = frame;

    safeSetStatus("thinking");

    const runScan = async (isRetry: boolean): Promise<void> => {
      try {
        // Hindi streams through Google's native Hindi voice server-side
        // (pure Indian accent) — no device-voice dependency, so the accent is
        // identical on every device. English streams Google's en-IN voice
        // (Indian English — user request).
        const res = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            image: frame!.image,
            mode: modeRef.current,
            lang: langRef.current,
            speed: speedRef.current,
            thumb: frame!.thumb,
            source: demoRef.current ? `demo:${demoRef.current.id}` : "camera",
          }),
        });
        if (!res.ok || !res.body) {
          const data = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(data?.error ?? "Analysis failed");
        }
        const source = demoRef.current ? `demo:${demoRef.current.id}` : "camera";
        let answer = "";
        streamActiveRef.current = true;
        let played: number;
        try {
          played = await speakFromStream(
            res,
            {
              onFirstAudio: () => safeSetStatus("speaking"),
              onText: (text) => {
                answer = text;
                prependFeed({
                  id: `local-${Date.now()}`,
                  kind: "describe",
                  mode: modeRef.current,
                  language: langRef.current,
                  question: null,
                  answer: text,
                  thumb: frame!.thumb,
                  source,
                  createdAt: new Date().toISOString(),
                });
              },
            },
            { rate: playbackRateFor(langRef.current, speedRef.current) }
          );
        } finally {
          streamActiveRef.current = false;
        }
        if (played < 0) {
          // Superseded — a newer scan/ask/live flow owns playback now.
          // Stay SILENT: the old behaviour threw a phantom
          // "Analysis failed — empty response" right over the new scan.
          return;
        }
        if (!answer) {
          // One silent retry with the SAME frame — a blind user must not be
          // told "try again" for a transient empty model response.
          if (!isRetry) {
            console.warn("[drishti] empty analysis — retrying once silently");
            safeSetStatus("thinking");
            await runScan(true);
            return;
          }
          throw new Error("Analysis failed — empty response");
        }
        if (played === 0) {
          // Cloud voice died before saying a word, but we HAVE the full text.
          // Rescue with the device voice — a blind user must never be left
          // with silence after a successful scan.
          console.warn("[drishti] server audio missing — device-voice rescue");
          toast.info("Device voice se bol raha hoon", {
            description: "Server voice skip ho gayi — jawab text feed mein bhi hai.",
          });
          speak(answer);
        } else if (
          statusRef.current === "speaking" ||
          statusRef.current === "thinking"
        ) {
          safeSetStatus("idle");
        }
      } catch (err) {
        safeSetStatus("idle");
        const message = err instanceof Error ? err.message : "Please try again";
        toast.error("Scan fail ho gaya", {
          description: `${message} — phir se try karo.`,
        });
        console.error("[drishti] describe failed:", err);
      }
    };

    await runScan(false);
  }, [
    captureFrame,
    identify,
    interruptSpeech,
    prependFeed,
    safeSetStatus,
    speak,
    stopLiveTick,
  ]);

  /* ---------------------------- ask ----------------------------- */

  const stopAsk = useCallback(async () => {
    if (listenTimerRef.current) {
      clearTimeout(listenTimerRef.current);
      listenTimerRef.current = null;
    }
    const session = recordingRef.current;
    if (!session) return;
    recordingRef.current = null;
    beep(440, 110);
    safeSetStatus("thinking");
    setWakeSuppressed(false);

    const wav = await session.stop();
    if (!wav) {
      safeSetStatus("idle");
      return;
    }

    let frame = frameRef.current;
    if (!frame) {
      try {
        frame = await captureFrame();
      } catch {
        frame = null;
      }
    }

    try {
      const recent = feedRef.current
        .filter((i) => i.kind === "ask" && i.question)
        .slice(0, 2)
        .flatMap((i) => [
          { role: "user" as const, content: i.question ?? "" },
          { role: "assistant" as const, content: i.answer },
        ]);

      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audio: wav,
          image: frame?.image,
          lang: langRef.current,
          speed: speedRef.current,
          thumb: frame?.thumb,
          source: demoRef.current ? `demo:${demoRef.current.id}` : "camera",
          history: recent,
        }),
      });
      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "Could not answer");
      }
      const source = demoRef.current ? `demo:${demoRef.current.id}` : "camera";
      let question = "";
      let answer = "";
      streamActiveRef.current = true;
      let played: number;
      try {
        played = await speakFromStream(
          res,
          {
            onQuestion: (q) => {
              question = q;
            },
            onFirstAudio: () => safeSetStatus("speaking"),
            onText: (text) => {
              answer = text;
              prependFeed({
                id: `local-${Date.now()}`,
                kind: "ask",
                mode: "ask",
                language: langRef.current,
                question,
                answer: text,
                thumb: frame?.thumb ?? null,
                source,
                createdAt: new Date().toISOString(),
              });
            },
          },
          { rate: playbackRateFor(langRef.current, speedRef.current) }
        );
      } finally {
        streamActiveRef.current = false;
      }
      if (played < 0) return; // superseded — a newer action owns playback
      if (!answer) throw new Error("Could not answer");
      if (played === 0) {
        // Same device-voice rescue as the describe flow — text arrived,
        // audio didn't. Speak the answer locally instead of failing.
        console.warn("[drishti] server audio missing — device-voice rescue");
        toast.info("Device voice se bol raha hoon", {
          description: "Server voice skip ho gayi — jawab text feed mein bhi hai.",
        });
        speak(answer);
      } else if (statusRef.current === "speaking") {
        safeSetStatus("idle");
      } else if (statusRef.current === "thinking") {
        safeSetStatus("idle");
      }
    } catch (err) {
      safeSetStatus("idle");
      const message = err instanceof Error ? err.message : "Please try again";
      toast.error("Jawab nahi mil paya", {
        description: `${message} — phir se try karo.`,
      });
      console.error("[drishti] ask failed:", err);
    }
  }, [captureFrame, prependFeed, safeSetStatus, speak]);

  const startAsk = useCallback(async () => {
    stopLiveTick(); // mic wins over an in-flight live tick
    // Interrupt current speech instead of ignoring the press
    if (statusRef.current === "speaking") {
      interruptSpeech();
    }
    if (statusRef.current !== "idle") return;
    cancelSpeech();
    // Park the wake-word mic first — some phones refuse a second mic stream
    setWakeSuppressed(true);
    try {
      const session = await startRecording();
      recordingRef.current = session;
      safeSetStatus("listening");
      beep(880, 100);
      listenTimerRef.current = setTimeout(() => {
        void stopAsk();
      }, MAX_LISTEN_MS);
    } catch (err) {
      console.error("[drishti] mic failed:", err);
      safeSetStatus("idle");
      setWakeSuppressed(false);
      toast.error("Mic not available", {
        description: "Microphone permission check karo ya phir se try karo.",
      });
    }
  }, [interruptSpeech, safeSetStatus, stopAsk, stopLiveTick]);

  /* ------------------------ settings ------------------------- */

  const setMode = useCallback(
    (next: ModeId) => {
      interruptSpeech();
      setModeState(next);
      modeRef.current = next;
    },
    [interruptSpeech]
  );

  const setLang = useCallback(
    (next: Lang) => {
      interruptSpeech();
      setLangState(next);
      langRef.current = next;
    },
    [interruptSpeech]
  );

  const setSpeed = useCallback((next: number) => {
    speedRef.current = next; // in-flight flows pick it up immediately
    setSpeeds((prev) => ({ ...prev, [langRef.current]: next }));
  }, []);

  const selectDemo = useCallback(
    (photo: DemoPhoto | null) => {
      interruptSpeech();
      setDemo(photo);
      demoRef.current = photo;
      if (photo) {
        setModeState(photo.mode);
        modeRef.current = photo.mode;
      }
    },
    [interruptSpeech]
  );

  const replay = useCallback(
    (item: HistoryItem) => {
      interruptSpeech();
      speak(item.answer, (item.language === "hi" ? "hi" : "en"));
    },
    [interruptSpeech, speak]
  );

  /* -------------------- always-on wake-word mic ------------------ */

  useEffect(() => {
    try {
      if (localStorage.getItem("drishti-voice-cmds") === "off") {
        setVoiceCmdsOn(false);
      }
    } catch {
      /* private mode */
    }
  }, []);

  const toggleVoiceCmds = useCallback((on: boolean) => {
    setVoiceCmdsOn(on);
    try {
      localStorage.setItem("drishti-voice-cmds", on ? "on" : "off");
    } catch {
      /* ignore */
    }
  }, []);

  const voiceCommandState: VoiceCommandState = useVoiceCommands({
    enabled: voiceCmdsOn && !wakeSuppressed,
    // Live Feedback ke short sentences ke dauran bhi mic OPEN rakhte hain —
    // warna har ~3s me mic band ho kar user ka "scan" miss ho jata hai.
    // Live sentences me "scan" word kabhi nahi hota, self-trigger safe.
    active: status === "idle" || (live && status === "speaking"),
    onWake: () => void describe(),
  });

  // One-time nudge when the mic permission is blocked
  useEffect(() => {
    if (voiceCommandState === "denied" && !voiceDeniedWarnedRef.current) {
      voiceDeniedWarnedRef.current = true;
      toast.warning("Mic blocked", {
        description:
          "Bolne se scan karne ke liye mic allow karo — browser settings ya address bar se.",
      });
    }
  }, [voiceCommandState]);

  /* ---------------- speaking-stall watchdog ---------------- */
  // If the status says "speaking" but nothing is actually playing and no
  // server stream is being consumed, playback was cancelled without its
  // onDone firing (e.g. setLive/setMode interrupted it, an audio element
  // hung). Self-heal to idle — the wake-word mic only listens while idle,
  // so a stuck "speaking" made the app permanently deaf to "scan" and
  // blocked every new scan until a page reload.
  useEffect(() => {
    const timer = setInterval(() => {
      if (statusRef.current !== "speaking") return;
      if (streamActiveRef.current) return; // server stream alive — gaps are normal
      if (isPlaybackActive()) return; // voice legitimately still talking
      if (Date.now() - speakingSinceRef.current < 7000) return;
      console.warn("[drishti] speaking stall detected → idle (watchdog)");
      safeSetStatus("idle");
    }, 1500);
    return () => clearInterval(timer);
  }, [safeSetStatus]);

  /* --------------------------- live mode ------------------------ */
  // Turant Nazar: har ~3 sec ek LOW-RES frame /api/live ko jaata hai —
  // ONE short sentence (≤12 words) wapas aata hai. Same baat 15 sec ke
  // andar dobara nahi boli jaati (no nagging), aur user ka koi bhi manual
  // action (scan / ask / mic) live tick ko turant abort kar deta hai.

  const liveTick = useCallback(async () => {
    if (!live || liveBusyRef.current) return;
    if (statusRef.current !== "idle") return; // speaking/thinking → skip
    liveBusyRef.current = true;
    const ac = new AbortController();
    liveAbortRef.current = ac;
    try {
      // Demo-aware capture (demo photo ya live camera) — scene frames
      // chhote hote hain, upload fast rehta hai.
      let frame: CapturedFrame | null = null;
      try {
        frame = await captureFrame();
      } catch {
        frame = null;
      }
      if (!frame) return;
      const res = await fetch("/api/live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: frame.image, lang: langRef.current }),
        signal: ac.signal,
      });
      if (!res.ok || ac.signal.aborted) return;
      const data = (await res.json().catch(() => null)) as {
        spoken?: string;
      } | null;
      const text = (data?.spoken ?? "").trim();
      if (!text || ac.signal.aborted) return;
      if (statusRef.current !== "idle") return; // user ne kuch shuru kar diya
      const now = Date.now();
      const last = lastLiveTextRef.current;
      if (text === last.text && now - last.at < 15000) return; // no nagging
      lastLiveTextRef.current = { text, at: now };
      // Speaking status suppresses the wake-word mic (no self-triggering
      // from Drishti's own voice) and pauses further live ticks.
      safeSetStatus("speaking");
      speakText({
        text,
        lang: langRef.current,
        speed: speedRef.current,
        onDone: () => {
          if (statusRef.current === "speaking") safeSetStatus("idle");
        },
        onError: () => {
          if (statusRef.current === "speaking") safeSetStatus("idle");
        },
      });
    } catch {
      /* live ticks are best-effort — network hiccups silently skip */
    } finally {
      liveBusyRef.current = false;
      if (liveAbortRef.current === ac) liveAbortRef.current = null;
    }
  }, [captureFrame, live, safeSetStatus]);

  const liveTickRef = useRef(liveTick);
  useEffect(() => {
    liveTickRef.current = liveTick;
  }, [liveTick]);

  useEffect(() => {
    if (!live) return;
    const first = setTimeout(() => void liveTickRef.current(), 700);
    const timer = setInterval(() => void liveTickRef.current(), LIVE_INTERVAL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      stopLiveTick();
    };
  }, [live, stopLiveTick]);

  const setLive = useCallback(
    (on: boolean) => {
      // interruptSpeech (not bare cancelSpeech): toggling Live OFF while a
      // live tick is speaking must also reset the status — otherwise the
      // cancelled tick's onDone never fires and the app wedges in
      // "speaking": mic closed, scans blocked, watchdog was the only cure.
      interruptSpeech();
      stopLiveTick();
      setLiveState(on);
      if (on) {
        beep(880, 100);
        toast.success("Live Feedback ON", {
          description:
            "Har ~3 sec camera jo dekhega, uska chhota turant feedback bolega.",
        });
      }
    },
    [interruptSpeech, stopLiveTick]
  );
  setLiveRef.current = setLive; // bridge for describe (declared earlier)

  /* --------------------- nazar (danger watch) -------------------- */
  // Silent guardian: every ~5.5s a low-res frame goes to /api/watch; the
  // model answers SKIP for safe scenes. The user hears NOTHING unless
  // there is real danger — silence is the feature.

  const [nazar, setNazarState] = useState(false);
  const nazarBusyRef = useRef(false);
  const lastNazarAlertRef = useRef<{ text: string; at: number }>({
    text: "",
    at: 0,
  });

  const nazarTick = useCallback(async () => {
    if (!nazar || statusRef.current !== "idle" || nazarBusyRef.current) return;
    nazarBusyRef.current = true;
    try {
      // Demo-aware capture: demo photo chal raha ho to demo frame, warna live camera.
      // Pehle ye sirf camera.captureFrame(480) tha — demo photos pe Nazar silently dead tha.
      const frame = await captureFrame();
      if (!frame) return;
      const res = await fetch("/api/watch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: frame.image, lang: langRef.current }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { alert?: boolean; spoken?: string };
      if (!data.alert || !data.spoken) return;
      const now = Date.now();
      const last = lastNazarAlertRef.current;
      if (data.spoken === last.text && now - last.at < 30000) return; // no nagging
      lastNazarAlertRef.current = { text: data.spoken, at: now };
      beep(980, 140);
      prependFeed({
        id: `local-${Date.now()}`,
        kind: "describe",
        mode: "nazar",
        language: langRef.current,
        question: null,
        answer: data.spoken,
        thumb: frame.thumb,
        source: demoRef.current ? `demo:${demoRef.current.id}` : "camera",
        createdAt: new Date().toISOString(),
      });
      speak(data.spoken);
    } catch {
      /* watch ticks are best-effort and silent */
    } finally {
      nazarBusyRef.current = false;
    }
  }, [captureFrame, nazar, prependFeed, speak]);

  const nazarTickRef = useRef(nazarTick);
  useEffect(() => {
    nazarTickRef.current = nazarTick;
  }, [nazarTick]);

  useEffect(() => {
    if (!nazar) return;
    const first = setTimeout(() => void nazarTickRef.current(), 900);
    const timer = setInterval(() => void nazarTickRef.current(), 5500);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [nazar]);

  const setNazar = useCallback((on: boolean) => {
    interruptSpeech(); // same wedge rule as setLive
    setNazarState(on);
    if (on) {
      beep(880, 100);
      toast.success("Nazar Mode ON", {
        description: "Har 5 sec scene check hota hai — sirf khatre par bolunga.",
      });
    }
  }, [interruptSpeech]);

  /* ----------------------------- init --------------------------- */

  useEffect(() => {
    void loadHistory();
    void camera.start();
  }, []);

  // Pre-encode demo frames in the background right after load — the first
  // demo scan then captures instantly instead of downloading + decoding the
  // photo mid-scan (that delay is felt on every scan).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const photo of DEMO_PHOTOS) {
        if (cancelled) return;
        if (demoFrameCacheRef.current.has(photo.id)) continue;
        try {
          // Same width rule as captureFrame — reading modes need sharper frames
          const maxWidth =
            photo.mode === "scene" ? FRAME_MAX_WIDTH : FRAME_MAX_WIDTH_OCR;
          const frame = await captureFromImageUrl(photo.url, maxWidth);
          if (cancelled) return;
          if (frame) demoFrameCacheRef.current.set(photo.id, frame);
        } catch {
          /* prefetch is best effort */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return {
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
    loadHistory,
    clearHistory,
    describe,
    startAsk,
    stopAsk,
    stopSpeaking,
    replay,
    speechSupported,
    voiceCommandState,
    voiceCmdsOn,
    toggleVoiceCmds,
    listening: status === "listening",
    speaking: status === "speaking",
  };
}
