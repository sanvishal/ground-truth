import { BitmapText, BlurFilter, Container, Graphics, MeshRope, Point, Polygon, Rectangle, Sprite } from "pixi.js";
import { UI_FONT } from "../fonts";
import { LEVEL1_WIRES, type ContinuitySequence, type Level1State, type SignalGlyph, type WireId, type WirePort } from "../sim/level1";
import { createLevel1PuzzleOverlays, type Level1PuzzleId } from "./level1-puzzle-overlays";
import { PanelApertureTransition } from "./panel-aperture-transition";
import { createHardwareSprite, createInteractionCue, createPanelNameplate, createPanelSurface, type PanelFrameTextures, type PanelHardwareTextures, type PanelNameplateTextures } from "./panel-nine-slice";
import { createPanelMistakeSparks } from "./panel-mistake-sparks";
import { panelText, type PanelText } from "./panel-text";

export type Level1InteractableId =
  | "wire_panel"
  | "continuity_switch"
  | "kore_mic"
  | "junction_board"
  | "regulator"
  | "breaker_bank"
  | "window"
  | "steam_left"
  | "steam_console"
  | "steam_ceiling"
  | "bloodstreaks"
  | "ceiling_cable"
  | "door_panel"
  | "door_exit";

export interface Level1InteractionHandlers {
  panelOpened(): void;
  panelClosed(): void;
  buttonPress(): void;
  inspect(id: Level1InteractableId): void;
  completeContinuitySequence(): { ok: boolean; error?: string };
  puzzleMistake(puzzle: string): void;
  canOpenWirePanel(): boolean;
  getGuidanceState(): { busRestored: boolean; micReseated: boolean };
  getState(): Level1State;
  getWireConnections(): Record<WireId, WirePort | null>;
  getMeasuredPorts(): WirePort[];
  connectWire(wire: WireId, port: WirePort): { ok: boolean; error?: string };
  disconnectWire(wire: WireId): { ok: boolean; error?: string };
  rotateJunction(index: number): void;
  selectJunctionGlyph(glyph: SignalGlyph): void;
  setRegulator(index: number, value: number): void;
  touchBreaker(index: number): void;
  toggleBreaker(index: number): void;
  pullBreaker(index: number): void;
}

export interface Level1InteractionLayer {
  readonly container: Container;
  mistakeBurst(): void;
  resetView(): void;
  refresh(): void;
  update(deltaMs: number): void;
  destroy(): void;
}

const ZONES: ReadonlyArray<{ id: Level1InteractableId; label: string; box: Rectangle }> = [
  { id: "wire_panel", label: "BUS LOOM", box: new Rectangle(68, 42, 92, 214) },
  { id: "continuity_switch", label: "CONTINUITY SEQUENCER", box: new Rectangle(95, 113, 34, 52) },
  { id: "kore_mic", label: "KORE MIC", box: new Rectangle(318, 204, 54, 45) },
  { id: "junction_board", label: "JUNCTION ROUTER", box: new Rectangle(620, 72, 126, 176) },
  { id: "regulator", label: "HARMONIC REGULATOR", box: new Rectangle(368, 213, 126, 65) },
  { id: "breaker_bank", label: "BREAKERS", box: new Rectangle(648, 86, 72, 144) },
  { id: "door_panel", label: "DOOR FEED", box: new Rectangle(900, 143, 38, 70) },
  { id: "door_exit", label: "OPEN DOORWAY", box: new Rectangle(794, 77, 135, 215) },
  { id: "window", label: "CRACKED VIEWPORT", box: new Rectangle(164, 48, 432, 154) },
  { id: "steam_left", label: "LEFT PIPE SEAM", box: new Rectangle(5, 202, 36, 38) },
  { id: "steam_console", label: "CONSOLE PIPE", box: new Rectangle(593, 217, 34, 38) },
  { id: "steam_ceiling", label: "CEILING COUPLING", box: new Rectangle(790, 29, 34, 38) },
  { id: "bloodstreaks", label: "BLOODSTREAKS", box: new Rectangle(220, 312, 270, 42) },
  { id: "ceiling_cable", label: "DAMAGED CEILING CABLE", box: new Rectangle(238, 10, 92, 55) }
];

const SCENE_OBSERVATION_IDS = new Set<Level1InteractableId>([
  "window",
  "steam_left",
  "steam_console",
  "steam_ceiling",
  "bloodstreaks",
  "ceiling_cable"
]);

const NESTED_ZONE_EXCLUSIONS: Partial<Record<Level1InteractableId, readonly Level1InteractableId[]>> = {
  wire_panel: ["continuity_switch"],
  junction_board: ["breaker_bank"]
};

const DOOR_EXIT_SHAPE = [
  812, 77,
  911, 77,
  929, 95,
  929, 274,
  911, 292,
  812, 292,
  794, 274,
  794, 95
] as const;

