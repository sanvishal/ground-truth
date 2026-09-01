# GROUNDTRUTH

GROUNDTRUTH is a pixel-art WebMCP co-op game. The human plays Demi through the ship interface while an agent plays KORE through the tools exposed by the page.

The current build contains the Level 1 Foundation and Level 2 Greenhouse runtimes:

- KORE connection, audible transmit relay, diagnostics, manuals, and AUX reserve
- dynamic WebMCP tools with a debounced physical hand gate
- wire restoration, spiral repair, breaker fault isolation, and blast-door diversion
- five lighting stages driven by gameplay state
- pressure, thermal coupling, water reclamation, and ignition systems in Level 2
- persistent checkpoints with a required KORE reconnection on resume
- a `?dev=1` runtime panel with milestone controls, active tools, exact reserve, and event trace

The trust beat is intentionally skipped in the active Level 1 route. Production pages do not expose the runtime state on `window` or in DOM/ARIA; the inspection surface is only mounted in dev mode.

The production route opens on the main menu. Copying the play prompt gives the agent the game URL, establishes the role boundary, and tells KORE to connect. Level 2 can be opened directly for playtesting with `?level=2`.

## Run

```bash
npm install
npm run dev
```

Open `http://localhost:4173/?dev=1` for the Dialogue Lab. The production-style startup is available without the query string.

Open `http://localhost:4173/?level=2` to enter the Level 2 playtest directly.

## Dialogue Lab

The responsive game shell scales down as one 16:9 unit instead of clipping. Hybrid is the default density; the lab sits below the game so the full scene remains visible while testing all three density presets, three type speeds, clean/wave/restrained-jitter rendering, long KORE and Demi samples, interruption handling, and queued hover reactions. Typography is locked: ImpactfulBits for UI and PixelSans for dialogue. Glitch words such as `Bzzzt` receive a subtle one-pixel word-level jitter automatically; the lab can apply the same restrained motion globally for comparison. Click a dialogue page—or press Enter, Space, or Right Arrow—to complete type-on and advance pages. Once a multi-page line has been read, further clicks loop through its pages without replaying type-on; a newly queued message still takes priority. Once both speakers have history, clicking the active portrait or its top-left `SWAP` badge brings the other speaker's last line forward. The LOG control opens the transcript; development mode also exposes a `.txt` export.

## Verification

```bash
npm test
npm run build
```
