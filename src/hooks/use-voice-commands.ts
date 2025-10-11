"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

/* ------------------------------------------------------------------ */
/* Wake-word listener — "microphone hamesha on" for blind users.       */
/*                                                                     */
/* Listens continuously while the app is idle. Saying "scan" (or       */
/* स्कैन / skain / skan) auto-triggers a hands-free scan. The mic is   */
/* paused during every busy state (capturing / thinking / speaking /   */
/* listening) so the app's own TTS voice never re-triggers it and the  */
/* hold-to-talk ask flow never fights it for the microphone.           */
/* ------------------------------------------------------------------ */

// Wake word matching — ASR Indian-accent "scan" ko bahut tarike se
// likhta hai (scan/skans/skin/sken/scanned…). Loose list rakhi hai:
// under-trigger (user bole aur na ho) over-trigger se zyada kharab hai.
// False positives acceptable hain — TRIGGER_COOLDOWN + "can" jaise common
// words list me NAHI hain.
const WAKE_REGEX =
  /\b(scan|scans|scanned|scanning|scanner|scanners|scane|scaney|scanne|skan|skans|skanned|skanning|skanner|skain|skains|skaine|skane|skanes|sken|skens|skin|skins)\b/;
const WAKE_DEVANAGARI = ["स्कैन", "स्केन"];

// TTS khatam hone ke baad mic itni der baad khulta hai (apni hi awaaz se
// self-trigger se bachne ke liye). 1.2s lamba tha — user jawab khatam hote
// hi "scan" bolti hai, toh 0.9s kaafi hai.
const ECHO_GUARD_MS = 900;
const TRIGGER_COOLDOWN_MS = 4000;
const RESTART_BASE_MS = 500;
const RESTART_MAX_MS = 3000;

export type VoiceCommandState =
  | "unsupported" // no SpeechRecognition in this browser
  | "denied" // mic permission blocked
  | "off" // disabled by user setting or app busy
  | "starting"
  | "listening";

interface RecognitionResultLike {
  resultIndex: number;
  results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }>;
}

interface RecognitionErrorLike {
  error: string;
}

interface RecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: (() => void) | null;
  onresult: ((event: RecognitionResultLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: RecognitionErrorLike) => void) | null;
}

type RecognitionCtor = new () => RecognitionLike;

function getRecognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/* The store never changes — we only want the SSR-safe snapshot machinery:
 * server (and first client render) reads `false`, then React re-renders
 * with the real browser value AFTER hydration. A plain useState initializer
 * would diverge (Node: false vs Chrome: true) and break hydration in every
 * browser that ships SpeechRecognition. */
const subscribeNothing = () => () => {};
const getSupportedClient = () => getRecognitionCtor() !== null;
const getSupportedServer = () => false;

interface UseVoiceCommandsOptions {
  /** Master switch from settings (default on) */
  enabled: boolean;
  /** True only when the app is idle — busy states keep the mic closed */
  active: boolean;
  /** Called when the wake word is heard */
  onWake: () => void;
}

