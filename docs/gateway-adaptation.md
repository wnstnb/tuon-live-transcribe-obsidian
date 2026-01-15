# Tuon live transcribe — Gateway adaptation notes (Option B)

## Goal (what we mean by “local gateway”)

We want the Obsidian plugin to **initiate and own the gateway** on the user’s machine (not a hosted service).

- The gateway can still call **AssemblyAI** (cloud) for transcription.
- The plugin will:
  - start the gateway (Option B: implemented in TypeScript, running inside Obsidian/Electron),
  - open/connect to the gateway WebSocket,
  - capture microphone audio,
  - stream audio frames to the gateway,
  - receive transcript events,
  - insert partial/final text into an Obsidian note (and later: summarize).

This is analogous to today’s `tuon-live-transcribe-v2` pairing:
- `test_client.py` (mic + WS client) ⟶ becomes the **Obsidian plugin**
- `main.py` (WS gateway + AssemblyAI streaming) ⟶ becomes the **in-plugin gateway** (Option B)

## Inventory: what `tuon-live-transcribe-v2` does today

### Roles and components

`tuon-live-transcribe-v2/main.py` is a local WebSocket server that:
- accepts **binary WS messages** containing raw audio bytes
- forwards those bytes into an AssemblyAI streaming session using `assemblyai.streaming.v3`
- relays transcript events back to the WS client as JSON messages

`tuon-live-transcribe-v2/test_client.py` is a local test client that:
- captures mic audio with PyAudio
- sends 50ms chunks to the gateway as **raw bytes**
- prints transcript events received from the gateway

### Audio format assumptions

The gateway expects audio that matches the AssemblyAI streaming parameters configured in `main.py`:
- sample rate: **16000 Hz**
- encoding: **pcm_s16le** (16-bit signed little endian PCM)
- channels: **mono**

The test client is configured accordingly:
- PyAudio format: 16-bit PCM (`paInt16`)
- channels: 1
- rate: 16000
- frames per buffer: `RATE * 50ms` (50ms chunks)

### Message protocol (what the gateway returns)

The gateway sends JSON messages of the following shapes to clients:

- Session start:
  - `{ "type": "session_begin", "session_id": "<id>" }`

- Transcript updates:
  - `{ "type": "transcript_update", "text": "<string>", "is_final": false }` for interim/partial updates
  - `{ "type": "transcript_update", "text": "<string>", "is_final": true }` for **formatted final** utterance text
  - Note: In `main.py`, when `format_turns=True`, it may receive “unformatted final” turns and intentionally not forward them as `is_final: true` while waiting for the formatted version.

- Session terminated:
  - `{ "type": "session_terminated", "audio_duration_seconds": <number> }`

- Error:
  - `{ "type": "error", "message": "<string>" }`

### Current operational setup

- Default WS port: `PORT` env var (default 8000).
- There is also a separate HTTP health server on `HEALTH_PORT` (default 8001).
- Environment variables in `env.example`:
  - `ASSEMBLYAI_API_KEY`
  - `WEBSOCKET_SECRET_TOKEN` (intended for auth)
  - `ALLOWED_ORIGINS` (intended for WS origin restriction)
  - `PORT`

### Security note (important when porting)

`main.py` defines `process_http_request(...)` to enforce:
- token auth via `X-Auth-Token` header or `auth_token` query param
- origin restriction via `origins=allowed_origins_list`

However, `process_http_request(...)` is **not currently wired into** `websockets.serve(...)` in `main.py`, so the token check is not actually in effect.

If we keep a WS server in-plugin, we should decide whether it’s even necessary to bind a public port (see “Option B architecture” below).

## Decision: Option B (implement gateway inside the plugin)

User preference:
- **Option B** (preferred): reimplement the gateway in TypeScript inside the Obsidian plugin.
- Gateway continues to call AssemblyAI.

Implications:
- We do **not** depend on a local Python runtime or bundled binary.
- The plugin bundles a TS implementation (via the existing esbuild pipeline) that:
  - hosts a local WS endpoint (or an in-memory “loopback” alternative),
  - manages a single active transcription session,
  - translates audio frames into whatever AssemblyAI’s JS-compatible streaming API expects,
  - emits the same event protocol currently used by `test_client.py`.

## Proposed Option B architecture (high-level)

### Key idea

Keep the “gateway” boundary because it cleanly separates:
- mic capture and UX concerns (plugin UI)
- streaming/transcription concerns (gateway module)

