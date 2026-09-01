# GROUNDTRUTH

GROUNDTRUTH is a pixel-art WebMCP co-op game. You play Demi through the ship interface while an agent plays KORE through WebMCP.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:4173/`.

## Play with Codex

1. Open the game and start a new run.
2. Continue until the `KORE RELAY` connection panel appears.
3. Open Codex and send this prompt:

```text
Open http://localhost:4173/ and connect to GROUNDTRUTH as KORE. Use the page's WebMCP tools to call connect. You handle diagnostics and instructions; I will perform physical actions as Demi.
```

Send the prompt once. KORE must reconnect whenever you resume a saved run.

## Dev tools

Add `dev=1` to the URL to show the devtools. Remove it to hide them.

- Level 1: `http://localhost:4173/?dev=1&scene=level1-proof`
- Level 2: `http://localhost:4173/?dev=1&scene=level2-proof`
- Level 2 without devtools: `http://localhost:4173/?level=2`

## Build

```bash
npm run build
```
