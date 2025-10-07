// Thin client for our AI gateway (OpenAI-compatible HTTP endpoints).
//
// All AI traffic — vision, chat, TTS and speech recognition — goes through
// one gateway configured via env vars, so app code never depends on a
// vendor SDK directly. The client is built once per process and reused;
// if a call fails with an auth-flavoured error (rotated key, expired
// session) withAI() rebuilds it and retries once instead of surfacing
// the failure to a blind user.

const BASE_URL = (process.env.AI_GATEWAY_BASE_URL ?? "").replace(/\/+$/, "");
const API_KEY = process.env.AI_GATEWAY_API_KEY ?? "";

/** Vision model used for scene understanding (see .env.example). */
export const VISION_MODEL = process.env.AI_MODEL ?? "glm-4.6v";

/** Cloud TTS voice used as the Hindi last-resort fallback. */
export const CLOUD_TTS_VOICE = process.env.CLOUD_TTS_VOICE ?? "default";

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content:
    | string
    | Array<
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
      >;
};

interface ChatBody {
  model?: string;
  messages: ChatMessage[];
  stream?: boolean;
  thinking?: { type: "disabled" | "enabled" };
  [key: string]: unknown;
}

function jsonHeaders(): HeadersInit {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${API_KEY}`,
  };
}

async function failWithStatus(res: Response, what: string): Promise<never> {
  const detail = await res.text().catch(() => "");
  throw new Error(`${what} failed with status ${res.status} ${detail.slice(0, 120)}`);
}

async function chat(body: ChatBody): Promise<unknown> {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ ...body, model: body.model || VISION_MODEL }),
  });
  if (!res.ok) return failWithStatus(res, "chat");
  // stream: true → hand back the raw SSE byte stream (read with getReader())
  if (body.stream) return res.body;
  return res.json();
}

async function tts(body: {
  input: string;
  voice?: string;
  speed?: number;
  response_format?: string;
  stream?: boolean;
}): Promise<Response> {
  const res = await fetch(`${BASE_URL}/audio/speech`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({
      ...body,
      voice: body.voice || CLOUD_TTS_VOICE,
      stream: false,
    }),
  });
  if (!res.ok) return failWithStatus(res, "tts");
  return res; // callers read .arrayBuffer()
}

async function asr(body: { file_base64: string }): Promise<{ text: string }> {
  const res = await fetch(`${BASE_URL}/audio/transcriptions`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) return failWithStatus(res, "asr");
  return res.json();
}

export interface AIClient {
  chat: {
    completions: {
      create: (body: ChatBody) => Promise<unknown>;
      createVision: (body: ChatBody) => Promise<unknown>;
    };
  };
  audio: {
    tts: { create: typeof tts };
    asr: { create: typeof asr };
  };
}

function makeClient(): AIClient {
  if (!BASE_URL || !API_KEY) {
    throw new Error(
      "AI gateway is not configured — set AI_GATEWAY_BASE_URL and AI_GATEWAY_API_KEY (see .env.example)"
    );
  }
  return {
    chat: {
      completions: {
        create: chat,
        createVision: chat, // same endpoint; the vision model reads image parts
      },
    },
    audio: { tts: { create: tts }, asr: { create: asr } },
  };
}

let cached: AIClient | null = null;

export function getAI(): AIClient {
  if (!cached) cached = makeClient();
  return cached;
}

function isAuthError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return (
    msg.includes("status 401") ||
    msg.includes("status 403") ||
    /unauthorized|forbidden/i.test(msg)
  );
}

/**
 * Run one gateway call (chat/vision/TTS/ASR). If the gateway rejects the
 * call because the cached client holds a rotated key, rebuild the client
 * and retry the call once before giving up.
 */
export async function withAI<T>(fn: (ai: AIClient) => Promise<T>): Promise<T> {
  try {
    return await fn(getAI());
  } catch (err) {
    if (!isAuthError(err)) throw err;
    console.warn("[drishti] AI gateway auth failure — rebuilding client");
    cached = null;
    return fn(getAI());
  }
}

/**
 * Reject if a promise stalls. The TTS/ASR endpoints occasionally hang
 * without answering under load — without this, a single stalled call can
 * freeze a whole speech stream and a blind user hears silence forever.
 */
export function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)),
        ms
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

// 10s (was 30s): a healthy TTS call for a 1-2 sentence chunk answers in
// 2-4s. If it hasn't answered in 10s it is effectively hung — callers now
// fall back to Google's voice instead of making a blind user wait in
// silence for half a minute.
export const TTS_TIMEOUT_MS = 10_000;
export const ASR_TIMEOUT_MS = 20_000;