…but since both live in the same plugin runtime, we can choose either:
- **B1: true WS boundary (localhost port)**: plugin starts a WS server and also connects to it as a client.
- **B2: in-process boundary (recommended)**: no real sockets; a gateway module exposes an event emitter / async iterator API. This avoids port collisions, firewall prompts, and cross-origin issues.

Decision: **prefer B2** for Obsidian.
- Rationale: Obsidian plugins run inside an Electron app with a constrained lifecycle. Avoiding a real listening port reduces user friction (firewall prompts), avoids port collisions, and makes unload/reload cleanup simpler and more reliable.
- We can still keep a “WS-shaped” internal interface (binary audio frames in, JSON events out) so the architecture remains familiar.

### Modules to add in the Obsidian plugin repo (suggested)

- `src/gateway/`
  - `gateway.ts`: gateway lifecycle + event protocol
  - `assemblyai.ts`: AssemblyAI streaming client wrapper
  - `protocol.ts`: shared message types (`session_begin`, `transcript_update`, etc.)

- `src/audio/`
  - `mic.ts`: capture mic audio via `navigator.mediaDevices.getUserMedia`
  - `pcm.ts`: resampling + PCM16 conversion + chunking (50ms)

- `src/commands/`
  - `start-transcription.ts`
  - `stop-transcription.ts`
  - `insert-final-transcript.ts` (optional)
  - later: `summarize-transcript.ts`

- `src/ui/`
  - minimal modal/panel for status + controls (push-to-talk, live view, insert behavior)

- `src/settings.ts`
  - AssemblyAI API key
  - optional: language/model/formatting options
  - optional: “insert partials” vs “only final”

### Obsidian UX flow (initial)

- User runs **Start live transcription** command.
- Plugin prompts for mic permission (desktop).
- Plugin starts gateway session (Option B).
- Plugin streams audio frames continuously.
- On `transcript_update`:
  - if partial: update a “live caption” UI element (and optionally insert inline)
  - if final: append to active note (or buffer and insert on stop)
- User runs **Stop live transcription**.
- Plugin closes mic stream and ends the gateway session.

## AssemblyAI integration considerations for TS

`tuon-live-transcribe-v2` uses the Python SDK `assemblyai.streaming.v3`.

For Option B we need an equivalent in JS/TS:
- Find (or implement) a JS-compatible AssemblyAI streaming client.
- If there is no first-party streaming SDK that works in this runtime, we can:
  - connect to AssemblyAI streaming endpoint via WebSocket directly,
  - implement the expected framing/messages on the wire (requires docs alignment).

**Action item for implementation phase**: confirm the AssemblyAI JS streaming approach and API surface we’ll target, then lock message protocol mapping (`TurnEvent` → `transcript_update`).

## Summarization (not implemented yet)

Requirement mentioned:
- “have the option within the plugin to summarize what they have”

Clarification:
- Summarization will use an **OpenRouter** model.

Plugin settings expectation (when complete):
- **AssemblyAI API key**: for live transcription (gateway → AssemblyAI streaming).
- **OpenRouter API key (+ model)**: for summary/prettify of captured transcript text.

Open question:
- should summarization be:
  - cloud (LLM provider) with explicit opt-in?
  - local-only (extractive summary or local model)?

For now, transcription is the critical path; summarization can be layered on once transcript capture + insertion is stable.

## Open questions / decisions to make next

- Do we truly need a local WS server (B1), or can we do in-process (B2)?
- Desktop-only is likely acceptable for mic + Node/Electron features; do we plan for mobile?
- Transcript insertion policy:
  - insert partials live (and replace), or only append finals?
  - where to insert: active cursor vs end of note vs dedicated “Transcript” section?
- Storage:
  - do we persist session transcripts in plugin data for later summarization/replay?

## Suggested milestones

1) **Skeleton**: add commands + settings + minimal UI, no audio yet.
2) **Mic capture**: capture audio, downsample to 16kHz, chunk to 50ms, validate PCM16 output.
3) **Gateway module (TS)**: establish AssemblyAI streaming, emit `transcript_update` events.
4) **Editor integration**: append final transcripts to active note reliably.
5) **Polish**: status bar indicator, error handling, session resume/stop safety.
6) **Summarize**: choose approach (cloud opt-in vs local) and implement.

## Obsidian plugin build + runtime notes (from Obsidian docs)

Reference: Obsidian developer docs, “Build a plugin”: `https://docs.obsidian.md/Plugins/Getting+started/Build+a+plugin`

