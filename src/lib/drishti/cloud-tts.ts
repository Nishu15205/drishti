// Cloud TTS with a bulletproof fallback chain.
//
// USER-REPORTED BUGS THIS FILE FIXES:
//   1. "English bolte waqt accent change ho jata hai — pehle English, phir
//      Chinese." Cause: English chunks used to go to the default cloud voice
//      (which reads English with a Chinese accent) first, and every failure
//      dropped chunks to the Google voice mid-answer. Mixed chunks = audible
//      accent switch.
//   2. "English ki accent bhi Chinese ho gayi — uski INDIAN English me banao."
//      Fix: English now ALWAYS speaks with Google's en-IN voice — proper
//      Indian English — and the cloud voice is BANNED from the English path
//      entirely. A Chinese accent must never come out of this app again.
//
// NEW ORDER (accent-consistent + fast):
//   English → Google en-IN (Indian English, ~0.5-1s per chunk, two hosts +
//             retries) → per-piece fallback to Google "en" (neutral English,
//             still natural — never Chinese) → total failure THROWS so the
//             client rescues with the device voice instead of switching
//             accents mid-answer.
//   Hindi   → Google native Hindi voice (handled by the callers via
//             synthesizeHindi) → the cloud voice reading romanized Hindi as
//             fallback → Google romanized as the final net.
//
// Google caps each request at ~200 chars, so text is split into ≤180-char
// pieces and returned as MULTIPLE ordered audio pieces — callers must send
// every piece as its own audio line in order.

import {
  HINDI_TTS_MIME,
  splitHindiChunks,
  synthesizeGoogleTts,
} from "./hindi-tts";
import { withTimeout, withAI, TTS_TIMEOUT_MS, CLOUD_TTS_VOICE } from "./ai-client";

export interface CloudTtsPiece {
  b64: string;
  mime?: string;
  rate?: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function cloudVoiceOnce(input: string, speed: number): Promise<string> {
  const response = await withTimeout(
    withAI((ai) =>
      ai.audio.tts.create({
        input,
        voice: CLOUD_TTS_VOICE,
        speed,
        response_format: "wav", // mp3 rejected by API (code 1214)
        stream: false,
      })
    ),
    TTS_TIMEOUT_MS,
    "Speech synthesis"
  );
  const ab = await response.arrayBuffer();
  return Buffer.from(new Uint8Array(ab)).toString("base64");
}

/**
 * One English piece: Indian English (en-IN) first, then the neutral "en"
 * voice as a per-piece fallback. Both are Google translate_tts voices —
 * neither ever sounds Chinese. A piece that fails BOTH throws so the
 * caller can fail the whole chain and let the client rescue with a
 * device voice instead of mixing a Chinese accent into the answer.
 * The en-IN → en fallback is LOUD (console.warn) — accent drift must be
 * visible in server logs, not silent.
 */
async function googleEnPiece(piece: string): Promise<string> {
  try {
    return await synthesizeGoogleTts(piece, "en-IN"); // Indian English
  } catch (inErr) {
    console.warn(
      "[cloud-tts] en-IN piece failed → neutral en fallback:",
      inErr instanceof Error ? inErr.message.slice(0, 80) : inErr
    );
    try {
      return await synthesizeGoogleTts(piece, "en"); // neutral English
    } catch (enErr) {
      console.warn(
        "[cloud-tts] en piece failed too — failing the whole chain:",
        enErr instanceof Error ? enErr.message.slice(0, 80) : enErr
      );
      throw inErr;
    }
  }
}

/** Google-voice pieces for `text` — sequential so ordering stays deterministic. */
async function googlePieces(
  text: string,
  lang: "hi" | "en"
): Promise<CloudTtsPiece[]> {
  const pieces = splitHindiChunks(text, 180);
  const out: CloudTtsPiece[] = [];
  for (const piece of pieces) {
    out.push({
      b64: lang === "en" ? await googleEnPiece(piece) : await synthesizeGoogleTts(piece, "hi"),
      mime: HINDI_TTS_MIME,
      rate: true, // client applies the user's pace (pitch-corrected)
    });
  }
  if (!out.length) throw new Error("No text to speak");
  return out;
}

/**
 * Synthesize `text` for the requested language.
 *
 * English: Google en-IN (INDIAN English — user request) with a per-piece
 * fallback to the neutral "en" voice. The cloud voice is NEVER used for English —
 * a Chinese accent is worse than triggering the client's device-voice
 * rescue. Hindi (fallback path — callers try the native Hindi voice first):
 * the cloud voice reading romanized Hindi, then Google romanized pieces.
 *
 * Returns ONE OR MORE audio pieces — always play them in order.
 */
export async function synthesizeCloudWithFallback(
  text: string,
  speed: number,
  lang: "hi" | "en"
): Promise<CloudTtsPiece[]> {
  const clean = text.trim();
  if (!clean) throw new Error("No text to speak");

  if (lang === "en") {
    // No cloud voice here — deliberately. If Google dies entirely we throw and
    // the client speaks the text with the device voice (Indian phones ship
    // an English-India TTS voice), keeping the accent consistent.
    return googlePieces(clean, "en");
  }

  // ---- Hindi fallback path (native Hindi voice already failed upstream) ----
  try {
    return [{ b64: await cloudVoiceOnce(clean, speed) }];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isTimeout = msg.includes("timed out");
    const isRateLimit = msg.includes("429") || /too many/i.test(msg);

    // One retry for transient failures. A hang is skipped — the endpoint is
    // already wedged for this request, don't burn another 10s waiting.
    if (!isTimeout) {
      if (isRateLimit) await sleep(1500);
      try {
        return [{ b64: await cloudVoiceOnce(clean, speed) }];
      } catch {
        /* fall through to Google voice */
      }
    }

    console.warn(
      `[cloud-tts] cloud voice failed (${isTimeout ? "hang" : msg.slice(0, 80)}) → Google voice fallback`
    );
    return googlePieces(clean, "hi");
  }
}
