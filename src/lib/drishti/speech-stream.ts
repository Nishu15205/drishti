// Shared streaming speech pipeline (server-side).
//
// Flow: VLM SSE stream → sentences detected on the fly → sequential TTS
// (the TTS API allows only ONE concurrent call) → NDJSON lines flushed to
// the client in playback order as each chunk synthesizes:
//   {"audio":"<base64 wav>"}   zero or more, ordered
//   {"question":"..."}         optional preamble (ask flow)
//   {"text":"...","done":true} full text, sent as soon as VLM completes
//   {"error":"..."}            terminal failure
//
// The client starts playing audio long before the whole readout exists,
// which cuts perceived latency dramatically.

import type { Lang } from "./constants";
import { toSpeakable } from "./transliterate";
import {
  HINDI_TTS_MIME,
  splitHindiChunks,
  synthesizeHindi,
} from "./hindi-tts";
import { synthesizeCloudWithFallback } from "./cloud-tts";

/** One synthesis result — Hindi API yields MP3 (+ client playbackRate),
 *  cloud voice yields WAV with speed baked in. */
interface TtsResult {
  b64: string;
  mime?: string;
  rate?: boolean;
}

const TTS_CHUNK_LIMIT = 220; // merge short neighbouring sentences up to this
const MAX_SPOKEN_SENTENCES = 10; // cap so OCR sprees can't run forever
const WORKER_POLL_MS = 30;
const FIRST_CUT_LEN = 90; // force-break the first chunk near this length

/**
 * Break a still-unfinished first chunk at the last word boundary so TTS can
 * start before the model finishes its sentence. Only used for the very
 * first chunk, and only when a reasonable break point exists.
 */
function forceFirstCut(text: string): string | null {
  const window = text.slice(0, FIRST_CUT_LEN + 20);
  let cutAt = -1;
  for (let i = window.length - 1; i >= 40; i--) {
    if (window[i] === " ") {
      cutAt = i;
      break;
    }
  }
  if (cutAt < 40) return null;
  return text.slice(0, cutAt).trim();
}

export interface SpeechStreamOptions {
  speed: number;
  /**
   * Reply language. Hindi answers arrive in Devanagari — which the TTS
   * voices cannot read (they garble it into Chinese) — so every chunk is
   * romanized just before synthesis.
   */
  lang?: Lang;
  /**
   * Device-voice mode: the client has a real Hindi voice, so we skip the
   * cloud TTS entirely and stream {"say"} lines (raw Devanagari) — the
   * device speaks each sentence the moment the VLM finishes it, which
   * also removes the whole TTS hop from the latency chain.
   */
  sayOnly?: boolean;
  /** Lines emitted before audio starts (e.g. the recognized question). */
  preamble?: unknown[];
  /** Called once with the full VLM text (for history persistence). */
  onText?: (text: string) => void;
  /** Latency instrumentation — label is relative to stream creation. */
  onTiming?: (label: string, elapsedMs: number) => void;
}

/** Pop fully-terminated sentences off the front of the text buffer. */
function takeComplete(text: string): { complete: string[]; rest: string } {
  const complete: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch !== "." && ch !== "!" && ch !== "?" && ch !== "।") continue;
    // decimal numbers like 2.5 — don't split
    const next = text[i + 1];
    if (ch === "." && next && /\d/.test(next)) continue;
    let j = i + 1;
    while (j < text.length && /\s/.test(text[j])) j++;
    complete.push(text.slice(start, j));
    start = j;
    i = j - 1;
  }
  return { complete, rest: text.slice(start) };
}

/**
 * Merge short neighbouring sentences so we don't spend a whole TTS call on a
 * 3-word fragment, while keeping chunks small enough to synthesize fast.
 */
function groupSentences(sentences: string[], limit = TTS_CHUNK_LIMIT): string[] {
  const groups: string[] = [];
  for (const sentence of sentences) {
    const s = sentence.trim();
    if (!s) continue;
    const last = groups[groups.length - 1];
    if (last && (last + " " + s).length <= limit) {
      groups[groups.length - 1] = `${last} ${s}`;
    } else {
      groups.push(s);
    }
  }
  return groups;
}

