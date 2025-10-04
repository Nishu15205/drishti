// Client-side media helpers: frame capture, WAV recording, speech playback

import type { Lang } from "./constants";

/* ------------------------- Frame capture ------------------------- */

export interface CapturedFrame {
  image: string; // full-size jpeg dataURL for VLM
  thumb: string; // small jpeg dataURL for history
}

// Default VLM input width — small enough for fast upload/encoding,
// large enough for OCR-style modes.
// Scene frames go small & light: A/B-measured on the vision backend —
// 640px q0.75 vs 800px q0.8 cut ~0.3s off time-to-first-token and ~1s off
// total latency, with no noticeable quality loss for scene narration.
export const FRAME_MAX_WIDTH = 640;
export const FRAME_MAX_WIDTH_OCR = 1024; // text/medicine need sharper detail

function captureFromSource(
  el: CanvasImageSource,
  srcW: number,
  srcH: number,
  maxWidth: number
): CapturedFrame | null {
  if (!srcW || !srcH) return null;
  const scale = Math.min(1, maxWidth / srcW);
  const cw = Math.max(1, Math.round(srcW * scale));
  const ch = Math.max(1, Math.round(srcH * scale));

  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(el, 0, 0, cw, ch);
  // Scene frames (small) compress harder; OCR frames keep more quality so
  // labels/boards stay readable.
  const quality = maxWidth <= FRAME_MAX_WIDTH ? 0.75 : 0.8;
  const image = canvas.toDataURL("image/jpeg", quality);

  const thumbW = 160;
  const thumbH = Math.max(1, Math.round((ch / cw) * thumbW));
  const tCanvas = document.createElement("canvas");
  tCanvas.width = thumbW;
  tCanvas.height = thumbH;
  tCanvas.getContext("2d")?.drawImage(canvas, 0, 0, thumbW, thumbH);
  const thumb = tCanvas.toDataURL("image/jpeg", 0.55);

  return { image, thumb };
}

export function captureFromVideo(
  video: HTMLVideoElement,
  maxWidth: number = FRAME_MAX_WIDTH
): CapturedFrame | null {
  if (!video.videoWidth) return null;
  return captureFromSource(video, video.videoWidth, video.videoHeight, maxWidth);
}

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load demo image"));
    img.src = url;
  });
}

export async function captureFromImageUrl(
  url: string,
  maxWidth: number = FRAME_MAX_WIDTH
): Promise<CapturedFrame | null> {
  const img = await loadImage(url);
  return captureFromSource(img, img.naturalWidth, img.naturalHeight, maxWidth);
}

/* ------------------------- WAV recording ------------------------- */

export interface RecordingSession {
  stop: () => Promise<string | null>; // resolves base64 WAV (16 kHz mono)
  cancel: () => void;
}

function floatToWavBase64(samples: Float32Array, sampleRate: number): string {
  const bytes = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(bytes);
  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  let binary = "";
  const u8 = new Uint8Array(bytes);
  const CH = 0x8000;
  for (let i = 0; i < u8.length; i += CH) {
    binary += String.fromCharCode(...u8.subarray(i, i + CH));
  }
  return btoa(binary);
}

async function blobToWavBase64(blob: Blob): Promise<string> {
  const arrayBuffer = await blob.arrayBuffer();
  const AC: typeof AudioContext =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AC();
  const decoded = await ctx.decodeAudioData(arrayBuffer);
  await ctx.close();

  const targetRate = 16000;
  const frames = Math.max(1, Math.ceil(decoded.duration * targetRate));
  const offline = new OfflineAudioContext(1, frames, targetRate);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start(0);
  const rendered = await offline.startRendering();
  return floatToWavBase64(rendered.getChannelData(0), targetRate);
}

export async function startRecording(): Promise<RecordingSession> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
  const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const parts: BlobPart[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) parts.push(e.data);
  };
  recorder.start();

  const cleanup = () => stream.getTracks().forEach((t) => t.stop());
  const collect = () => new Blob(parts, { type: recorder.mimeType || "audio/webm" });

  return {
    stop: () =>
      new Promise<string | null>((resolve) => {
        const finish = async () => {
          cleanup();
          const blob = collect();
          if (blob.size < 1200) {
            resolve(null);
            return;
          }
          try {
            resolve(await blobToWavBase64(blob));
          } catch {
            resolve(null);
          }
        };
        if (recorder.state === "inactive") {
          finish();
        } else {
          recorder.onstop = finish;
          try {
            recorder.stop();
          } catch {
            finish();
          }
        }
      }),
    cancel: () => {
      try {
        if (recorder.state !== "inactive") recorder.stop();
      } catch {
        /* noop */
      }
      cleanup();
    },
  };
}

/* ------------------------- Speech output ------------------------- */