export function useVoiceCommands({
  enabled,
  active,
  onWake,
}: UseVoiceCommandsOptions) {
  // Support is a browser fact read through useSyncExternalStore so the
  // server and the first client render agree (both "unsupported"); real
  // support appears right after hydration and only drives client badges.
  const supported = useSyncExternalStore(
    subscribeNothing,
    getSupportedClient,
    getSupportedServer
  );

  // Mic machinery state — updated only from async recognition callbacks
  const [running, setRunning] = useState(false);
  const [denied, setDenied] = useState(false);

  // Exposed state is derived: no setState during render/effects needed
  const state: VoiceCommandState = !supported
    ? "unsupported"
    : denied
      ? "denied"
      : !enabled || !active
        ? "off"
        : running
          ? "listening"
          : "starting";

  const recRef = useRef<RecognitionLike | null>(null);
  const runningRef = useRef(false);
  const wantListenRef = useRef(false);
  const lastTriggerRef = useRef(0);
  const backoffRef = useRef(0);
  const lastErrorRef = useRef<string>("");
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onWakeRef = useRef(onWake);
  const enabledRef = useRef(enabled);
  const activeRef = useRef(active);
  const deniedRef = useRef(denied);

  /* Sync the latest props into refs after every commit so recognition
   * callbacks and the gesture kick always read fresh values. */
  useEffect(() => {
    onWakeRef.current = onWake;
    enabledRef.current = enabled;
    activeRef.current = active;
    deniedRef.current = denied;
  });

  const clearRestartTimer = useCallback(() => {
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
  }, []);

  const stopListening = useCallback(() => {
    wantListenRef.current = false;
    clearRestartTimer();
    const rec = recRef.current;
    recRef.current = null;
    runningRef.current = false;
    if (rec) {
      rec.onend = null;
      rec.onresult = null;
      rec.onerror = null;
      rec.onstart = null;
      try {
        rec.stop();
      } catch {
        /* already stopped */
      }
    }
  }, [clearRestartTimer]);

  const startListeningRef = useRef<() => void>(() => {});

  const scheduleRestart = useCallback(
    (delay: number) => {
      clearRestartTimer();
      restartTimerRef.current = setTimeout(() => {
        restartTimerRef.current = null;
        startListeningRef.current();
      }, delay);
    },
    [clearRestartTimer]
  );

  const startListening = useCallback(() => {
    if (!wantListenRef.current || runningRef.current) return;

    // Chrome cannot restart a stopped instance — create a fresh one each time
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    recRef.current = rec;
    rec.continuous = true;
    rec.interimResults = true;
    // en-IN recognises Indian-accented speech; spoken "स्कैन" surfaces as
    // latin "scan/skain" variants which all match the wake regex.
    rec.lang = "en-IN";

    rec.onstart = () => {
      backoffRef.current = 0;
      runningRef.current = true;
      setRunning(true);
      setDenied(false);
    };

    rec.onresult = (event) => {
      if (!wantListenRef.current) return;
      const now = Date.now();
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = (result?.[0]?.transcript ?? "").toLowerCase().trim();
        if (!transcript) continue;
        if (WAKE_REGEX.test(transcript)) {
          console.debug("[voice-cmd] wake word heard:", transcript);
        }
        const hit =
          WAKE_REGEX.test(transcript) ||
          WAKE_DEVANAGARI.some((w) => transcript.includes(w));
        if (hit && now - lastTriggerRef.current >= TRIGGER_COOLDOWN_MS) {
          lastTriggerRef.current = now;
          stopListening(); // close the mic before the scan pipeline opens
          onWakeRef.current();
          return;
        }
      }
    };

    rec.onerror = (event) => {
      const err = event?.error ?? "";
      lastErrorRef.current = err;
      console.debug("[voice-cmd] recognition error:", err);
      if (
        err === "not-allowed" ||
        err === "service-not-allowed" ||
        err === "audio-capture"
      ) {
        // Permission blocked or no microphone — stop retrying, surface it
        wantListenRef.current = false;
        runningRef.current = false;
        setRunning(false);
        setDenied(true);
      }
      // no-speech / network / aborted → onend restarts with backoff
    };

    rec.onend = () => {
      runningRef.current = false;
      setRunning(false);
      if (!wantListenRef.current || document.visibilityState === "hidden") {
        return;
      }
      // "no-speech" is just silence in continuous mode — normal, not a
      // failure. Restart QUICKLY with no backoff growth so the mic never
      // sits in a long dead window while the user is talking to it.
      const delay =
        lastErrorRef.current === "no-speech"
          ? 350
          : Math.min(
              RESTART_BASE_MS * 2 ** backoffRef.current,
              RESTART_MAX_MS
            );
      if (lastErrorRef.current !== "no-speech") {
        backoffRef.current = Math.min(backoffRef.current + 1, 4);
      }
      scheduleRestart(delay);
    };

    try {
      rec.start();
    } catch {
      // start() throws when an instance is already active — retry shortly
      scheduleRestart(RESTART_BASE_MS);
    }
  }, [scheduleRestart, stopListening]);

  useEffect(() => {
    startListeningRef.current = startListening;
  });

  /* Arm / disarm with the app state (enabled && idle) — ref/DOM work only;
   * all state changes flow through async recognition callbacks. */
  useEffect(() => {
    if (getRecognitionCtor() === null) return;
    if (enabled && active) {
      if (wantListenRef.current) return;
      wantListenRef.current = true;
      const timer = setTimeout(() => {
        if (wantListenRef.current) startListeningRef.current();
      }, ECHO_GUARD_MS);
      return () => clearTimeout(timer);
    }
    stopListening();
  }, [enabled, active, stopListening]);

  /* Mobile browsers (iOS Safari) need a user gesture before the mic can
   * start — a tap/keydown kicks the listener if it never armed, and also
   * re-arms after a denied permission has been granted in settings. */
  useEffect(() => {
    const kick = () => {
      if (!enabledRef.current || !activeRef.current) return;
      if (runningRef.current || restartTimerRef.current) return;
      if (!wantListenRef.current && !deniedRef.current) return;
      wantListenRef.current = true;
      startListeningRef.current();
    };
    window.addEventListener("pointerdown", kick);
    window.addEventListener("keydown", kick);
    return () => {
      window.removeEventListener("pointerdown", kick);
      window.removeEventListener("keydown", kick);
    };
  }, []);

  /* Chrome kills recognition in hidden tabs — pause cleanly, resume on return */
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        clearRestartTimer();
        try {
          recRef.current?.stop();
        } catch {
          /* ignore */
        }
      } else if (wantListenRef.current && !runningRef.current) {
        scheduleRestart(300);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [clearRestartTimer, scheduleRestart]);

  /* Unmount cleanup */
  useEffect(() => {
    return () => {
      wantListenRef.current = false;
      clearRestartTimer();
      const rec = recRef.current;
      if (rec) {
        rec.onend = null;
        rec.onresult = null;
        rec.onerror = null;
        rec.onstart = null;
        try {
          rec.abort();
        } catch {
          /* ignore */
        }
      }
    };
  }, [clearRestartTimer]);

  return state;
}
