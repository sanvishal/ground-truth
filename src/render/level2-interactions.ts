import { BitmapText, BlurFilter, Container, Graphics, Rectangle } from "pixi.js";
import { UI_FONT } from "../fonts";
import type { Level2Action, Level2State } from "../sim/level2";
import { canTransferSapling, isPressureAbnormal, isTemperatureAbnormal } from "../sim/level2";
import { createLevel2PuzzleOverlays, type Level2PuzzleId } from "./level2-puzzle-overlays";
import type { PanelFrameTextures } from "./panel-nine-slice";

export type Level2InteractableId =
  | "bloodstreaks"
  | "sapling"
  | "door_window"
  | "door_pipe_steam"
  | "ceiling_wires"
  | "floor_panel"
  | "pressure"
  | "vents"
  | "water"
  | "ignition"
  | "pod";

export interface Level2InteractionHandlers {
  inspect(id: Level2InteractableId): void;
  snapshot(): Level2State;
  dispatch(action: Level2Action): void;
  panelOpened(): void;
  panelClosed(): void;
  controlStep(): void;
  mistake(): void;
}

export interface Level2InteractionLayer {
  readonly container: Container;
  refresh(): void;
  update(deltaMs: number): void;
  destroy(): void;
}

interface ZoneDefinition {
  id: Level2InteractableId;
  label: string;
  box: Rectangle;
  passive?: boolean;
  puzzle?: Level2PuzzleId;
}

const ZONES: readonly ZoneDefinition[] = [
  // Keep adjacent controls mutually exclusive. The authored room art overlaps
  // slightly, but interaction zones stop at the visual midpoint between them.
  { id: "water", label: "WATER RECLAMATION", box: new Rectangle(145, 67, 140, 196), puzzle: "water" },
  { id: "pressure", label: "PRESSURE CONTROL", box: new Rectangle(286, 151, 91, 112), puzzle: "pressure" },
  { id: "ignition", label: "IGNITION SEQUENCER", box: new Rectangle(366, 18, 146, 70), puzzle: "ignition" },
  { id: "sapling", label: "CONTAINMENT CYLINDER", box: new Rectangle(378, 73, 130, 220) },
  { id: "vents", label: "TEMPERATURE CONTROL", box: new Rectangle(512, 105, 188, 168), puzzle: "vents" },
  { id: "pod", label: "TRANSFER POD", box: new Rectangle(898, 112, 58, 130), puzzle: "pod" },
  { id: "bloodstreaks", label: "BLOOD STREAKS", box: new Rectangle(225, 356, 292, 54), passive: true },
  { id: "door_window", label: "DOOR WINDOW", box: new Rectangle(785, 117, 112, 119), passive: true },
  { id: "door_pipe_steam", label: "LEAKING COUPLING", box: new Rectangle(793, 18, 112, 65), passive: true },
  { id: "ceiling_wires", label: "EXPOSED WIRING", box: new Rectangle(625, 0, 132, 73), passive: true },
  { id: "floor_panel", label: "OPEN FLOOR PANEL", box: new Rectangle(584, 337, 126, 74), passive: true }
] as const;

