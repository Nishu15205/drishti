// Next.js instrumentation hook — runs once when the server boots.
// Pre-warms the AI gateway (and the TTS service path) so the very first
// user request doesn't pay the cold-start cost (blind users feel every second).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { getAI, withAI, CLOUD_TTS_VOICE } = await import(
      "@/lib/drishti/ai-client"
    );
    await getAI();
    console.log("[drishti] AI client pre-warmed at server start");
    // Tiny dummy TTS call to open the synthesis path — best effort, ignore failures
    await withAI((ai) =>
      ai.audio.tts.create({
        input: "Namaste", // roman text — Devanagari is never sent to TTS
        voice: CLOUD_TTS_VOICE,
        speed: 1.0,
        response_format: "wav",
        stream: false,
      })
    )
      .then(() => console.log("[drishti] TTS service warmed up"))
      .catch(() => {
        /* warm-up is best effort */
      });

    // Warm the LLM/VLM gateway path too (DNS + TLS + auth handshake) so the
    // FIRST scan of a session doesn't pay the connection setup — the first
    // impression matters for an app a blind user depends on.
    await withAI((ai) =>
      ai.chat.completions.create({
        messages: [{ role: "user", content: "Reply with just: OK" }],
        stream: false,
      })
    )
      .then(() => console.log("[drishti] VLM/LLM gateway warmed up"))
      .catch(() => {
        /* warm-up is best effort */
      });

    // Warm Google's native Hindi TTS (DNS + TLS + first synthesis) — the
    // pure-Hindi voice used for every Hindi answer
    void import("@/lib/drishti/hindi-tts")
      .then((m) => m.synthesizeHindi("नमस्ते"))
      .then(() => console.log("[drishti] Hindi TTS API warmed up"))
      .catch(() => {
        /* warm-up is best effort */
      });

    // Dev-mode helper: pre-compile API routes so the first real request
    // doesn't pay the on-demand compilation penalty (several seconds).
    if (process.env.NODE_ENV === "development") {
      const warmRoute = async (path: string, init?: RequestInit) => {
        for (let attempt = 0; attempt < 10; attempt++) {
          await new Promise((r) => setTimeout(r, 1500));
          try {
            await fetch(`http://127.0.0.1:3000${path}`, init);
            console.log(`[drishti] route pre-compiled: ${path}`);
            return;
          } catch {
            /* server not listening yet — retry */
          }
        }
      };
      void warmRoute("/api/history");
      void warmRoute("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      void warmRoute("/api/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      void warmRoute("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
    }
  } catch (err) {
    console.warn(
      "[drishti] AI pre-warm failed (will retry on first request):",
      err instanceof Error ? err.message : err
    );
  }
}
