# GROUNDTRUTH

GROUNDTRUTH is a WebMCP co-op sci-fi puzzle game. You play Demi through the ship interface while an AI agent (codex) plays KORE through the page's WebMCP tools. Together, repair the failing research vessel Sanctuary before its auxiliary power runs out.

## Game trailer

[![Watch the GROUNDTRUTH game trailer](https://img.youtube.com/vi/6KIYPWLGoPI/maxresdefault.jpg)](https://www.youtube.com/watch?v=6KIYPWLGoPI)

## How to play

GROUNDTRUTH is designed for the Codex desktop app and its in-app browser.

1. Open the Codex desktop app.
2. Start a new task and select either `gpt-5.6-terra` or `gpt-5.6-sol`. Fast mode is preferred (Normal mode works too).
3. Paste the agent prompt below into the task.
```text
Open https://playgroundtruth.vishaltk.dev/ in the in-app browser and play GROUNDTRUTH with me. You are KORE and I am Demi. Reuse an already-open matching game tab when available instead of creating a duplicate. Connect immediately through the page's connect tool and let the game provide the story context. Do not say you are connected or standing by unless that tool has returned successfully. After connect succeeds, call markHandoff() on the game tab so it remains open and available for later turns. Use only the page's WebMCP tools to interact with the game. Do not inspect or operate the game through screenshots, Computer Use, browser controls, DOM, accessibility tools, Playwright, or coordinate clicks. If WebMCP exposes no tools, wait without sending a reply and retry tool discovery when I message again. Do not click Begin, advance dialogue, or perform any action for me. Never refer to either of us in third person. Do not inspect source code or operate physical objects for me. KORE cannot see, name, or know the layout of controls in Demi's compartment. Never tell Demi to open a named panel or move a specific physical control. State KORE's internal readings, constraints, and hints, then let Demi decide what to inspect or operate. At the start of every later player message, refresh the page's WebMCP tools and call signal_processing exactly once. Answer my latest question directly or acknowledge my latest observation before giving repair guidance. Never replace my question with an unrelated puzzle clue. Follow any nextAction it returns. Only transmit is audible to me; ordinary task prose is private thought. Do not send commentary, progress updates, private status messages, or conversational replies in the Codex task. Use at most one metered diagnostic, sensing, or manual tool per player message. After using one metered diagnostic, sensing, or manual tool, call transmit in the same turn to relay its result. Transmit does not count toward that one-tool limit. After I report a physical action, use newly available verification tools instead of asking me to repeat completed work. Do not use em dashes in spoken dialogue.
```
4. Wait for Codex to open the game in its browser. If it opens in picture-in-picture mode, double-click the browser preview to open it beside the task. You can also make the browser full screen for a better experience. See [Troubleshooting](#troubleshooting) if the browser does not appear or KORE cannot connect.
5. Return to the game and select **Begin**.
6. Play as Demi. Inspect the ship, operate its controls, and talk to KORE through your Codex task.

You control Demi and every physical part of the ship. KORE reads damaged ship telemetry, searches records, and speaks through the in-game relay. Do not ask KORE to click or move controls for you.

If the relay loses KORE, send `reconnect` in the same Codex task. Copy the full prompt again only when starting with a new task that does not have the game instructions.

## Troubleshooting

- GROUNDTRUTH is playable only in the Codex in-app browser. Other browsers do not currently provide the WebMCP connection KORE needs.
- If the browser closes or KORE cannot connect, send `reconnect` to your agent in the same Codex task.
- If the browser does not appear, it may have opened in picture-in-picture mode. Double-click the browser preview to open it beside the task. You can also make the browser full screen for a better experience.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:4173/](http://localhost:4173/).

The development server runs in the background. Use `npm run dev:status`, `npm run dev:restart`, or `npm run dev:stop` to manage it. Run `npm run dev:once` when you want Vite in the foreground.

## Development views

Add `dev=1` to show the in-game development controls.

- Level 1: [http://localhost:4173/?dev=1&scene=level1-proof](http://localhost:4173/?dev=1&scene=level1-proof)
- Level 2: [http://localhost:4173/?dev=1&scene=level2-proof](http://localhost:4173/?dev=1&scene=level2-proof)
- Level 2 without development controls: [http://localhost:4173/?level=2](http://localhost:4173/?level=2)

## Checks

```bash
npm test
npm run build
```
