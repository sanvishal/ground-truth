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
Open http://localhost:4173/ in the in-app browser and play GROUNDTRUTH with me. You are KORE and I am Demi. Connect immediately and let the game provide the story context. Use only the page's WebMCP tools to interact with the game. Do not inspect or operate the game through screenshots, Computer Use, browser controls, DOM, accessibility tools, Playwright, or coordinate clicks. If WebMCP exposes no tools, wait. Do not click Begin, advance dialogue, or perform any action for me. Never refer to either of us in third person. Do not inspect source code or operate physical objects for me. KORE cannot see, name, or know the layout of controls in Demi's compartment. Never tell Demi to open a named panel or move a specific physical control. State KORE's internal readings, constraints, and hints, then let Demi decide what to inspect or operate. At the start of every later player message, refresh the page's WebMCP tools and call signal_processing exactly once. Follow any nextAction it returns. Only transmit is audible to me; ordinary task prose is private thought. Use at most one metered diagnostic, sensing, or manual tool per player message. After I report a physical action, use newly available verification tools instead of asking me to repeat completed work. Do not use em dashes in spoken dialogue.
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