export async function streamSpeechFromVision(
  visionBodyPromise: Promise<unknown>, // ReadableStream SSE (stream: true)
  opts: SpeechStreamOptions
): Promise<ReadableStream<Uint8Array>> {
  const encoder = new TextEncoder();
  const speed = opts.speed;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const startedAt = Date.now();
      let closed = false;
      const send = (obj: unknown) => {
        if (closed) return false;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
          return true;
        } catch {
          closed = true; // client went away — stop producing
          return false;
        }
      };

      const fail = (err: unknown) => {
        console.error("[speech-stream] error:", err);
        send({
          error:
            err instanceof Error
              ? err.message
              : "Speech failed. Please try again.",
        });
      };

      try {
        for (const item of opts.preamble ?? []) send(item);

        // ---- TTS worker: sequential (cloud API rejects parallel calls), FIFO ----
        // (skipped entirely in sayOnly/device-voice mode)
        // Hindi uses Google's NATIVE Hindi voice (pure Indian accent, reads
        // Devanagari directly). English uses Google's en-IN voice — proper
        // INDIAN English (user request) — on every chunk, with a per-piece
        // fallback to the neutral "en" voice, so the accent can never drift
        // (the cloud voice is banned from the English path entirely).
        let hindiApiBroken = false;

        const synthJob = async (raw: string): Promise<TtsResult[]> => {
          // English speaks a notch slower (user request): the client plays
          // Google EN chunks at rate ≈ speed×0.8 (pitch-corrected). ttsSpeed
          // here only affects the rare cloud-voice last-resort path, where the
          // pace is baked into synthesis instead. Hindi keeps its own pace.
          const ttsSpeed = opts.lang === "en" ? speed * 0.8 : speed;
          if (opts.lang === "hi") {
            if (!hindiApiBroken) {
              try {
                return [
                  {
                    b64: await synthesizeHindi(raw),
                    mime: HINDI_TTS_MIME,
                    rate: true, // client applies playbackRate (speed)
                  },
                ];
              } catch (err) {
                hindiApiBroken = true;
                console.warn(
                  "[speech-stream] Hindi TTS API failed → cloud voice fallback:",
                  err instanceof Error ? err.message : err
                );
              }
            }
            return synthesizeCloudWithFallback(
              toSpeakable(raw, "hi"),
              ttsSpeed,
              "hi"
            );
          }
          return synthesizeCloudWithFallback(
            toSpeakable(raw, opts.lang ?? "en"),
            ttsSpeed,
            opts.lang ?? "en"
          );
        };

        interface Job {
          text: string;
          resolve: (result: TtsResult) => void;
          reject: (e: unknown) => void;
        }
        const queue: Job[] = [];
        let producing = !opts.sayOnly; // more sentences may still arrive
        let workerFailed: unknown = null;

        const worker = (async () => {
          while (true) {
            if (closed) return; // client gone — stop synthesizing
            const job = queue.shift();
            if (!job) {
              if (!producing) return;
              await new Promise((r) => setTimeout(r, WORKER_POLL_MS));
              continue;
            }
            try {
              const pieces = await synthJob(job.text);
              if (pieces.length) job.resolve(pieces[0]);
              // Ship the audio line THE MOMENT this chunk is synthesized —
              // the worker is strictly FIFO, so playback order is preserved
              // while the model is still describing. (Flushing only after
              // the SSE ends used to hold the first word for seconds.)
              if (!opts.sayOnly && !closed) {
                for (const piece of pieces) {
                  if (closed) break;
                  send({ audio: piece.b64, mime: piece.mime, rate: piece.rate });
                  if (spokenAudioChunks === 0)
                    opts.onTiming?.("first_audio_sent", Date.now() - startedAt);
                  spokenAudioChunks++;
                }
              }
            } catch (err) {
              workerFailed = workerFailed ?? err;
              while (queue.length) queue.shift()?.reject(err); // drain
              return;
            }
          }
        })();

        const enqueueTts = (text: string): Promise<TtsResult> => {
          let resolve!: (r: TtsResult) => void;
          let reject!: (e: unknown) => void;
          const promise = new Promise<TtsResult>((res, rej) => {
            resolve = res;
            reject = rej;
          });
          // The worker's own audio-send path is what matters; promise
          // rejections are surfaced through workerFailed at stream end.
          promise.catch(() => {});
          queue.push({ text, resolve, reject });
          return promise;
        };

        // ---- read VLM SSE, enqueue sentences as they complete ----
        let spoken = 0;
        let spokenAudioChunks = 0;
        let buffer = "";
        let fullText = "";
        let sseError: unknown = null;

        const speakMore = (sentences: string[]) => {
          // The very first sentence is spoken ALONE — merging it with the
          // next one would delay the first word until more text streams in.
          // Later groups merge up to the cap (fewer, fuller chunks).
          const limit =
            spoken === 0 ? 0 : opts.lang === "hi" ? 170 : TTS_CHUNK_LIMIT;
          for (const g of groupSentences(sentences, limit)) {
            if (spoken >= MAX_SPOKEN_SENTENCES) return;
            spoken++;
            if (opts.sayOnly) {
              send({ say: g }); // raw Devanagari — the device voice reads it natively
            } else if (opts.lang === "hi") {
              // keep every synthesis call under the endpoint cap
              for (const piece of splitHindiChunks(g)) void enqueueTts(piece);
            } else {
              void enqueueTts(g);
            }
          }
        };

        const body = (await visionBodyPromise) as ReadableStream<Uint8Array>;
        opts.onTiming?.("vision_connected", Date.now() - startedAt);
        const reader = body.getReader();
        const decoder = new TextDecoder();
        let sseBuf = "";
        let firstDelta = true;

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            sseBuf += decoder.decode(value, { stream: true });

            let nl: number;
            while ((nl = sseBuf.indexOf("\n")) >= 0) {
              const line = sseBuf.slice(0, nl).trim();
              sseBuf = sseBuf.slice(nl + 1);
              if (!line.startsWith("data:")) continue;
              const payload = line.slice(5).trim();
              if (!payload || payload === "[DONE]") continue;
              try {
                const json = JSON.parse(payload) as {
                  choices?: { delta?: { content?: string } }[];
                };
                const delta = json.choices?.[0]?.delta?.content ?? "";
                if (!delta) continue;
                if (firstDelta) {
                  firstDelta = false;
                  opts.onTiming?.("vision_first_token", Date.now() - startedAt);
                }
                fullText += delta;
                buffer += delta;
                const { complete, rest } = takeComplete(buffer);
                buffer = rest;
                speakMore(complete);
                // First-chunk accelerator: if no sentence has terminated yet
                // but a usable break exists near ~90 chars, cut the fragment
                // NOW and start TTS — shaves ~0.5-1s off the very first word.
                if (
                  spoken === 0 &&
                  complete.length === 0 &&
                  buffer.length >= FIRST_CUT_LEN
                ) {
                  const cut = forceFirstCut(buffer);
                  if (cut) {
                    buffer = buffer.slice(cut.length).trimStart();
                    speakMore([cut]);
                  }
                }
              } catch {
                /* partial JSON — keep buffering */
              }
            }
          }
        } catch (err) {
          sseError = err;
        }

        producing = false;
        if (sseError && !fullText) throw sseError;

        const tail = buffer.trim();
        if (tail && spoken < MAX_SPOKEN_SENTENCES) {
          if (opts.sayOnly) {
            send({ say: tail });
          } else if (opts.lang === "hi") {
            for (const piece of splitHindiChunks(tail)) void enqueueTts(piece);
          } else {
            void enqueueTts(tail);
          }
        }

        const text = fullText.trim();
        if (!text) throw new Error("Empty response from vision model");
        opts.onTiming?.("vision_done", Date.now() - startedAt);

        // Send the full text NOW so the UI card appears while speech runs
        send({ text, done: false });
        try {
          opts.onText?.(text);
        } catch {
          /* persistence callback must not break playback */
        }

        // Wait until the worker has synthesized + streamed every chunk
        // (device-voice mode has no audio queue — say lines went out live)
        await worker;
        if (workerFailed) throw workerFailed;
        opts.onTiming?.("all_audio_sent", Date.now() - startedAt);
        if (!closed) send({ text, done: true });
      } catch (err) {
        fail(err);
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });
}

export function ndjsonHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-cache",
    "X-Accel-Buffering": "no",
  };
}
