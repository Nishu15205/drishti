# Drishti — AI Eye for the Blind

Drishti turns any Android phone into a **talking eye** for a blind user.
Point the camera, ask anything in Hindi or Indian English, and hear the
answer in about **3 seconds** — with automatic danger alerts while walking.

Built by **Team AlgoAura** — Nishu Raj · Vishesh Pratap Singh
CSE, MERI College of Engineering and Technology, Rohtak (Haryana)

## Why

India has ~5 million blind people (NPCBVI 2019). Smart canes only vibrate
near obstacles, camera wearables cost ₹2.5–3 lakh, and volunteer apps need
someone online at that exact moment. But the one device almost every family
already owns — an Android phone — stays unused. Drishti fills that gap:
no new hardware, no volunteer dependency, no English-only barrier.

## Features

- **Six daily modes** — Surroundings, Currency, Medicine, Read Text,
  Known Faces, Find Things
- **Nazar (danger watch)** — a silent 5-second watch cycle that speaks up
  only when it sees danger ("Motorcycle directly ahead, slow down")
- **SOS** — a 1.2-second long-press fires the emergency flow
- **Voice-first, made for India** — Hindi + Indian English (en-IN),
  clock-position and step-distance spatial language
- **~3 s to first word** — the reply streams sentence-by-sentence into TTS
  while the rest is still generating
- **Never silent** — multi-tier TTS fallback: cloud neural voice → Google
  voices → on-device voice, so the app never leaves a blind user in silence
- **PWA** — installs from the browser (no Play Store), offline app shell,
  runs on 2 GB RAM phones

## How it works

```
camera frame (640px JPEG)
   │
   ▼
/api/analyze ──► AI gateway (vision model, streamed)
   │                  │
   │            sentence splitter
   │                  ▼
   └──────────► TTS chain ──► NDJSON audio lines ──► earphones
```

| Endpoint | What it does |
|---|---|
| `POST /api/analyze` | describe / currency / medicine / text modes (streamed audio) |
| `POST /api/ask` | voice question: ASR → LLM with scene context → speech |
| `POST /api/watch` | one frame in → danger verdict out (Nazar) |
| `POST /api/speak` | plain text → speech chunks (fallback chain) |
| `POST /api/recognize` | known faces |
| `POST /api/find-item` | "where are my keys?" |
| `GET /api/history` · `/api/memories` | scan history + insight cards |

## Running locally

```bash
bun install              # or npm install
cp .env.example .env     # fill in your AI gateway details
bun run db:push          # create the SQLite database
bun run dev              # http://localhost:3000
```

AI calls go through an OpenAI-compatible gateway (vision + TTS + ASR
endpoints) — point `AI_GATEWAY_BASE_URL` at any compatible service and set
`AI_GATEWAY_API_KEY`. See `.env.example` for all variables.

## Tech stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4 ·
shadcn/ui · Prisma + SQLite · PWA (service worker) · Framer Motion

## License

MIT — see [LICENSE](LICENSE).