export function createLevel1InteractionLayer(
  handlers: Level1InteractionHandlers,
  dev = false,
  panelFrames: PanelFrameTextures,
  panelNameplates: PanelNameplateTextures,
  panelHardware: PanelHardwareTextures
): Level1InteractionLayer {
  const container = new Container();
  container.sortableChildren = true;
  const mistakeSparks = createPanelMistakeSparks();
  const outlines: Graphics[] = [];
  const shines: Array<{ node: Container; zone: Rectangle; active: boolean; progress: number }> = [];
  const zoneViews: Array<{ id: Level1InteractableId; target: Container; outline: Graphics; shine: Container; shineEntry: { active: boolean; progress: number } }> = [];
  let revealHeld = false;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  let openWirePanel = () => handlers.inspect("wire_panel");
  let openContinuityPanel = () => handlers.inspect("continuity_switch");
  let openPuzzle = (id: Level1PuzzleId) => handlers.inspect(id);

  const tooltip = new Container();
  tooltip.zIndex = 3_000_000;
  tooltip.visible = false;
  tooltip.eventMode = "none";
  const tooltipBack = new Graphics();
  const tooltipText = new BitmapText({ text: "", style: { fontFamily: UI_FONT, fontSize: 12, fill: 0xe2a348 } });
  tooltipText.position.set(7, 4);
  tooltip.addChild(tooltipBack, tooltipText);
  const showTooltip = (label: string, event: { global: { x: number; y: number } }) => {
    tooltipText.text = label;
    tooltipBack.clear().roundRect(0, 0, Math.ceil(tooltipText.width) + 14, 22, 2).fill({ color: 0x050708, alpha: 0.94 }).stroke({ color: 0x6b5735, width: 1 });
    const point = container.toLocal(event.global);
    tooltip.position.set(
      Math.max(4, Math.min(956 - tooltip.width, point.x + 12)),
      Math.max(4, Math.min(394, point.y - 28))
    );
    tooltip.visible = true;
  };

  const renderOutlines = () => {
    for (const outline of outlines) outline.alpha = revealHeld || dev ? 0.34 : 0;
  };

  for (const zone of ZONES) {
    const isSceneObservation = SCENE_OBSERVATION_IDS.has(zone.id);
    const isDoorExit = zone.id === "door_exit";
    const target = new Container();
    target.eventMode = "static";
    target.cursor = "pointer";
    const exclusions = (NESTED_ZONE_EXCLUSIONS[zone.id] ?? [])
      .map((id) => ZONES.find((candidate) => candidate.id === id)?.box)
      .filter((box): box is Rectangle => Boolean(box));
    target.hitArea = isDoorExit
      ? new Polygon([...DOOR_EXIT_SHAPE])
      : {
          contains: (x: number, y: number) => zone.box.contains(x, y) && !exclusions.some((box) => box.contains(x, y))
        };
    target.zIndex = 1_000_000 - zone.box.width * zone.box.height;
    const outline = new Graphics();
    if (isDoorExit) outline.poly([...DOOR_EXIT_SHAPE]).stroke({ color: 0x83d1a1, width: 2, alpha: 0.9 });
    else outline.roundRect(zone.box.x, zone.box.y, zone.box.width, zone.box.height, 2).stroke({ color: 0xe2a348, width: 1, alpha: 0.9 });
    outline.alpha = !isSceneObservation && dev ? 0.34 : 0;
    if (!isSceneObservation && !isDoorExit) outlines.push(outline);
    const shineMask = new Graphics();
    if (isDoorExit) shineMask.poly([...DOOR_EXIT_SHAPE]).fill(0xffffff);
    else shineMask.roundRect(zone.box.x, zone.box.y, zone.box.width, zone.box.height, 2).fill(0xffffff);
    shineMask.eventMode = "none";
    const shine = new Container();
    const shineColor = isDoorExit ? 0x83d1a1 : 0xe2a348;
    const shineHot = isDoorExit ? 0xb8f5ca : 0xffc96f;
    const shineCore = isDoorExit ? 0xe0ffe8 : 0xffe2ad;
    shine.addChild(
      new Graphics().poly([-38, 0, 22, 0, 64, zone.box.height, 4, zone.box.height]).fill({ color: shineColor, alpha: isDoorExit ? 0.11 : 0.07 }),
      new Graphics().poly([-15, 0, 18, 0, 55, zone.box.height, 22, zone.box.height]).fill({ color: shineHot, alpha: isDoorExit ? 0.15 : 0.1 }),
      new Graphics().poly([2, 0, 14, 0, 48, zone.box.height, 36, zone.box.height]).fill({ color: shineCore, alpha: isDoorExit ? 0.18 : 0.13 })
    );
    shine.position.set(zone.box.x - 80, zone.box.y);
    shine.mask = shineMask;
    shine.eventMode = "none";
    shine.visible = false;
    const shineEntry = { node: shine, zone: zone.box, active: false, progress: 0 };
    shines.push(shineEntry);
    zoneViews.push({ id: zone.id, target, outline, shine, shineEntry });
    target.addChild(outline, shineMask, shine);

    if (dev && !isSceneObservation) {
      const label = new BitmapText({ text: zone.label, style: { fontFamily: UI_FONT, fontSize: 10, fill: 0xe2a348 } });
      label.position.set(zone.box.x + 3, zone.box.y + 3);
      target.addChild(label);
    }

    target.on("pointerover", (event) => {
      if (isSceneObservation) {
        tooltip.visible = false;
        return;
      }
      outline.alpha = 0.68;
      shineEntry.active = true;
      shineEntry.progress = 0;
      shine.visible = true;
      showTooltip(zone.label, event);
    });
    target.on("pointermove", (event) => {
      if (!isSceneObservation) showTooltip(zone.label, event);
    });
    target.on("pointerout", () => {
      if (isSceneObservation) return;
      if (isDoorExit && handlers.getState().door.opened) {
        outline.alpha = 0.72;
        shineEntry.active = true;
        shine.visible = true;
        tooltip.visible = false;
        return;
      }
      outline.alpha = revealHeld || dev ? 0.34 : 0;
      shineEntry.active = false;
      shine.visible = false;
      tooltip.visible = false;
    });
    if (zone.id === "continuity_switch") {
      target.on("pointertap", () => openContinuityPanel());
    } else target.on("pointertap", () => {
      if (zone.id === "wire_panel") openWirePanel();
      else if (zone.id === "junction_board" || zone.id === "regulator" || zone.id === "breaker_bank") openPuzzle(zone.id);
      else handlers.inspect(zone.id);
    });
    container.addChild(target);
  }

  const syncZoneAvailability = () => {
    const state = handlers.getState();
    for (const view of zoneViews) {
      const available = view.id === "door_exit"
        ? state.door.opened
        : view.id !== "bloodstreaks" || state.wires.solved;
      view.target.visible = available;
      view.target.eventMode = available ? "static" : "none";
      if (view.id === "door_exit" && available) {
        view.outline.alpha = 0.72;
        view.shineEntry.active = true;
        view.shine.visible = true;
      } else if (!available) {
        view.outline.alpha = 0;
        view.shineEntry.active = false;
        view.shine.visible = false;
      }
    }
  };

  const micBeacon = new Container();
  micBeacon.zIndex = 1_500_000;
  micBeacon.position.set(345, 222);
  micBeacon.eventMode = "none";
  const micGlow = new Graphics().roundRect(-9, -6, 18, 12, 3).fill({ color: 0xffa51f, alpha: 0.72 });
  micGlow.blendMode = "add";
  micGlow.filters = [new BlurFilter({ strength: 6, quality: 2 })];
  const micCore = new Graphics().roundRect(-4, -2, 8, 4, 1).fill(0xffe0a0);
  micCore.blendMode = "add";
  micBeacon.addChild(micGlow, micCore);
  micBeacon.visible = false;
  container.addChild(micBeacon);

  const wireOverlay = new Container();
  wireOverlay.zIndex = 2_000_000;
  wireOverlay.visible = false;
  wireOverlay.eventMode = "none";
  const wireBackdrop = new Graphics().rect(0, 0, 960, 420).fill({ color: 0x020304, alpha: 0.78 });
  wireBackdrop.eventMode = "static";
  wireBackdrop.cursor = "pointer";
  const wirePlate = createPanelSurface(panelFrames.standard, 588, 306);
  wirePlate.position.set(186, 58);
  wirePlate.eventMode = "static";
  wirePlate.hitArea = new Rectangle(186, 58, 588, 306);
  const title = createPanelNameplate(panelNameplates.emergencyBusLoom, 276, 66, 170, -0.012);
  const hint = panelText("", 10, 0x8f918c, "bus-loom-hint");
  hint.anchor.set(1, 0.5);
  hint.position.set(740, 340);
  const close = new Container();
  close.position.set(720, 73);
  close.eventMode = "static";
  close.cursor = "pointer";
  close.hitArea = new Rectangle(0, 0, 30, 30);
  close.addChild(
    (() => {
      const node = panelText("X", 15, 0xe2a348, "bus-loom-close");
      node.anchor.set(0.5);
      node.position.set(15, 15);
      return node;
    })()
  );
  let selectedWire: WireId | null = null;
  let draggingWire: WireId | null = null;
  let dragStart = new Point();
  let dragMoved = false;
  const wireNodes = new Map<WireId, Container>();
  const wireConnectorViews = new Map<WireId, { connector: Sprite; shadow: Sprite }>();
  const portNodes = new Map<WirePort, Container>();
  const portLabels = new Map<WirePort, BitmapText>();
  const portSocketViews = new Map<WirePort, { socket: Sprite; shadow: Sprite }>();
  let wireDragCue: ReturnType<typeof createInteractionCue> | null = null;
  let wireDragCueDismissed = false;
  const ropeEntries = new Map<WireId, {
    mesh: MeshRope;
    points: Point[];
    previous: Point[];
    meshPoints: Point[];
    anchor: Point;
    restingTip: Point;
    tip: Point;
    connectorWidth: number;
    looseWidth: number;
    seatedWidth: number;
    seatedAnchorX: number;
    scale: number;
    damping: number;
    gravity: number;
    slack: number;
    constraintIterations: number;
  }>();
  const wireLabels: Record<WireId, string> = {
    blue_heavy: "HEAVY BLUE",
    ridged_heavy: "RIDGED DARK",
    cloth_mid: "CLOTH MID",
    smooth_light: "SMOOTH LIGHT",
    green_light: "THIN GREEN"
  };
  const ports: WirePort[] = ["P1", "P2", "P3", "P4", "P5"];
  const wireRowStartY = 138;
  const wireRowGap = 40;
  const portPositions = new Map<WirePort, Point>(ports.map((port, index) => [port, new Point(625, wireRowStartY + index * wireRowGap)]));
  const renderWirePanel = () => {
    const connections = handlers.getWireConnections();
    const measured = new Set(handlers.getMeasuredPorts());
    for (const wire of LEVEL1_WIRES) {
      const node = wireNodes.get(wire.id);
      if (node) node.alpha = selectedWire === wire.id ? 1 : 0.92;
      const port = connections[wire.id];
      const entry = ropeEntries.get(wire.id);
      const connectorView = wireConnectorViews.get(wire.id);
      const seated = Boolean(port && draggingWire !== wire.id);
      if (entry && connectorView) {
        const texture = seated ? panelHardware.busConnectorSeated[wire.id] : panelHardware.busConnectorHeads[wire.id];
        const displayWidth = seated ? entry.seatedWidth : entry.looseWidth;
        const anchorX = seated ? entry.seatedAnchorX : 1;
        entry.connectorWidth = displayWidth * anchorX;
        connectorView.connector.texture = texture;
        connectorView.shadow.texture = texture;
        connectorView.connector.anchor.set(anchorX, 0.5);
        connectorView.shadow.anchor.set(anchorX, 0.5);
        connectorView.connector.scale.set(displayWidth / texture.width);
        connectorView.shadow.scale.set(displayWidth / texture.width);
      }
      if (entry && port && draggingWire !== wire.id) {
        const socket = portPositions.get(port)!;
        entry.tip.copyFrom(socket);
      }
    }
    for (const port of ports) {
      const row = portNodes.get(port);
      if (row) row.alpha = 1;
      const socketView = portSocketViews.get(port);
      const occupied = LEVEL1_WIRES.some((wire) => connections[wire.id] === port && draggingWire !== wire.id);
      if (socketView) {
        socketView.socket.visible = !occupied;
        socketView.shadow.visible = !occupied;
      }
      const label = portLabels.get(port);
      if (label) label.text = measured.has(port)
        ? `${Math.round(handlers.getState().wires.impedance[port]).toString().padStart(2, "0")} OHM`
        : "—";
    }
    if (wireDragCue) wireDragCue.visible = !wireDragCueDismissed && !connections.blue_heavy && draggingWire !== "blue_heavy";
  };

  const connectSelectedWire = (wireId: WireId, port: WirePort) => {
    const result = handlers.connectWire(wireId, port);
    if (!result.ok) {
      ropeEntries.get(wireId)?.tip.copyFrom(ropeEntries.get(wireId)!.restingTip);
      hint.text = (result.error ?? "CONNECTION REJECTED.").toUpperCase();
      renderWirePanel();
      return;
    }
    selectedWire = null;
    hint.text = `CONDUCTOR SEATED IN ${port}.`;
    renderWirePanel();
    const connections = handlers.getWireConnections();
    const targets = handlers.getState().wires.targets;
    if (LEVEL1_WIRES.every((wire) => connections[wire.id] === targets[wire.id])) {
      hint.text = "BUS RESTORED. KORE MIC IS NOW BLINKING.";
      if (closeTimer) clearTimeout(closeTimer);
      closeTimer = setTimeout(() => hideWirePanel(), 1200);
    }
  };

  const weightArrow = new Graphics()
    .moveTo(286, 304)
    .lineTo(286, 134)
    .moveTo(278, 144)
    .lineTo(286, 134)
    .lineTo(294, 144)
    .stroke({ color: 0x9f957d, width: 2, alpha: 0.9 });
  weightArrow.eventMode = "none";
  const weightLabel = panelText("HEAVY", 14, 0xb3aea1, "bus-loom-weight-direction");
  weightLabel.anchor.set(0.5);
  weightLabel.position.set(269, 217);
  weightLabel.rotation = -Math.PI / 2;
  wireOverlay.addChild(weightArrow, weightLabel);

  const beginWireDrag = (wireId: WireId, event: { global: Point; stopPropagation(): void }) => {
    event.stopPropagation();
    selectedWire = wireId;
    draggingWire = wireId;
    dragMoved = false;
    if (wireId === "blue_heavy") {
      wireDragCueDismissed = true;
      if (wireDragCue) wireDragCue.visible = false;
    }
    const point = wirePanelContent.toLocal(event.global);
    dragStart.copyFrom(point);
    wireNodes.get(wireId)!.cursor = "grabbing";
    hint.text = `${wireLabels[wireId]} SELECTED. DRAG TO A SOCKET.`;
    renderWirePanel();
  };

  LEVEL1_WIRES.forEach((wire, index) => {
    const rowY = wireRowStartY + index * wireRowGap;
    const anchor = new Point(333, rowY);
    const restingTip = new Point(425, rowY);
    const connectorWidths: Record<WireId, number> = {
      blue_heavy: 82,
      ridged_heavy: 78,
      cloth_mid: 76,
      smooth_light: 72,
      green_light: 70
    };
    const seatedWidths: Record<WireId, number> = {
      blue_heavy: 64,
      ridged_heavy: 66,
      cloth_mid: 72,
      smooth_light: 63,
      green_light: 62
    };
    const seatedAnchorXs: Record<WireId, number> = {
      blue_heavy: 0.614,
      ridged_heavy: 0.621,
      cloth_mid: 0.524,
      smooth_light: 0.629,
      green_light: 0.585
    };
    const looseWidth = connectorWidths[wire.id];
    const seatedWidth = seatedWidths[wire.id];
    const seatedAnchorX = seatedAnchorXs[wire.id];
    const connectorWidth = looseWidth;
    const cableProfiles: Record<WireId, {
      scale: number;
      damping: number;
      gravity: number;
      slack: number;
      constraintIterations: number;
      restingSag: number;
    }> = {
      blue_heavy: { scale: 0.18, damping: 0.18, gravity: 0.1, slack: 0.012, constraintIterations: 12, restingSag: 3 },
      ridged_heavy: { scale: 0.145, damping: 0.22, gravity: 0.13, slack: 0.02, constraintIterations: 11, restingSag: 4 },
      cloth_mid: { scale: 0.11, damping: 0.27, gravity: 0.17, slack: 0.032, constraintIterations: 10, restingSag: 5.5 },
      smooth_light: { scale: 0.082, damping: 0.32, gravity: 0.21, slack: 0.05, constraintIterations: 9, restingSag: 7 },
      green_light: { scale: 0.058, damping: 0.38, gravity: 0.26, slack: 0.075, constraintIterations: 8, restingSag: 9 }
    };
    const profile = cableProfiles[wire.id];
    const pointCount = 22;
    const initialTailX = restingTip.x - connectorWidth + 3;
    const points = Array.from({ length: pointCount }, (_, pointIndex) => {
      const t = pointIndex / (pointCount - 1);
      return new Point(
        anchor.x + (initialTailX - anchor.x) * t,
        anchor.y + Math.sin(t * Math.PI) * profile.restingSag
      );
    });
    const previous = points.map((point) => point.clone());
    const meshPoints = points.map((point) => new Point(point.x / profile.scale, point.y / profile.scale));
    const rope = new MeshRope({
      texture: panelHardware.busRopeTextures[wire.id],
      points: meshPoints,
      textureScale: 0
    });
    rope.scale.set(profile.scale);
    rope.eventMode = "none";
    rope.roundPixels = true;
    wireOverlay.addChild(rope);

    const origin = new Container();
    origin.position.set(anchor.x - 8, rowY);
    const originVoid = new Graphics();
    for (let step = 0; step < 7; step += 1) {
      const radius = 10.5 - step * 1.2;
      const alpha = 0.05 + step * 0.066;
      originVoid.circle(0, 0, radius).fill({ color: 0x020405, alpha });
    }
    origin.eventMode = "none";
    origin.addChild(originVoid);
    wireOverlay.addChild(origin);

    const row = new Container();
    row.position.set(restingTip.x, restingTip.y);
    row.zIndex = 30;
    row.eventMode = "static";
    row.cursor = "grab";
    row.hitArea = new Rectangle(-connectorWidth - 5, -18, connectorWidth + 12, 36);
    const connectorShadow = new Sprite(panelHardware.busConnectorHeads[wire.id]);
    const connector = new Sprite(panelHardware.busConnectorHeads[wire.id]);
    const connectorScale = connectorWidth / connector.texture.width;
    connectorShadow.anchor.set(1, 0.5);
    connectorShadow.position.set(3, 4);
    connectorShadow.scale.set(connectorScale);
    connectorShadow.tint = 0x000000;
    connectorShadow.alpha = 0.68;
    connectorShadow.filters = [new BlurFilter({ strength: 1.5, quality: 1 })];
    connector.anchor.set(1, 0.5);
    connector.scale.set(connectorScale);
    connector.roundPixels = true;
    row.addChild(connectorShadow, connector);
    if (wire.id === "blue_heavy") {
      wireDragCue = createInteractionCue();
      wireDragCue.position.set(-connectorWidth * 0.52, -19);
      row.addChild(wireDragCue);
    }
    row.on("pointerdown", (event) => beginWireDrag(wire.id, event));
    row.on("pointertap", () => {
      if (dragMoved) return;
      selectedWire = wire.id;
      hint.text = `${wireLabels[wire.id]} SELECTED. CHOOSE A TERMINAL.`;
      renderWirePanel();
    });
    wireNodes.set(wire.id, row);
    wireConnectorViews.set(wire.id, { connector, shadow: connectorShadow });
    ropeEntries.set(wire.id, {
      mesh: rope,
      points,
      previous,
      meshPoints,
      anchor,
      restingTip,
      tip: restingTip.clone(),
      connectorWidth,
      looseWidth,
      seatedWidth,
      seatedAnchorX,
      scale: profile.scale,
      damping: profile.damping,
      gravity: profile.gravity,
      slack: profile.slack,
      constraintIterations: profile.constraintIterations
    });
    wireOverlay.addChild(row);
  });

  ports.forEach((port) => {
    const row = new Container();
    const position = portPositions.get(port)!;
    row.position.copyFrom(position);
    row.zIndex = 20;
    row.eventMode = "static";
    row.cursor = "pointer";
    row.hitArea = new Rectangle(-22, -17, 116, 34);
    const socketShadow = new Sprite(panelHardware.busSocketOpen);
    const socket = new Sprite(panelHardware.busSocketOpen);
    const socketScale = 40 / socket.texture.width;
    socketShadow.anchor.set(0.5);
    socketShadow.position.set(2, 3);
    socketShadow.scale.set(socketScale);
    socketShadow.tint = 0x000000;
    socketShadow.alpha = 0.65;
    socket.anchor.set(0.5);
    socket.scale.set(socketScale);
    socket.roundPixels = true;
    const portName = panelText(port, 14, 0xe2a348, `bus-loom-name-${port}`);
    portName.anchor.set(0, 0.5);
    portName.position.set(22, -8);
    const portLabel = new BitmapText({
      text: "—",
      style: { fontFamily: UI_FONT, fontSize: 12, fill: 0xc4c0b4, letterSpacing: 0 }
    });
    portLabel.anchor.set(0, 0.5);
    portLabel.position.set(22, 9);
    row.addChild(socketShadow, socket, portName, portLabel);
    row.on("pointerdown", (event) => {
      const connectedWire = LEVEL1_WIRES.find((wire) => handlers.getWireConnections()[wire.id] === port);
      if (connectedWire) beginWireDrag(connectedWire.id, event);
    });
    row.on("pointertap", () => {
      if (dragMoved) return;
      if (!selectedWire) return;
      connectSelectedWire(selectedWire, port);
    });
    portNodes.set(port, row);
    portLabels.set(port, portLabel);
    portSocketViews.set(port, { socket, shadow: socketShadow });
    wireOverlay.addChild(row);
  });

  const finishWireDrag = () => {
    if (!draggingWire) return;
    const wireId = draggingWire;
    const entry = ropeEntries.get(wireId)!;
    const closest = ports
      .map((port) => ({ port, point: portPositions.get(port)! }))
      .map((candidate) => ({ ...candidate, distance: Math.hypot(entry.tip.x - candidate.point.x, entry.tip.y - candidate.point.y) }))
      .sort((a, b) => a.distance - b.distance)[0];
    const previousPort = handlers.getWireConnections()[wireId];
    draggingWire = null;
    wireNodes.get(wireId)!.cursor = "grab";
    if (closest && closest.distance < 40) connectSelectedWire(wireId, closest.port);
    else {
      if (previousPort) {
        const result = handlers.disconnectWire(wireId);
        hint.text = result.ok ? "CONDUCTOR RETURNED." : (result.error ?? "CONDUCTOR LOCKED.").toUpperCase();
      }
      entry.tip.copyFrom(entry.restingTip);
      renderWirePanel();
    }
  };

  wireOverlay.on("globalpointermove", (event) => {
    if (!draggingWire) return;
    const point = wirePanelContent.toLocal(event.global);
    if (Math.hypot(point.x - dragStart.x, point.y - dragStart.y) > 4) dragMoved = true;
    const entry = ropeEntries.get(draggingWire)!;
    entry.tip.set(
      Math.max(425, Math.min(650, point.x)),
      Math.max(128, Math.min(306, point.y))
    );
  });
  wireOverlay.on("pointerup", finishWireDrag);
  wireOverlay.on("pointerupoutside", finishWireDrag);
  wireOverlay.on("pointercancel", finishWireDrag);

  const updateWireRopes = (deltaMs: number) => {
    if (!wireTransition.visible) return;
    const frame = Math.min(2, deltaMs / (1000 / 60));
    for (const [wireId, entry] of ropeEntries) {
      const node = wireNodes.get(wireId)!;
      node.position.copyFrom(entry.tip);
      const tail = new Point(entry.tip.x - entry.connectorWidth + 3, entry.tip.y);
      for (let index = 1; index < entry.points.length - 1; index += 1) {
        const point = entry.points[index];
        const previous = entry.previous[index];
        const oldX = point.x;
        const oldY = point.y;
        point.x += (point.x - previous.x) * entry.damping;
        point.y += (point.y - previous.y) * entry.damping + entry.gravity * frame;
        previous.set(oldX, oldY);
      }
      const endpointDistance = Math.hypot(tail.x - entry.anchor.x, tail.y - entry.anchor.y);
      const segmentLength = endpointDistance * (1 + entry.slack) / (entry.points.length - 1);
      for (let iteration = 0; iteration < entry.constraintIterations; iteration += 1) {
        entry.points[0].copyFrom(entry.anchor);
        entry.points[entry.points.length - 1].copyFrom(tail);
        for (let index = 0; index < entry.points.length - 1; index += 1) {
          const left = entry.points[index];
          const right = entry.points[index + 1];
          const dx = right.x - left.x;
          const dy = right.y - left.y;
          const distance = Math.max(0.001, Math.hypot(dx, dy));
          const correction = (distance - segmentLength) / distance;
          const offsetX = dx * correction * 0.5;
          const offsetY = dy * correction * 0.5;
          if (index > 0) {
            left.x += offsetX;
            left.y += offsetY;
          }
          if (index + 1 < entry.points.length - 1) {
            right.x -= offsetX;
            right.y -= offsetY;
          }
        }
      }
      entry.points[0].copyFrom(entry.anchor);
      entry.points[entry.points.length - 1].copyFrom(tail);
      const smoothed = entry.points.map((point) => point.clone());
      for (let pass = 0; pass < 2; pass += 1) {
        for (let index = 1; index < smoothed.length - 1; index += 1) {
          const left = smoothed[index - 1];
          const center = smoothed[index];
          const right = smoothed[index + 1];
          center.set(
            left.x * 0.24 + center.x * 0.52 + right.x * 0.24,
            left.y * 0.24 + center.y * 0.52 + right.y * 0.24
          );
        }
      }
      smoothed[0].copyFrom(entry.anchor);
      smoothed[smoothed.length - 1].copyFrom(tail);
      entry.meshPoints.forEach((point, index) => point.set(smoothed[index].x / entry.scale, smoothed[index].y / entry.scale));
    }
  };

  const hideWirePanel = (playSound = true) => {
    if (!wireTransition.visible) return;
    draggingWire = null;
    for (const node of wireNodes.values()) node.cursor = "grab";
    selectedWire = null;
    wireTransition.close();
    if (playSound) handlers.panelClosed();
  };
  wireBackdrop.on("pointertap", () => hideWirePanel());
  wirePlate.on("pointertap", (event) => event.stopPropagation());
  close.on("pointertap", () => hideWirePanel());
  wireOverlay.addChildAt(wireBackdrop, 0);
  wireOverlay.addChildAt(wirePlate, 1);
  wireOverlay.addChild(title, hint, close);
  const wirePanelContent = new Container();
  wirePanelContent.sortableChildren = true;
  wirePanelContent.pivot.set(480, 211);
  wirePanelContent.position.set(480, 211);
  wirePanelContent.scale.set(1.07);
  wirePanelContent.addChild(...wireOverlay.children.filter((child) => child !== wireBackdrop));
  wireOverlay.addChild(wirePanelContent);
  container.addChild(wireOverlay);
  const wireTransition = new PanelApertureTransition(wireOverlay);
  openWirePanel = () => {
    if (!handlers.canOpenWirePanel()) {
      handlers.inspect("wire_panel");
      return;
    }
    wireTransition.open();
    handlers.panelOpened();
    tooltip.visible = false;
    hint.text = "";
    selectedWire = null;
    renderWirePanel();
  };

  const sequencerOverlay = new Container();
  sequencerOverlay.zIndex = 2_100_000;
  sequencerOverlay.visible = false;
  sequencerOverlay.eventMode = "none";
  sequencerOverlay.hitArea = new Rectangle(0, 0, 960, 420);
  const sequencerPanelContent = new Container();
  sequencerPanelContent.pivot.set(480, 210);
  sequencerPanelContent.position.set(480, 210);
  sequencerPanelContent.scale.set(1.07);
  const sequencerBackdrop = new Graphics().rect(0, 0, 960, 420).fill({ color: 0x020304, alpha: 0.82 });
  sequencerBackdrop.eventMode = "static";
  const sequencerPlate = createPanelSurface(panelFrames.standard, 460, 320);
  sequencerPlate.position.set(250, 50);
  sequencerPlate.eventMode = "static";
  sequencerPlate.hitArea = new Rectangle(250, 50, 460, 320);
  const sequencerTitle = createPanelNameplate(panelNameplates.continuitySequencer, 350, 61, 180, 0.014);
  const sequencerStatus = panelText("", 10, 0x8f918c, "continuity-status");
  sequencerStatus.anchor.set(1, 1);
  sequencerStatus.position.set(681, 347);

  const ledNodes = Array.from({ length: 3 }, (_, index) => {
    const root = new Container();
    root.position.set(442 + index * 38, 108);
    const shadow = new Sprite(panelHardware.continuityLedOff);
    const glow = new Sprite(panelHardware.continuityLedOff);
    const sprite = new Sprite(panelHardware.continuityLedOff);
    const scale = 25 / panelHardware.continuityLedOff.width;
    shadow.anchor.set(0.5);
    shadow.position.set(1, 2);
    shadow.scale.set(scale);
    shadow.tint = 0x000000;
    shadow.alpha = 0.5;
    glow.anchor.set(0.5);
    glow.scale.set(scale * 1.12);
    glow.blendMode = "add";
    glow.filters = [new BlurFilter({ strength: 5, quality: 1 })];
    glow.alpha = 0;
    sprite.anchor.set(0.5);
    sprite.scale.set(scale);
    root.addChild(shadow, glow, sprite);
    sequencerOverlay.addChild(root);
    return { root, sprite, glow };
  });
  let sequencerErrorMs = 0;
  let dragCuePulseMs = 0;
  const drawLeds = (progress: number, error = false) => {
    ledNodes.forEach(({ sprite, glow }, index) => {
      const texture = error
        ? panelHardware.continuityLedRed
        : index < progress
          ? panelHardware.continuityLedGreen
          : panelHardware.continuityLedOff;
      sprite.texture = texture;
      glow.texture = texture;
      glow.alpha = error || index < progress ? 0.62 : 0;
    });
  };

  const gate = createHardwareSprite(panelHardware.continuityPath, 270, 3, 4);
  gate.position.set(480, 228);
  const gearPositions = {
    4: { x: 363, y: 176 },
    2: { x: 363, y: 280 },
    1: { x: 480, y: 176 },
    5: { x: 480, y: 280 },
    6: { x: 597, y: 176 },
    3: { x: 597, y: 280 }
  } as const;
  for (const [gear, position] of Object.entries(gearPositions)) {
    const label = panelText(gear, 15, 0xe2a348, `continuity-gear-${gear}`);
    label.anchor.set(0.5);
    const rowOffset = position.y < 228 ? -29 : 29;
    label.position.set(Math.round(position.x), Math.round(position.y + rowOffset));
    sequencerOverlay.addChild(label);
  }
  const neutral = { x: 480, y: 231 };
  const stick = new Container();
  stick.position.set(neutral.x, neutral.y);
  stick.eventMode = "static";
  stick.cursor = "grab";
  stick.hitArea = new Rectangle(-36, -36, 72, 72);
  const selectorHardware = createHardwareSprite(panelHardware.continuitySelector, 38, 5, 7, 0.76, 2.5);
  selectorHardware.eventMode = "none";
  const stickCue = createInteractionCue();
  stickCue.position.set(0, -25);
  stick.addChild(selectorHardware, stickCue);
  let sequencerOrder: ContinuitySequence = handlers.getState().wires.calibrationOrder;
  let sequencerProgress = 0;
  let draggingStick = false;
  let lastLatchedGear: number | null = null;

  const nearestGatePoint = (x: number, y: number) => {
    const project = (ax: number, ay: number, bx: number, by: number) => {
      const dx = bx - ax;
      const dy = by - ay;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
      const px = ax + dx * t;
      const py = ay + dy * t;
      return { x: px, y: py, distance: (x - px) ** 2 + (y - py) ** 2 };
    };
    const candidates = [
      project(363, 176, 363, 280),
      project(480, 176, 480, 280),
      project(597, 176, 597, 280),
      project(363, 231, 597, 231)
    ];
    return candidates.reduce((best, candidate) => candidate.distance < best.distance ? candidate : best);
  };
  const resetStick = () => {
    stick.position.set(neutral.x, neutral.y);
  };
  const latchGear = (gear: number) => {
    const expected = sequencerOrder[sequencerProgress];
    if (gear !== expected) {
      handlers.puzzleMistake("continuity sequencer");
      sequencerProgress = 0;
      sequencerErrorMs = 420;
      drawLeds(0, true);
      sequencerStatus.text = "WRONG CHANNEL. RELAY CHAIN RESET.";
      return;
    }
    handlers.buttonPress();
    sequencerProgress += 1;
    drawLeds(sequencerProgress);
    if (sequencerProgress === sequencerOrder.length) {
      const result = handlers.completeContinuitySequence();
      sequencerStatus.text = result.ok ? "" : (result.error ?? "SEQUENCE REJECTED.").toUpperCase();
    } else {
      sequencerStatus.text = "";
    }
  };
  const nearestGear = () => (Object.entries(gearPositions) as Array<[string, { x: number; y: number }]> )
    .map(([gear, position]) => ({ gear: Number(gear), distance: (stick.x - position.x) ** 2 + (stick.y - position.y) ** 2 }))
    .sort((a, b) => a.distance - b.distance)[0];
  const finishShift = () => {
    if (!draggingStick) return;
    const gearEntry = nearestGear();
    if (gearEntry && gearEntry.distance <= 34 ** 2 && gearEntry.gear !== lastLatchedGear && sequencerProgress < sequencerOrder.length) {
      latchGear(gearEntry.gear);
    }
    draggingStick = false;
    lastLatchedGear = null;
    stick.cursor = "grab";
    if (sequencerProgress < sequencerOrder.length && (!gearEntry || gearEntry.distance > 34 ** 2)) resetStick();
  };
  stick.on("pointerdown", (event) => {
    event.stopPropagation();
    if (sequencerProgress === sequencerOrder.length) return;
    stickCue.visible = false;
    draggingStick = true;
    lastLatchedGear = null;
    stick.cursor = "grabbing";
  });
  sequencerOverlay.on("globalpointermove", (event) => {
    if (!draggingStick) return;
    const point = sequencerPanelContent.toLocal(event.global);
    const projected = nearestGatePoint(point.x, point.y);
    stick.position.set(projected.x, projected.y);
    const gearEntry = nearestGear();
    if (!gearEntry || gearEntry.distance > 34 ** 2) {
      lastLatchedGear = null;
      return;
    }
    if (gearEntry.gear === lastLatchedGear || sequencerProgress === sequencerOrder.length) return;
    lastLatchedGear = gearEntry.gear;
    latchGear(gearEntry.gear);
  });
  sequencerOverlay.on("pointerup", finishShift);
  sequencerOverlay.on("pointerupoutside", finishShift);

  const sequencerBack = new Container();
  sequencerBack.position.set(650, 68);
  sequencerBack.eventMode = "static";
  sequencerBack.cursor = "pointer";
  sequencerBack.hitArea = new Rectangle(0, 0, 30, 30);
  sequencerBack.addChild(
    (() => {
      const node = panelText("X", 15, 0xe2a348, "continuity-close");
      node.anchor.set(0.5);
      node.position.set(15, 15);
      return node;
    })()
  );
  const closeSequencer = () => {
    if (!sequencerTransition.visible) return;
    draggingStick = false;
    lastLatchedGear = null;
    sequencerTransition.close();
    resetStick();
    handlers.panelClosed();
  };
  sequencerBackdrop.on("pointertap", closeSequencer);
  sequencerPlate.on("pointertap", (event) => event.stopPropagation());
  sequencerBack.on("pointertap", closeSequencer);
  sequencerOverlay.addChildAt(sequencerBackdrop, 0);
  sequencerOverlay.addChildAt(sequencerPlate, 1);
  sequencerOverlay.addChild(gate, stick, sequencerTitle, sequencerStatus, sequencerBack);
  sequencerPanelContent.addChild(...sequencerOverlay.children.filter((child) => child !== sequencerBackdrop));
  sequencerOverlay.addChild(sequencerPanelContent);
  container.addChild(sequencerOverlay);
  const sequencerTransition = new PanelApertureTransition(sequencerOverlay);
  openContinuityPanel = () => {
    if (handlers.getState().phase !== "wire_restore" && handlers.getMeasuredPorts().length !== ports.length) {
      handlers.inspect("continuity_switch");
      return;
    }
    wireTransition.hideImmediately();
    sequencerTransition.open();
    handlers.panelOpened();
    tooltip.visible = false;
    sequencerOrder = handlers.getState().wires.calibrationOrder;
    sequencerProgress = handlers.getMeasuredPorts().length === ports.length ? sequencerOrder.length : 0;
    drawLeds(sequencerProgress);
    sequencerStatus.text = "";
    resetStick();
    stickCue.visible = sequencerProgress < sequencerOrder.length;
  };
  drawLeds(0);

  const puzzleOverlays = createLevel1PuzzleOverlays({
    snapshot: handlers.getState,
    rotateJunction: handlers.rotateJunction,
    selectJunctionGlyph: handlers.selectJunctionGlyph,
    setRegulator: handlers.setRegulator,
    touchBreaker: handlers.touchBreaker,
    toggleBreaker: handlers.toggleBreaker,
    pullBreaker: handlers.pullBreaker,
    panelOpened: handlers.panelOpened,
    panelClosed: handlers.panelClosed
  }, panelFrames, panelNameplates, panelHardware);
  container.addChild(puzzleOverlays.container);
  container.addChild(mistakeSparks.container);
  openPuzzle = (id) => {
    if (handlers.getState().phase !== "spiral_repair") {
      handlers.inspect(id);
      return;
    }
    tooltip.visible = false;
    puzzleOverlays.open(id);
  };

  container.addChild(tooltip);
  container.sortChildren();
  syncZoneAvailability();

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Shift" || event.repeat) return;
    revealHeld = true;
    renderOutlines();
  };
  const onKeyUp = (event: KeyboardEvent) => {
    if (event.key !== "Shift") return;
    revealHeld = false;
    renderOutlines();
  };
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  return {
    container,
    resetView() {
      draggingWire = null;
      selectedWire = null;
      wireTransition.hideImmediately();
      sequencerTransition.hideImmediately();
      puzzleOverlays.close();
      container.eventMode = "auto";
      this.refresh();
    },
    mistakeBurst() {
      if (puzzleOverlays.mistakeBurst()) return;
      if (sequencerTransition.visible) {
        mistakeSparks.burst({ x: 255, y: 70, width: 450, height: 280 });
      } else if (wireTransition.visible) {
        mistakeSparks.burst({ x: 200, y: 75, width: 560, height: 270 });
      }
    },
    refresh() {
      syncZoneAvailability();
      renderWirePanel();
      puzzleOverlays.refresh();
    },
    update(deltaMs) {
      wireTransition.update(deltaMs);
      updateWireRopes(deltaMs);
      sequencerTransition.update(deltaMs);
      puzzleOverlays.update(deltaMs);
      mistakeSparks.update(deltaMs);
      dragCuePulseMs += deltaMs;
      if (stickCue.visible) {
        const pulse = (Math.sin(dragCuePulseMs / 420) + 1) / 2;
        stickCue.alpha = 1;
        stickCue.scale.set(1);
        stickCue.pulseBorder.alpha = 0.22 + pulse * 0.68;
        stickCue.pulseBorder.scale.set(1 + pulse * 0.055);
      }
      if (wireDragCue?.visible) {
        const pulse = (Math.sin(dragCuePulseMs / 420) + 1) / 2;
        wireDragCue.alpha = 1;
        wireDragCue.scale.set(1);
        wireDragCue.pulseBorder.alpha = 0.22 + pulse * 0.68;
        wireDragCue.pulseBorder.scale.set(1 + pulse * 0.055);
      }
      if (sequencerErrorMs > 0) {
        sequencerErrorMs = Math.max(0, sequencerErrorMs - deltaMs);
        if (sequencerErrorMs === 0) drawLeds(0);
      }
      for (const entry of shines) {
        if (!entry.active) continue;
        entry.progress = (entry.progress + deltaMs / 1050) % 1;
        entry.node.x = entry.zone.x - 80 + entry.progress * (entry.zone.width + 160);
      }
      const guidance = handlers.getGuidanceState();
      micBeacon.visible = guidance.busRestored && !guidance.micReseated;
      if (micBeacon.visible) {
        const pulse = (performance.now() % 900) / 900;
        const strength = 0.7 + Math.max(0, Math.sin(pulse * Math.PI * 2)) * 0.3;
        micBeacon.alpha = strength;
        micGlow.scale.set(0.9 + strength * 0.25);
      }
    },
    destroy() {
      if (closeTimer) clearTimeout(closeTimer);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      puzzleOverlays.destroy();
      mistakeSparks.destroy();
      container.destroy({ children: true });
    }
  };
}
