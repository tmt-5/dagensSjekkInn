# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the app

```bash
ANTHROPIC_API_KEY=<your-key> node server.js
```

Opens at `http://localhost:3000`. No build step — it's plain Node.js with no dependencies.

Opening `index.html` directly in a browser (via `file://`) also works: it skips the server and cycles through hardcoded sample questions instead.

## Architecture

This is a tiny two-runtime app:

**Local dev (`server.js`)** — a bare `http.createServer` that serves `index.html` and proxies `POST /generate` directly to the Anthropic API. No framework, no packages.

**Vercel production (`api/generate.js` + `vercel.json`)** — the same `/generate` endpoint lives as a Vercel serverless function. `vercel.json` rewrites `/generate` → `/api/generate` so the frontend fetch call works identically in both environments.

The two backends have **separate system prompts**: `api/generate.js` uses a simpler prompt (no category rotation, no ban list); `server.js` has the more detailed rotating-category prompt with an explicit ban list. Keep them in sync if you change question generation behaviour.

**Frontend (`index.html`)** — single self-contained file with three IIFE sections:
1. **Canvas scene** — pixel-art standup scene rendered with `requestAnimationFrame`; characters bob, blink, and face the whiteboard.
2. **Question generation** — `fetch('/generate')`, typewriter reveal, `file:` protocol fallback.
3. **Confetti** — spawns on question reveal; uses a separate overlay `<canvas>`.

## Environment

`ANTHROPIC_API_KEY` must be set as an environment variable (locally in the shell, on Vercel via project settings). The model used is `claude-sonnet-5` with `max_tokens: 150`.