/**
 * Playback rate for streamed audio pieces flagged rate:true (Google TTS
 * synthesizes at a fixed pace; the user's pace is applied at playback,
 * pitch-corrected). English speaks a notch slower — user request — so its
 * effective rate is speed×0.8. Hindi keeps its own (faster) pace.
 */
export function playbackRateFor(lang: Lang, speed: number): number {
  return lang === "en" ? Math.max(0.5, speed * 0.8) : speed;
}

let playToken = 0;
let currentAudio: HTMLAudioElement | null = null;

export function cancelSpeech(): void {
  playToken++;
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.removeAttribute("src");
    currentAudio = null;
  }
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
}

/* --------------------- device voice (pure Hindi) --------------------- */
// Browser Hindi voices (Edge "Swara", Chrome "Google हिन्दी", Android TTS,
// macOS "Lekha") pronounce Devanagari natively — far more "pure Hindi"
// than any cloud voice we have. Cached; invalidated on voiceschanged
// because engines load their voice list asynchronously.

let cachedHindiVoice: SpeechSynthesisVoice | null | undefined;

function listVoices(): SpeechSynthesisVoice[] {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return [];
  return window.speechSynthesis.getVoices() ?? [];
}

export function getHindiVoice(): SpeechSynthesisVoice | null {
  if (cachedHindiVoice !== undefined) return cachedHindiVoice;
  const voices = listVoices();
  cachedHindiVoice =
    voices.find((v) => v.lang?.toLowerCase().startsWith("hi")) ?? null;
  return cachedHindiVoice;
}

if (typeof window !== "undefined" && "speechSynthesis" in window) {
  try {
    window.speechSynthesis.addEventListener("voiceschanged", () => {
      cachedHindiVoice = undefined; // re-check on next call
    });
  } catch {
    /* older engines */
  }
}

/**
 * True while ANY audio is actually playing right now — a streamed audio
 * element or the device speechSynthesis queue. The hook's speaking-stall
 * watchdog uses this to tell "playback is wedged" (reset to idle) apart
 * from "the voice is legitimately still talking" (leave it alone).
 */
export function isPlaybackActive(): boolean {
  if (currentAudio && !currentAudio.ended) return true;
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    return window.speechSynthesis.speaking || window.speechSynthesis.pending;
  }
  return false;
}

function pickVoice(
  lang: Lang,
  voices: SpeechSynthesisVoice[]
): SpeechSynthesisVoice | null {
  const prefix = lang === "hi" ? "hi" : "en";
  if (lang === "en") {
    // INDIAN ENGLISH FIRST (user request: "completely indian english accent").
    // Device rescue must never pick a foreign-accented en voice when a real
    // Indian English voice (en-IN / name-matched) exists on the device.
    const enVoices = voices.filter((v) =>
      v.lang?.toLowerCase().startsWith("en")
    );
    const indian =
      enVoices.find((v) => v.lang?.toLowerCase().startsWith("en-in")) ??
      enVoices.find((v) =>
        /india|neerja|heera|ravi|raveena|prabhat|kajal/i.test(v.name)
      );
    if (indian) return indian;
    const primary = enVoices[0];
    if (primary) return primary;
    // No "en" voice at all — nothing usable for English.
    return null;
  }
  const primary = voices.find((v) => v.lang?.toLowerCase().startsWith(prefix));
  if (primary) return primary;
  // For Hindi, ONLY a real Hindi voice — an English voice reading
  // Devanagari produces gibberish, which is worse than an error.
  return null;
}

/** Assign a voice with a lang fallback (some engines reject voice objects). */
function applyVoice(
  utter: SpeechSynthesisUtterance,
  voice: SpeechSynthesisVoice | null,
  fallbackLang = "hi-IN"
): void {
  if (!voice) {
    utter.lang = fallbackLang;
    return;
  }
  try {
    utter.voice = voice;
    utter.lang = voice.lang;
  } catch {
    // Cross-realm or non-instance voice object — the lang hint still
    // steers the engine to that language's default voice.
    utter.lang = voice.lang || fallbackLang;
  }
}