### Required plugin artifacts

Obsidian loads plugins from a folder inside a vault:
- `<Vault>/.obsidian/plugins/<plugin-id>/`

The **minimum** files that must exist in that folder for a plugin build are:
- `manifest.json`
- `main.js`
- optional `styles.css`

### Development loop (local)

Typical workflow:
- keep a dedicated “dev vault” for plugin development/testing
- place this repository (or a built copy) under:
  - `<Vault>/.obsidian/plugins/<plugin-id>/`
- run the build in watch mode:
  - `npm install`
  - `npm run dev`
- reload Obsidian to pick up changes (commonly via command palette, e.g. “Reload app…”)

### Source/build structure in *this* repo

This repo already matches the standard pattern:
- `src/main.ts` is the plugin entrypoint
- esbuild bundles to `main.js` at repo root (see `esbuild.config.mjs`)
- `manifest.json` currently still has sample values and will need updating (`id`, `name`, `description`, etc.)

### Practical implications for our gateway work (Option B)

- Anything we implement (gateway, audio capture, UI) must be bundled into `main.js`.
- We should keep `src/main.ts` thin and put the gateway/audio logic in separate modules under `src/` so it stays maintainable.
- If we choose to run a true localhost WS server (Option B1), we need to be deliberate about:
  - port selection / collisions
  - cleanup on plugin unload
  - desktop vs mobile behavior

## Tuon (ai-sdk-chat-mml) — how voice transcription output becomes a summary

This repo is useful as a reference implementation for two things we need in Obsidian:
1) **How to consume Live Transcribe v2’s transcript events**
2) **How to run “summary / prettify” as a separate AI step**

### Live transcript consumption pattern (client-side)

Tuon’s `VoiceSummaryModal`:
- connects to a WS URL (fetched from an API route)
- streams **16kHz PCM16** frames (via an AudioWorklet) over WebSocket
- receives JSON transcript events and accumulates them into:
  - **finalized transcript** (for `is_final: true`)
  - **current utterance** (for partials)
- renders a live view of “finalized + current utterance”

This is directly transferable conceptually to Obsidian: our plugin will maintain the same two buffers and only “commit” final text to the note (or optionally show partials in a UI panel).

### Summarization service pattern

Tuon’s Voice Summary UX separates concerns:
- **Transcription** is realtime and comes from the WS gateway (`transcript_update` events).
- **Summarization / cleanup** is a *second step* that takes the captured transcript text and calls an AI model with:
  - action = `summary` (generate a structured summary)
  - action = `prettify` (clean up transcript without summarizing)

In Tuon, that second step is implemented server-side as `/api/voice-summary/generate-notes` with two prompt templates (summary vs prettify).

### Obsidian plugin plan (cherry-picked subset)

For Obsidian we’ll keep the same separation:
- The gateway yields raw transcript text.
- A “notes” step calls **OpenRouter** with a chosen model to produce:
  - **Summary**
  - **Prettified transcript**

As a first integration point (before the full live transcription pipeline is wired in), we implemented editor commands:
- **Tuon: Summarize selection (OpenRouter)**
- **Tuon: Prettify selection (OpenRouter)**

These commands reuse the same “summary vs prettify” prompting concept, but run directly in the plugin (no separate web app server).

## Live transcription (implemented baseline)

We now have a baseline end-to-end live transcription path implemented directly in the Obsidian plugin (no hosted gateway):

- **Mic capture**: `navigator.mediaDevices.getUserMedia` + an `AudioWorklet` that emits **PCM16LE** frames at **16kHz mono**.
- **AssemblyAI realtime**: the plugin opens a WebSocket to AssemblyAI realtime and streams audio frames as base64 JSON envelopes.
- **Obsidian insertion**: on each **final** transcript message, the plugin inserts text at the current cursor in the active editor.
- **Status**: partial/final rolling text is shown in the status bar.

### Commands

- **Tuon: Start live transcription**
- **Tuon: Stop live transcription**
- **Tuon: Toggle live transcription**

### Current limitations / TODO

- We’re using a **browser-compatible** AssemblyAI WS auth method (token in query string) and **base64 audio_data** envelopes. If your AssemblyAI account/API requires header-based auth or a different endpoint, we may need to adjust.
- Insert policy is minimal (append at cursor with spaces). We’ll likely want a better UX:
  - insert only at end of note or a named heading
  - optional “live caption” UI panel (don’t spam the editor with partials)
  - punctuation/formatting options per turn
