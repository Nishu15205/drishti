// Google translate_tts voice — the "safety net" TTS for Drishti.
//
// The in-app cloud voices cannot read Devanagari (they garble it into Chinese
// syllables), and reading romanized Hindi gives them an English accent. This
// module talks to Google's own translate_tts voice — for Hindi it's the same
// one behind "Google हिन्दी" — which pronounces Devanagari natively with a
// pure Indian accent.
//
// For ENGLISH the locale "en-IN" is the PRIMARY voice (verified live: returns
// 200 audio/mpeg with distinct audio from tl=en) — the user explicitly asked
// for Indian English: "english ki accent chinese hogyi, uski indian english
// me banao". The neutral "en" voice is the per-piece fallback.
//
// Constraints (verified live from this server):
//   - Simple GET, no API key; two hosts, both reachable
//   - ~200 char per-request limit → callers split into ≤180-char chunks
//   - Returns MP3 (24 kHz mono, 64 kbps) — client applies playbackRate for speed

export const HINDI_TTS_MIME = "audio/mpeg";

const GOOGLE_CHUNK_LIMIT = 180; // chars — safely under the ~200 endpoint cap
const GOOGLE_TTS_TIMEOUT_MS = 8_000;

const HOSTS = [
  (q: string, tl: string) =>
    `https://translate.googleapis.com/translate_tts?ie=UTF-8&client=gtx&tl=${tl}&q=${q}`,
  (q: string, tl: string) =>
    `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${tl}&q=${q}`,
];

const HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Referer: "https://translate.google.com/",
};

/** Strip markdown noise so the voice never reads symbols aloud. */
function cleanForTts(raw: string): string {
  return raw
    .replace(/[*_#`>|~]/g, " ")
    .replace(/\s*[\r\n]+\s*/g, ". ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Split text into TTS-safe chunks (≤ max chars) on sentence
 * boundaries (danda / . / ! / ?), falling back to word boundaries for
 * pathologically long sentences. Language-agnostic — used for both the
 * Hindi voice and the English Google fallback.
 */
export function splitHindiChunks(
  input: string,
  max = GOOGLE_CHUNK_LIMIT
): string[] {
  const text = cleanForTts(input);
  if (!text) return [];
  const sentences = text.match(/[^.!?।]+[.!?।]*\s*/g) ?? [text];
  const chunks: string[] = [];
  let current = "";

  const pushCurrent = () => {
    if (current.trim()) chunks.push(current.trim());
    current = "";
  };

  for (const sentence of sentences) {
    if (sentence.length > max) {
      pushCurrent();
      let line = "";
      for (const word of sentence.split(/\s+/)) {
        if (line && `${line} ${word}`.length > max) {
          chunks.push(line.trim());
          line = word;
        } else {
          line = line ? `${line} ${word}` : word;
        }
      }
      if (line.trim()) chunks.push(line.trim());
      continue;
    }
    if ((current + sentence).length <= max) {
      current += sentence;
    } else {
      pushCurrent();
      current = sentence;
    }
  }
  pushCurrent();
  return chunks;
}

export type GoogleTtsLocale = "hi" | "en-IN" | "en";

/**
 * Synthesize one chunk (≤ ~200 chars) with Google's translate_tts voice.
 * Returns base64 MP3. Retries across both hosts with backoff.
 */
export async function synthesizeGoogleTts(
  text: string,
  locale: GoogleTtsLocale = "hi"
): Promise<string> {
  const tl = locale;
  // Splitter keeps chunks ≤180; this is a hard safety cap for direct calls
  const chunk = cleanForTts(text).slice(0, GOOGLE_CHUNK_LIMIT + 20);
  if (!chunk) throw new Error("No text to speak");

  const query = encodeURIComponent(chunk);
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    const buildUrl = HOSTS[attempt % HOSTS.length];
    try {
      const res = await fetch(buildUrl(query, tl), {
        headers: HEADERS,
        signal: AbortSignal.timeout(GOOGLE_TTS_TIMEOUT_MS),
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Google TTS failed (${res.status})`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 512) throw new Error("Google TTS returned empty audio");
      return buf.toString("base64");
    } catch (err) {
      lastError = err;
      // brief backoff, then try the other host
      await new Promise((r) => setTimeout(r, 500 + attempt * 900));
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Google TTS unavailable");
}

/** Hindi voice — kept as a named wrapper for the original Hindi path. */
export function synthesizeHindi(text: string): Promise<string> {
  return synthesizeGoogleTts(text, "hi");
}