/** Sentence pieces small enough that network voices don't truncate. */
function utterancePieces(text: string): string[] {
  const sentences = text
    .split(/(?<=[।.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const pieces: string[] = [];
  for (const s of sentences) {
    if (s.length <= 240) {
      pieces.push(s);
      continue;
    }
    let cur = "";
    for (const word of s.split(/\s+/)) {
      if (cur && `${cur} ${word}`.length > 220) {
        pieces.push(cur);
        cur = word;
      } else {
        cur = cur ? `${cur} ${word}` : word;
      }
    }
    if (cur.trim()) pieces.push(cur.trim());
  }
  return pieces;
}

/**
 * Speak with the device's speechSynthesis, queueing sentence-sized
 * utterances in order. Returns false when no usable voice exists.
 * A watchdog guards against engines that drop end events.
 */
function speakWithBrowserQueue(
  text: string,
  lang: Lang,
  rate: number,
  onDone: () => void
): boolean {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return false;
  const voices = listVoices();
  if (!voices.length) return false;
  const voice = pickVoice(lang, voices);
  if (!voice) return false;

  const pieces = utterancePieces(text);
  if (!pieces.length) return false;

  let remaining = pieces.length;
  let finished = false;
  const finish = () => {
    if (!finished) {
      finished = true;
      onDone();
    }
  };
  const clamped = Math.min(2, Math.max(0.5, rate));

  for (const piece of pieces) {
    const utter = new SpeechSynthesisUtterance(piece);
    applyVoice(utter, voice);
    utter.rate = clamped;
    const step = () => {
      remaining--;
      if (remaining <= 0) finish();
    };
    utter.onend = step;
    utter.onerror = step;
    window.speechSynthesis.speak(utter);
  }
  // Watchdog: some engines never fire onend (network voice hiccup).
  const estimateMs = (text.length * 90) / clamped + 6000;
  setTimeout(finish, estimateMs);
  return true;
}

interface SpeakOptions {
  text: string;
  lang: Lang;
  speed: number;
  onDone?: () => void;
  onError?: (message: string) => void;
}

function browserSpeak(text: string, lang: Lang, rate: number, onDone: () => void): boolean {
  return speakWithBrowserQueue(text, lang, rate, onDone);
}

interface SpeechStreamHandlers {
  onQuestion?: (question: string) => void;
  onText?: (text: string) => void;
  onFirstAudio?: () => void;
}

/** Playback tuning shared by device-voice lines and streamed audio. */
interface PlaybackOpt {
  voice?: SpeechSynthesisVoice | null;
  rate?: number;
}

/**
 * Play one base64 audio chunk. `rate` (from the server, e.g. Hindi MP3
 * chunks) speeds up playback pitch-corrected — the Hindi voice synthesizes
 * at normal speed, and the requested pace is applied at playback.
 */
function playAudioElement(b64: string, mime: string, rate?: number): HTMLAudioElement {
  const audio = new Audio(`data:${mime};base64,${b64}`);
  if (rate && rate !== 1) {
    audio.playbackRate = Math.min(2, Math.max(0.5, rate));
    // Keep the voice natural (speed without the chipmunk pitch shift)
    const media = audio as HTMLAudioElement & {
      preservesPitch?: boolean;
      webkitPreservesPitch?: boolean;
    };
    try {
      media.preservesPitch = true;
      media.webkitPreservesPitch = true;
    } catch {
      /* older engines default to pitch-corrected anyway */
    }
  }
  return audio;
}

/**
 * Consume a streaming speech NDJSON response (/api/analyze, /api/ask or
 * /api/speak): play audio lines in order as they arrive — or, in device-
 * voice mode, speak `say` lines (Devanagari sentences) through the local
 * speechSynthesis queue the moment each arrives. Resolves with the number
 * of audio/say chunks played, AFTER local playback drains. Stops
 * immediately if the play token changes.
 *
 * Throw semantics: throws ONLY when the stream failed before ANY audio
 * played (total silence — caller should rescue). Partial failures resolve
 * normally with the count of chunks that did play.
 *
 * Return value: the number of audio/say chunks played — or -1 when the
 * playback token was bumped mid-stream (cancelSpeech started a newer
 * action). Callers MUST treat -1 as "superseded, stay silent": no error
 * toasts, no rescue speech, no status changes — a newer flow owns the
 * app now. (The old behaviour — falling through to a rescue with stale
 * text — used to fight the newer flow for the speaker and surfaced
 * phantom "Analysis failed — empty response" errors.)
 */
async function consumeSpeechNdjson(
  res: Response,
  token: number,
  handlers: SpeechStreamHandlers = {},
  playback?: PlaybackOpt
): Promise<number> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let played = 0;
  // A terminal {"error"} line no longer THROWS — a mid-stream TTS failure
  // must not discard the audio/text the user already received. The caller
  // decides what to do based on the returned chunk count.
  let streamError: string | null = null;

  const playOne = (b64: string, mime: string, rate?: number) =>
    new Promise<void>((resolve) => {
      if (token !== playToken) {
        resolve();
        return;
      }
      const audio = playAudioElement(b64, mime, rate);
      currentAudio = audio;
      const release = () => {
        if (currentAudio === audio) currentAudio = null; // keep isPlaybackActive honest
        resolve();
      };
      audio.onended = release;
      audio.onerror = release;
      audio.play().catch(release);
    });

  // ---- device-voice queue state ("say" lines) ----
  let pendingSay = 0;
  let streamDone = false;
  let lastSayChange = Date.now();
  let finishPlayback: (() => void) | null = null;

  const maybeFinish = () => {
    if (streamDone && pendingSay <= 0 && finishPlayback) {
      const fn = finishPlayback;
      finishPlayback = null;
      fn();
    }
  };

  const speakSay = (text: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const utter = new SpeechSynthesisUtterance(text);
    applyVoice(utter, playback?.voice ?? null);
    utter.rate = Math.min(2, Math.max(0.5, playback?.rate ?? 1.5));
    pendingSay++;
    lastSayChange = Date.now();
    const step = () => {
      pendingSay--;
      lastSayChange = Date.now();
      maybeFinish();
    };
    utter.onend = step;
    utter.onerror = step;
    window.speechSynthesis.speak(utter); // engine queues in order
  };

  let done = false;
  while (!done) {
    const { done: streamEnded, value } = await reader.read();
    if (token !== playToken) {
      try {
        reader.cancel();
      } catch {
        /* stream already closed */
      }
      return -1; // superseded — caller must stay silent
    }
    if (streamEnded) break;
    buffer += decoder.decode(value, { stream: true });

    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      const msg = JSON.parse(line) as {
        audio?: string;
        mime?: string;
        rate?: boolean;
        text?: string;
        question?: string;
        say?: string;
        done?: boolean;
        error?: string;
      };
      if (msg.error) {
        streamError = msg.error;
        done = true;
        break;
      }
      if (msg.question) handlers.onQuestion?.(msg.question);
      if (msg.text) handlers.onText?.(msg.text);
      if (msg.say) {
        if (played === 0) handlers.onFirstAudio?.();
        speakSay(msg.say);
        played++;
      }
      if (msg.audio) {
        if (played === 0) handlers.onFirstAudio?.();
        // rate flag → server synthesized at normal speed; apply the user's
        // pace here, pitch-corrected (Hindi API path)
        await playOne(
          msg.audio,
          msg.mime ?? "audio/wav",
          msg.rate ? playback?.rate : undefined
        ); // sequential, ordered playback
        played++;
      }
      if (msg.done) done = true;
    }
  }

  if (pendingSay > 0) {
    // Wait for the device voice queue to drain (with a stall watchdog —
    // some engines drop end events when audio output hiccups).
    streamDone = true;
    await new Promise<void>((resolve) => {
      finishPlayback = resolve;
      const interval = setInterval(() => {
        if (
          token !== playToken ||
          pendingSay <= 0 ||
          Date.now() - lastSayChange > 9000
        ) {
          clearInterval(interval);
          resolve();
        }
      }, 500);
    });
  }
  if (streamError && played === 0 && token === playToken) {
    // Nothing played at all — surface the failure so callers can rescue
    // with the device voice.
    throw new Error(streamError);
  }
  return played;
}

/**
 * Public wrapper for the describe/ask flows: consumes a streaming speech
 * response (audio plays in order), returns the number of chunks played —
 * or -1 when a newer action superseded this playback (caller: stay silent).
 * Playback is cancellable via cancelSpeech() at any moment.
 */
export function speakFromStream(
  res: Response,
  handlers: SpeechStreamHandlers = {},
  playback?: PlaybackOpt
): Promise<number> {
  return consumeSpeechNdjson(res, playToken, handlers, playback);
}

/**
 * Speak text aloud by streaming /api/speak. For Hindi the server uses
 * Google's native Hindi voice (pure Indian accent, Devanagari in — speech
 * out); the user's speed is applied pitch-corrected at playback. On any
 * failure before audio starts, fall back to the device's own voice.
 */
export async function speakText(opts: SpeakOptions): Promise<void> {
  const { text, lang, speed } = opts;
  if (!text.trim()) return;
  cancelSpeech();
  const token = playToken;

  try {
    const res = await fetch("/api/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, lang, speed }),
    });
    if (!res.ok || !res.body) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(data?.error ?? "Speech service unavailable");
    }
    const played = await consumeSpeechNdjson(res, token, {}, {
      rate: playbackRateFor(lang, speed),
    });
    if (token !== playToken) return;
    if (played > 0) {
      opts.onDone?.(); // all (or partial) audio finished playing
      return;
    }
    throw new Error("No audio generated");
  } catch (err) {
    if (token !== playToken) return;
    // Cloud failed before anything played — fall back to the device
    // voice, if a usable one exists
    const spoke = browserSpeak(text, lang, speed, () => {
      if (token === playToken) opts.onDone?.();
    });
    if (!spoke) {
      opts.onError?.(err instanceof Error ? err.message : "Speech failed");
    }
  }
}

export function beep(freq = 660, durationMs = 120): void {
  try {
    const AC: typeof AudioContext =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    osc.type = "sine";
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + durationMs / 1000);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + durationMs / 1000);
    osc.onended = () => ctx.close();
  } catch {
    /* audio feedback is best-effort */
  }
}