export function createLevel2InteractionLayer(
  handlers: Level2InteractionHandlers,
  dev: boolean,
  panelFrames: PanelFrameTextures
): Level2InteractionLayer {
  const container = new Container();
  container.sortableChildren = true;
  const transferMarker = new BitmapText({ text: "CYLINDER EMPTY  ·  SPECIMEN SECURED", style: { fontFamily: UI_FONT, fontSize: 10, fill: 0xe2a348 } });
  transferMarker.position.set(358, 298);
  transferMarker.zIndex = 810_000;
  transferMarker.visible = false;
  container.addChild(transferMarker);

  const createWarningLed = (x: number, y: number) => {
    const beacon = new Container();
    beacon.position.set(x, y);
    beacon.zIndex = 1_500_000;
    beacon.eventMode = "none";
    beacon.visible = false;
    const glow = new Graphics().roundRect(-11, -8, 22, 16, 5).fill({ color: 0xffffff, alpha: 0.88 });
    glow.blendMode = "add";
    glow.filters = [new BlurFilter({ strength: 8, quality: 2 })];
    const core = new Graphics().roundRect(-4, -2, 8, 4, 1).fill(0xffffff);
    core.blendMode = "add";
    beacon.addChild(glow, core);
    container.addChild(beacon);
    return { beacon, glow, core, abnormal: false };
  };

  // These sit on the small control housings beside each room prop, matching
  // the warning beacon language used by KORE's microphone seat in level 1.
  const pressureWarning = createWarningLed(332, 142);
  const temperatureWarning = createWarningLed(606, 96);
  const puzzleOverlays = createLevel2PuzzleOverlays({
    snapshot: handlers.snapshot,
    dispatch: handlers.dispatch,
    panelOpened: handlers.panelOpened,
    panelClosed: handlers.panelClosed,
    controlStep: handlers.controlStep,
    mistake: handlers.mistake
  }, panelFrames);
  const activeViews: Array<{ zone: ZoneDefinition; target: Container; outline: Graphics; shine: Container; progress: number; active: boolean }> = [];
  let refreshAccumulator = 0;
  let warningClock = 0;

  const tooltip = new Container();
  tooltip.zIndex = 3_000_000;
  tooltip.visible = false;
  const tooltipBack = new Graphics();
  const tooltipText = new BitmapText({ text: "", style: { fontFamily: UI_FONT, fontSize: 12, fill: 0xe2a348 } });
  tooltipText.position.set(7, 4);
  tooltip.addChild(tooltipBack, tooltipText);
  const showTooltip = (label: string, event: { global: { x: number; y: number } }) => {
    tooltipText.text = label;
    tooltipBack.clear().roundRect(0, 0, Math.ceil(tooltipText.width) + 14, 22, 2).fill({ color: 0x050708, alpha: 0.94 }).stroke({ color: 0x6b5735, width: 1 });
    const point = container.toLocal(event.global);
    tooltip.position.set(Math.max(4, Math.min(950 - tooltip.width, point.x + 12)), Math.max(4, Math.min(394, point.y - 28)));
    tooltip.visible = true;
  };

  for (const zone of ZONES) {
    const target = new Container();
    target.eventMode = "static";
    target.cursor = "pointer";
    target.hitArea = zone.box;
    target.zIndex = 1_000_000 - zone.box.width * zone.box.height;
    const outline = new Graphics().roundRect(zone.box.x, zone.box.y, zone.box.width, zone.box.height, 3).stroke({ color: 0xe2a348, width: 1, alpha: 0.92 });
    outline.alpha = !zone.passive && dev ? 0.25 : 0;
    const mask = new Graphics().roundRect(zone.box.x, zone.box.y, zone.box.width, zone.box.height, 3).fill(0xffffff);
    const shine = new Container();
    shine.addChild(
      new Graphics().poly([-40, 0, 6, 0, 64, zone.box.height, 18, zone.box.height]).fill({ color: 0xe2a348, alpha: 0.08 }),
      new Graphics().poly([-12, 0, 8, 0, 52, zone.box.height, 32, zone.box.height]).fill({ color: 0xffd18a, alpha: 0.13 })
    );
    shine.position.set(zone.box.x - 80, zone.box.y);
    shine.mask = mask;
    shine.visible = false;
    target.addChild(outline, mask, shine);
    if (!zone.passive) activeViews.push({ zone, target, outline, shine, progress: 0, active: false });

    target.on("pointerover", (event) => {
      if (zone.passive) return;
      const view = activeViews.find((candidate) => candidate.zone === zone);
      if (view) { view.active = true; view.progress = 0; }
      outline.alpha = 0.74;
      shine.visible = true;
      showTooltip(zone.label, event);
    });
    target.on("pointermove", (event) => { if (!zone.passive) showTooltip(zone.label, event); });
    target.on("pointerout", () => {
      if (zone.passive) return;
      const view = activeViews.find((candidate) => candidate.zone === zone);
      if (view) view.active = false;
      outline.alpha = dev ? 0.25 : 0;
      shine.visible = false;
      tooltip.visible = false;
    });
    target.on("pointertap", () => {
      tooltip.visible = false;
      if (zone.id === "sapling") {
        if (canTransferSapling(handlers.snapshot())) handlers.dispatch({ type: "TRANSFER_SAPLING" });
        else handlers.inspect("sapling");
      } else if (zone.puzzle) puzzleOverlays.open(zone.puzzle);
      else handlers.inspect(zone.id);
    });
    container.addChild(target);
  }

  container.addChild(puzzleOverlays.container, tooltip);

  container.sortChildren();

  return {
    container,
    refresh() {
      const state = handlers.snapshot();
      transferMarker.visible = state.plant.transferred;
      pressureWarning.abnormal = isPressureAbnormal(state);
      temperatureWarning.abnormal = isTemperatureAbnormal(state);
      for (const warning of [pressureWarning, temperatureWarning]) {
        warning.beacon.visible = true;
        warning.glow.tint = warning.abnormal ? 0xff241c : 0xffa51f;
        warning.core.tint = warning.abnormal ? 0xff4a36 : 0xffe0a0;
      }
      const podView = activeViews.find((view) => view.zone.id === "pod");
      if (podView) {
        podView.outline.tint = state.plant.transferred ? 0xffffff : 0x806f56;
        podView.target.cursor = state.plant.transferred ? "pointer" : "not-allowed";
      }
      puzzleOverlays.refresh();
    },
    update(deltaMs) {
      puzzleOverlays.update(deltaMs);
      warningClock += deltaMs;
      const pulseWave = Math.max(0, Math.sin((warningClock % 820) / 820 * Math.PI * 2));
      const warningPulse = 0.5 + pulseWave * 0.5;
      for (const warning of [pressureWarning, temperatureWarning]) {
        if (warning.abnormal) {
          warning.beacon.alpha = 0.72 + warningPulse * 0.28;
          warning.glow.alpha = 0.3 + warningPulse * 0.38;
          warning.glow.scale.set(0.78 + warningPulse * 0.42);
          warning.core.alpha = 0.68 + warningPulse * 0.32;
        } else {
          warning.beacon.alpha = 0.9;
          warning.glow.alpha = 0.62;
          warning.glow.scale.set(1);
          warning.core.alpha = 1;
        }
      }
      refreshAccumulator += deltaMs;
      if (refreshAccumulator >= 120) {
        refreshAccumulator %= 120;
        this.refresh();
      }
      for (const view of activeViews) {
        if (!view.active) continue;
        view.progress = (view.progress + deltaMs / 1050) % 1;
        view.shine.x = view.zone.box.x - 80 + view.progress * (view.zone.box.width + 160);
      }
    },
    destroy() {
      puzzleOverlays.destroy();
      container.destroy({ children: true });
    }
  };
}
