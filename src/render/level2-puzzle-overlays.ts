import { BitmapText, BlurFilter, Container, Graphics, MeshRope, NineSliceSprite, Point, Rectangle, Sprite, Texture } from "pixi.js";
import { UI_FONT } from "../fonts";
import type { Level2Action, Level2State, ThermalFeedId, ThermalSocketId, WaterSide } from "../sim/level2";
import { getIgnitionContactTime, getIgnitionTimingWindow, getPressureBand, getThermalMismatchCount, getWaterConnections, THERMAL_FEED_IDS, THERMAL_PORT_IDS, TEMPERATURE_SAFE_BAND } from "../sim/level2";
import { PanelApertureTransition } from "./panel-aperture-transition";
import { createHardwareSprite, createInteractionCue, createPanelNameplate, createPanelSurface, type PanelFrameTextures, type PanelNameplateTextures } from "./panel-nine-slice";
import { panelText } from "./panel-text";

export type Level2PuzzleId = "pressure" | "vents" | "water" | "ignition" | "pod";
export interface Level2PuzzleHandlers {
  snapshot(): Level2State; dispatch(action: Level2Action): void; panelOpened(): void;
  panelClosed(): void; controlStep(): void; interfaceClick(): void; buttonPress(): void;
  ignitionStarter(): void; pressureWheelMotion(intensity: number, deltaMs: number): void;
}
export interface Level2PuzzleOverlays {
  readonly container: Container; open(id: Level2PuzzleId): void; close(): void; refresh(): void;
  update(deltaMs: number): void; destroy(): void;
}
export interface Level2PanelHardwareTextures {
  pressureCrt: Texture;
  pressureWheel: Texture;
  thermalSocket: Texture;
  thermalDisconnected: Record<ThermalFeedId, Texture>;
  thermalConnected: Record<ThermalFeedId, Texture>;
  thermalLed: Record<ThermalFeedId, Texture>;
  thermalPipe: Record<ThermalFeedId, Texture>;
  waterStraightDry: readonly [Texture, Texture, Texture, Texture];
  waterStraightFlowing: readonly [Texture, Texture, Texture, Texture];
  waterElbowDry: readonly [Texture, Texture, Texture, Texture];
  waterElbowFlowing: readonly [Texture, Texture, Texture, Texture];
  waterStageCollar: Texture;
  waterGridTile: Texture;
  ignitionStarterSocket: Texture;
  ignitionStarterPlug: Texture;
  ignitionCable: Texture;
  podNumpad: Texture;
}
const text = (value: string, size = 13, fill = 0xc9c5ba) => new BitmapText({ text: value, style: { fontFamily: UI_FONT, fontSize: size, fill } });
const drawArrow = (graphics: Graphics, x: number, y: number, lane: number, color: number, alpha = 1) => {
  const angle = [Math.PI, -Math.PI / 2, Math.PI / 2, 0][lane] ?? 0;
  const cos = Math.cos(angle); const sin = Math.sin(angle);
  const points = [[12, 0], [1, -11], [1, -5], [-12, -5], [-12, 5], [1, 5], [1, 11]]
    .flatMap(([px, py]) => [x + px! * cos - py! * sin, y + px! * sin + py! * cos]);
  graphics.poly(points).fill({ color, alpha });
};

function shell(
  nameplateTexture: PanelNameplateTextures[keyof PanelNameplateTextures],
  placement: { x: number; y: number; width: number; rotation: number },
  frame: PanelFrameTextures[keyof PanelFrameTextures],
  close: () => void,
  layout: { x?: number; width?: number; height?: number } = {}
) {
  const bodyX = layout.x ?? 146;
  const bodyWidth = layout.width ?? 668;
  const bodyHeight = layout.height ?? 352;
  const root = new Container(); root.visible = false; root.eventMode = "none";
  const shade = new Graphics().rect(0, 0, 960, 420).fill({ color: 0x020304, alpha: 0.84 });
  shade.eventMode = "static"; shade.cursor = "pointer"; shade.on("pointertap", close);
  const body = new Container(); body.position.set(bodyX, 32); body.eventMode = "static";
  body.hitArea = new Rectangle(0, 0, bodyWidth, bodyHeight); body.on("pointertap", (event) => event.stopPropagation());
  body.addChild(createPanelSurface(frame, bodyWidth, bodyHeight));
  const heading = createPanelNameplate(nameplateTexture, placement.x, placement.y, placement.width, placement.rotation);
  const closeButton = new Container(); closeButton.position.set(bodyWidth - 52, 13); closeButton.eventMode = "static"; closeButton.cursor = "pointer";
  closeButton.hitArea = new Rectangle(0, 0, 30, 30);
  const closeGlyph = panelText("X", 15, 0xe2a348); closeGlyph.anchor.set(0.5); closeGlyph.position.set(15, 15);
  closeButton.addChild(closeGlyph); closeButton.on("pointertap", close);
  body.addChild(heading, closeButton); root.addChild(shade, body);
  return { root, body };
}

export function createLevel2PuzzleOverlays(
  handlers: Level2PuzzleHandlers,
  frames: PanelFrameTextures,
  nameplates: PanelNameplateTextures,
  hardware: Level2PanelHardwareTextures
): Level2PuzzleOverlays {
  const container = new Container(); container.zIndex = 2_100_000;
  let active: Level2PuzzleId | null = null;
  let activeTransition: PanelApertureTransition | null = null;
  let pulseMs = 0;
  const close = (sound = true) => {
    if (!activeTransition?.visible) return;
    const closing = active;
    activeTransition.close(); activeTransition = null; active = null;
    handlers.dispatch({ type: "SET_OVERLAY", open: false });
    if (closing === "ignition") handlers.dispatch({ type: "SET_IGNITION_PANEL", open: false });
    if (closing === "vents") {
      handlers.dispatch({ type: "SET_THERMAL_PANEL", open: false });
      activeThermalFeed = null;
    }
    if (sound) handlers.panelClosed();
  };

  const pressure = shell(nameplates.pressureControl, { x: 140, y: 45, width: 190, rotation: -0.012 }, frames.reinforced, () => close());
  const pressureWheel = new Container(); pressureWheel.position.set(250, 185);
  pressureWheel.eventMode = "static"; pressureWheel.cursor = "grab"; pressureWheel.hitArea = new Rectangle(-112, -112, 224, 224);
  // The shadow must not rotate off-axis with the wheel. The panel surface
  // already provides enough separation behind this large control.
  const pressureWheelArt = createHardwareSprite(hardware.pressureWheel, 224, 0, 0, 0);
  // The source canvas has extra transparent space below the wheel and its
  // painted bounds are slightly taller than wide. Correct both before rotation
  // so the visible rim is circular and its hub sits on the interaction pivot.
  pressureWheelArt.position.y = 6.25;
  // Pixel rounding is useful for stationary hardware, but makes a rotating
  // sprite jump between adjacent pixels as its transform changes.
  for (const child of pressureWheelArt.children) {
    if (child instanceof Sprite) {
      child.scale.y *= 0.9664;
      child.roundPixels = false;
    }
  }
  const pressureScope = { x: 436, y: 75, width: 104, height: 222 } as const;
  const pressureScopeCenterX = pressureScope.x + pressureScope.width / 2;
  const pressureScreenGlow = new Graphics()
    .roundRect(pressureScope.x - 2, pressureScope.y - 2, pressureScope.width + 4, pressureScope.height + 4, 7)
    .stroke({ color: 0x4f9a83, width: 4, alpha: 0.28 });
  pressureScreenGlow.blendMode = "add";
  pressureScreenGlow.filters = [new BlurFilter({ strength: 6, quality: 1 })];
  const pressureScreen = new Graphics()
    .roundRect(pressureScope.x, pressureScope.y, pressureScope.width, pressureScope.height, 5)
    .fill(0x0a1714);
  const pressureGuide = new Graphics()
    .moveTo(pressureScopeCenterX, pressureScope.y + 7)
    .lineTo(pressureScopeCenterX, pressureScope.y + pressureScope.height - 7)
    .stroke({ color: 0xc34e43, width: 2, alpha: 0.82 });
  const pressureScaleGlow = new Graphics();
  const pressureScale = new Graphics();
  for (let tick = 0; tick <= 10; tick += 1) {
    const tickY = pressureScope.y + 8 + (pressureScope.height - 16) * tick / 10;
    const halfWidth = tick % 5 === 0 ? 15 : tick % 2 === 0 ? 10 : 7;
    pressureScale
      .moveTo(pressureScopeCenterX - halfWidth, tickY)
      .lineTo(pressureScopeCenterX + halfWidth, tickY);
    pressureScaleGlow
      .moveTo(pressureScopeCenterX - halfWidth - 1, tickY)
      .lineTo(pressureScopeCenterX + halfWidth + 1, tickY);
  }
  pressureScale.stroke({ color: 0xcf5a4c, width: 1, alpha: 0.8 });
  pressureScaleGlow.stroke({ color: 0xc34e43, width: 3, alpha: 0.18 });
  pressureScaleGlow.blendMode = "add";
  pressureScaleGlow.filters = [new BlurFilter({ strength: 3, quality: 1 })];
  const pressureGaugeGlow = new Graphics();
  pressureGaugeGlow.blendMode = "add";
  pressureGaugeGlow.filters = [new BlurFilter({ strength: 5, quality: 1 })];
  const pressureGauge = new Graphics();
  const pressureScanlines = new Graphics();
  for (let y = pressureScope.y + 3; y < pressureScope.y + pressureScope.height - 2; y += 4) {
    pressureScanlines.moveTo(pressureScope.x + 4, y).lineTo(pressureScope.x + pressureScope.width - 4, y);
  }
  pressureScanlines.stroke({ color: 0x000000, width: 1, alpha: 0.38 });
  const pressureVignette = new Graphics()
    .roundRect(pressureScope.x + 2, pressureScope.y + 2, pressureScope.width - 4, pressureScope.height - 4, 4)
    .stroke({ color: 0x000000, width: 5, alpha: 0.3 });
  const pressureCrt = new NineSliceSprite({
    texture: hardware.pressureCrt,
    leftWidth: 120,
    topHeight: 90,
    rightWidth: 120,
    bottomHeight: 90,
    width: 1445,
    height: 280
  });
  pressureCrt.width = 780; pressureCrt.height = 1360;
  pressureCrt.position.set(410, 50); pressureCrt.scale.set(0.2); pressureCrt.roundPixels = true;
  const wheelCue = createInteractionCue("GRAB AND CRANK"); wheelCue.position.set(250, 318);
  pressureWheel.addChild(pressureWheelArt);
  pressure.body.addChild(
    pressureScreenGlow,
    pressureScreen,
    pressureGuide,
    pressureScaleGlow,
    pressureScale,
    pressureGaugeGlow,
    pressureGauge,
    pressureScanlines,
    pressureVignette,
    pressureCrt,
    pressureWheel,
    wheelCue
  );
  let wheelDragAngle: number | null = null;
  let wheelVisualAngle = 0;
  let wheelVelocity = 0;
  let wheelLastMotionAt = -Infinity;
  let pressureNeedle = handlers.snapshot().pressure;
  let pressureNeedleVelocity = 0;
  let temperatureNeedle = handlers.snapshot().temperature;
  let temperatureNeedleVelocity = 0;
  const angleAt = (event: { global: { x: number; y: number } }) => {
    const center = pressureWheel.toGlobal({ x: 0, y: 0 });
    return Math.atan2(event.global.y - center.y, event.global.x - center.x);
  };
  pressureWheel.on("pointerdown", (event) => { wheelDragAngle = angleAt(event); wheelVelocity *= 0.25; pressureWheel.cursor = "grabbing"; });
  const moveWheel = (event: { global: { x: number; y: number } }) => {
    if (wheelDragAngle === null) return;
    const next = angleAt(event);
    let delta = next - wheelDragAngle;
    if (delta > Math.PI) delta -= Math.PI * 2;
    if (delta < -Math.PI) delta += Math.PI * 2;
    if (Math.abs(delta) < 0.015) return;
    wheelVisualAngle += delta;
    wheelVelocity = wheelVelocity * 0.32 + delta * 18;
    wheelLastMotionAt = performance.now();
    handlers.dispatch({ type: "CRANK_PRESSURE", amount: delta * 5.8 });
    wheelDragAngle = next;
  };
  pressure.root.eventMode = "static";
  pressure.root.on("globalpointermove", moveWheel);
  const endWheelDrag = () => { wheelDragAngle = null; pressureWheel.cursor = "grab"; };
  pressureWheel.on("pointerup", endWheelDrag); pressureWheel.on("pointerupoutside", endWheelDrag);
  pressure.root.on("pointerup", endWheelDrag); pressure.root.on("pointerupoutside", endWheelDrag);

  const vents = shell(nameplates.thermalCoupling, { x: 128, y: 18, width: 215, rotation: 0.011 }, frames.sealed, () => close());
  const tempScope = { x: 68, y: 51, width: 532, height: 48 } as const;
  const tempScreenGlow = new Graphics()
    .roundRect(tempScope.x - 2, tempScope.y - 2, tempScope.width + 4, tempScope.height + 4, 5)
    .stroke({ color: 0x4f9a83, width: 4, alpha: 0.28 });
  tempScreenGlow.blendMode = "add";
  tempScreenGlow.filters = [new BlurFilter({ strength: 5, quality: 1 })];
  const tempScreen = new Graphics()
    .roundRect(tempScope.x, tempScope.y, tempScope.width, tempScope.height, 4)
    .fill(0x0a1714);
  const tempScale = new Graphics();
  for (let tick = 0; tick <= 10; tick += 1) {
    const tickX = tempScope.x + 8 + (tempScope.width - 16) * tick / 10;
    const tickHeight = tick % 5 === 0 ? 12 : tick % 2 === 0 ? 8 : 5;
    tempScale.moveTo(tickX, tempScope.y + tempScope.height - 6).lineTo(tickX, tempScope.y + tempScope.height - 6 - tickHeight);
  }
  tempScale.stroke({ color: 0xc34e43, width: 1, alpha: 0.72 });
  const tempGaugeGlow = new Graphics();
  tempGaugeGlow.blendMode = "add";
  tempGaugeGlow.filters = [new BlurFilter({ strength: 5, quality: 1 })];
  const tempInstrument = new Graphics();
  const tempScanlines = new Graphics();
  for (let y = tempScope.y + 3; y < tempScope.y + tempScope.height - 2; y += 4) {
    tempScanlines.moveTo(tempScope.x + 4, y).lineTo(tempScope.x + tempScope.width - 4, y);
  }
  tempScanlines.stroke({ color: 0x000000, width: 1, alpha: 0.38 });
  const tempCrt = new NineSliceSprite({
    texture: hardware.pressureCrt,
    leftWidth: 120,
    topHeight: 90,
    rightWidth: 120,
    bottomHeight: 90,
    width: 2800,
    height: 380
  });
  tempCrt.position.set(54, 38); tempCrt.scale.set(0.2); tempCrt.roundPixels = true;
  const thermalHardware = new Graphics();
  const thermalFixtureLayer = new Container();
  const thermalCableLayer = new Container();
  const feedY = [140, 197, 254, 311] as const;
  const feedX = 84;
  const portX = 570;
  const socketPositions: Record<ThermalSocketId, { x: number; y: number }> = {
    port_0: { x: portX, y: feedY[0] }, port_1: { x: portX, y: feedY[1] },
    port_2: { x: portX, y: feedY[2] }, port_3: { x: portX, y: feedY[3] }
  };
  const socketViews = THERMAL_PORT_IDS.map((port, index) => {
    const sprite = new Sprite(hardware.thermalSocket);
    sprite.anchor.set(0.5);
    sprite.scale.set(46 / hardware.thermalSocket.width);
    sprite.position.set(socketPositions[port].x, socketPositions[port].y);
    sprite.roundPixels = true;
    thermalFixtureLayer.addChild(sprite);
    return { port, index, sprite };
  });
  const ledViews = THERMAL_PORT_IDS.map((port, index) => {
    const initial = THERMAL_FEED_IDS[index];
    const sprite = new Sprite(hardware.thermalLed[initial]);
    sprite.anchor.set(0.5);
    sprite.scale.set(31 / hardware.thermalLed[initial].width);
    sprite.position.set(623, feedY[index]);
    sprite.roundPixels = true;
    thermalFixtureLayer.addChild(sprite);
    return { port, index, sprite };
  });
  let activeThermalFeed: ThermalFeedId | null = null;
  let thermalDragPoint = { x: 160, y: 180 };
  const parkedThermalPositions = Object.fromEntries(
    THERMAL_FEED_IDS.map((feed, index) => [feed, { x: 154, y: feedY[index] }])
  ) as Record<ThermalFeedId, { x: number; y: number }>;
  let lastThermalCycle = handlers.snapshot().thermal.cycle;
  let thermalFlickerMs = 0;
  const cableViews = THERMAL_FEED_IDS.map((feed, index) => {
    const plug = new Container(); plug.eventMode = "static"; plug.cursor = "grab"; plug.hitArea = new Rectangle(-35, -22, 70, 44);
    const plugShadow = new Sprite(hardware.thermalDisconnected[feed]);
    plugShadow.anchor.set(0.82, 0.5); plugShadow.tint = 0x000000; plugShadow.alpha = 0.48; plugShadow.position.set(2, 3);
    const plugArt = new Sprite(hardware.thermalDisconnected[feed]);
    plugArt.anchor.set(0.82, 0.5);
    plug.addChild(plugShadow, plugArt);
    const points = Array.from({ length: 18 }, (_, pointIndex) => ({
      x: feedX + pointIndex * 28,
      y: feedY[index] + Math.sin(pointIndex / 17 * Math.PI) * 14,
      px: feedX + pointIndex * 28,
      py: feedY[index] + Math.sin(pointIndex / 17 * Math.PI) * 14
    }));
    const pipeScale = 16 / hardware.thermalPipe[feed].height;
    const meshPoints = points.map((point) => new Point(point.x / pipeScale, point.y / pipeScale));
    const cable = new MeshRope({ texture: hardware.thermalPipe[feed], points: meshPoints, textureScale: 0 });
    cable.scale.set(pipeScale);
    cable.eventMode = "none";
    cable.roundPixels = true;
    plug.on("pointerdown", (event) => {
      handlers.dispatch({ type: "PICK_UP_THERMAL_PLUG", feed });
      if (handlers.snapshot().thermal.held !== feed) return;
      activeThermalFeed = feed; plug.cursor = "grabbing";
      thermalDragPoint = vents.body.toLocal(event.global);
    });
    thermalCableLayer.addChild(cable, plug);
    return { feed, index, cable, plug, plugShadow, plugArt, points, meshPoints, pipeScale };
  });
  const moveThermalPlug = (event: { global: { x: number; y: number } }) => {
    if (!activeThermalFeed) return;
    const point = vents.body.toLocal(event.global);
    thermalDragPoint = { x: Math.max(104, Math.min(624, point.x)), y: Math.max(122, Math.min(320, point.y)) };
  };
  const releaseThermalPlug = () => {
    if (!activeThermalFeed) return;
    const releasedFeed = activeThermalFeed;
    const state = handlers.snapshot();
    let closest: ThermalSocketId | null = null;
    let closestDistance = 24;
    for (const socket of THERMAL_PORT_IDS) {
      const target = socketPositions[socket];
      const distance = Math.hypot(thermalDragPoint.x - target.x, thermalDragPoint.y - target.y);
      const occupied = THERMAL_FEED_IDS.some((feed) => state.thermal.connections[feed] === socket);
      if (!occupied && distance < closestDistance) { closest = socket; closestDistance = distance; }
    }
    if (!closest) parkedThermalPositions[releasedFeed] = { ...thermalDragPoint };
    handlers.dispatch(closest ? { type: "SEAT_THERMAL_PLUG", socket: closest } : { type: "DROP_THERMAL_PLUG" });
    if (closest) handlers.buttonPress();
    const view = cableViews.find((candidate) => candidate.feed === releasedFeed);
    if (view) view.plug.cursor = "grab";
    activeThermalFeed = null;
  };
  vents.root.eventMode = "static";
  vents.root.on("globalpointermove", moveThermalPlug);
  vents.root.on("pointerup", releaseThermalPlug); vents.root.on("pointerupoutside", releaseThermalPlug);
  vents.body.addChild(
    tempScreenGlow,
    tempScreen,
    tempScale,
    tempGaugeGlow,
    tempInstrument,
    tempScanlines,
    tempCrt,
    thermalFixtureLayer,
    thermalCableLayer,
    thermalHardware
  );

  const ignition = shell(nameplates.ignitionSequencer, { x: 132, y: 12, width: 225, rotation: -0.008 }, frames.standard, () => close());
  const ignitionScreenGlow = new Graphics()
    .roundRect(48, 50, 534, 268, 4)
    .fill({ color: 0x163c3b, alpha: 0.24 });
  ignitionScreenGlow.blendMode = "add";
  ignitionScreenGlow.filters = [new BlurFilter({ strength: 7, quality: 1 })];
  const ignitionScreen = new Graphics()
    .roundRect(48, 50, 534, 268, 4)
    .fill({ color: 0x071112, alpha: 0.98 })
    .stroke({ color: 0xc08a3d, width: 2, alpha: 0.78 });
  const ignitionFieldGlow = new Graphics();
  ignitionFieldGlow.blendMode = "add";
  ignitionFieldGlow.filters = [new BlurFilter({ strength: 5, quality: 1 })];
  const ignitionField = new Graphics();
  const ignitionNotesGlow = new Graphics();
  ignitionNotesGlow.blendMode = "add";
  ignitionNotesGlow.filters = [new BlurFilter({ strength: 4, quality: 1 })];
  const ignitionNotes = new Graphics();
  const ignitionScanlines = new Graphics();
  for (let y = 55; y < 314; y += 4) ignitionScanlines.moveTo(53, y).lineTo(577, y);
  ignitionScanlines.stroke({ color: 0x000000, width: 1, alpha: 0.34 });
  const ignitionVignette = new Graphics()
    .roundRect(51, 53, 528, 262, 4)
    .stroke({ color: 0x000000, width: 7, alpha: 0.32 });
  const ignitionCountdown = text("3", 48, 0xf0b552);
  ignitionCountdown.anchor.set(0.5); ignitionCountdown.position.set(315, 174);
  const starterAnchor = { x: 620, y: 72 };
  const starterRest = { x: 620, y: 122 };
  const starterHousing = new Sprite(hardware.ignitionStarterSocket);
  starterHousing.anchor.set(0.5); starterHousing.position.set(starterAnchor.x, starterAnchor.y);
  starterHousing.scale.set(46 / hardware.ignitionStarterSocket.width); starterHousing.roundPixels = true;
  const starter = new Container(); starter.eventMode = "static"; starter.cursor = "grab"; starter.hitArea = new Rectangle(-26, -5, 52, 72);
  const starterArt = new Sprite(hardware.ignitionStarterPlug);
  starterArt.anchor.set(0.5, 0.05); starterArt.scale.set(58 / hardware.ignitionStarterPlug.height); starterArt.roundPixels = true;
  starter.addChild(starterArt);
  const ropePoints = Array.from({ length: 10 }, (_, index) => {
    const y = starterAnchor.y + index * ((starterRest.y - starterAnchor.y) / 9);
    return { x: starterAnchor.x, y, px: starterAnchor.x, py: y };
  });
  const starterCableScale = 9 / hardware.ignitionCable.height;
  const starterCableMeshPoints = ropePoints.map((point) => new Point(point.x / starterCableScale, point.y / starterCableScale));
  const starterCable = new MeshRope({ texture: hardware.ignitionCable, points: starterCableMeshPoints, textureScale: 0 });
  starterCable.scale.set(starterCableScale); starterCable.roundPixels = true; starterCable.eventMode = "none";
  const starterCallout = new Container();
  starterCallout.position.set(620, 195);
  const starterCalloutLabel = text("DRAG +\nPULL DOWN", 10, 0xd7a54c);
  starterCalloutLabel.anchor.set(0.5, 0);
  const starterCalloutArrow = new Graphics()
    .moveTo(0, 28).lineTo(0, 43)
    .moveTo(-4, 38).lineTo(0, 43).lineTo(4, 38)
    .stroke({ color: 0xd7a54c, width: 1.5, alpha: 0.72 });
  starterCallout.addChild(starterCalloutLabel, starterCalloutArrow);
  let ignitionHitFlashMs = 0;
  let ignitionMissFlashMs = 0;
  const ignitionTargetFeedback: Array<{ kind: "hit" | "miss" | null; ms: number }> = Array.from({ length: 4 }, () => ({ kind: null, ms: 0 }));
  let ignitionPreviousResults = [...handlers.snapshot().ignition.results];
  let ignitionHitCount = handlers.snapshot().ignition.results.filter((result) => result === "hit").length;
  let ignitionMissCount = handlers.snapshot().ignition.results.filter((result) => result === "miss").length;
  let starterDragging = false;
  let starterLastX = 0;
  let starterLastY = 0;
  let starterLastMs = 0;
  let starterPullStartMs = 0;
  let starterPeakSpeed = 0;
  let starterPeakExtension = 0;
  starter.on("pointerdown", (event) => {
    starterDragging = true;
    starter.cursor = "grabbing";
    starterLastX = event.global.x;
    starterLastY = event.global.y;
    starterLastMs = performance.now();
    starterPullStartMs = starterLastMs;
    starterPeakSpeed = 0;
    starterPeakExtension = 0;
  });
  const moveStarter = (event: { global: { x: number; y: number } }) => {
    if (!starterDragging) return;
    const point = ignition.body.toLocal(event.global);
    const now = performance.now();
    starterPeakSpeed = Math.max(starterPeakSpeed, Math.hypot(event.global.x - starterLastX, event.global.y - starterLastY) / Math.max(1, now - starterLastMs) * 1000);
    starterLastX = event.global.x; starterLastY = event.global.y; starterLastMs = now;
    const tail = ropePoints.at(-1)!;
    tail.x = Math.max(starterAnchor.x - 28, Math.min(starterAnchor.x + 28, point.x));
    tail.y = Math.max(starterRest.y, Math.min(286, point.y));
    starterPeakExtension = Math.max(starterPeakExtension, tail.y - starterRest.y);
  };
  const releaseStarter = () => {
    if (starterDragging && starterPeakExtension >= 40) {
      const elapsedMs = Math.max(1, performance.now() - starterPullStartMs);
      const distanceSpeed = starterPeakExtension / elapsedMs * 1000;
      const wasRunning = handlers.snapshot().ignition.running;
      handlers.dispatch({ type: "START_IGNITION", pullSpeed: Math.max(starterPeakSpeed, distanceSpeed) });
      if (!wasRunning && handlers.snapshot().ignition.running) handlers.ignitionStarter();
    }
    starterDragging = false; starter.cursor = "grab";
  };
  starter.on("globalpointermove", moveStarter);
  starter.on("pointerup", releaseStarter);
  starter.on("pointerupoutside", releaseStarter);
  ignition.body.addChild(
    ignitionScreenGlow,
    ignitionScreen,
    ignitionFieldGlow,
    ignitionField,
    ignitionNotesGlow,
    ignitionNotes,
    ignitionScanlines,
    ignitionVignette,
    ignitionCountdown,
    starterHousing,
    starterCable,
    starter,
    starterCallout
  );

  const water = shell(nameplates.waterReclamation, { x: 130, y: 18, width: 220, rotation: 0.012 }, frames.reinforced, () => close());
  const tileSize = 58; const boardX = 218; const boardY = 66;
  const waterGridTiles = Array.from({ length: 16 }, (_, index) => {
    const tile = new Sprite(hardware.waterGridTile);
    tile.position.set(boardX + (index % 4) * tileSize, boardY + Math.floor(index / 4) * tileSize);
    tile.width = tileSize; tile.height = tileSize; tile.roundPixels = true;
    tile.alpha = 0.32;
    water.body.addChild(tile);
    return tile;
  });
  const pipeViews = Array.from({ length: 16 }, (_, index) => {
    const column = index % 4; const row = Math.floor(index / 4);
    const root = new Container(); root.position.set(boardX + column * tileSize, boardY + row * tileSize);
    root.eventMode = "static"; root.cursor = "pointer"; root.hitArea = new Rectangle(0, 0, tileSize, tileSize);
    const art = new Sprite(hardware.waterStraightDry[0]);
    art.anchor.set(0.5); art.position.set(tileSize / 2, tileSize / 2); art.roundPixels = true;
    const pipeMask = new Graphics();
    art.mask = pipeMask;
    const stageCollar = new Sprite(hardware.waterStageCollar);
    stageCollar.anchor.set(0.5); stageCollar.position.set(tileSize / 2, tileSize / 2);
    stageCollar.scale.set(27 / hardware.waterStageCollar.width); stageCollar.roundPixels = true;
    const letter = text("", 12, 0xe9dfc7); letter.anchor.set(0.5); letter.position.set(tileSize / 2, tileSize / 2);
    root.addChild(art, pipeMask, stageCollar, letter); root.on("pointertap", () => {
      const tile = handlers.snapshot().water.tiles[index];
      if (tile && tile.kind !== "blocked" && tile.kind !== "empty") handlers.interfaceClick();
      handlers.dispatch({ type: "ROTATE_PIPE", index });
    }); water.body.addChild(root);
    return { root, art, pipeMask, stageCollar, letter, index, column, row };
  });
  const inlet = new Sprite(hardware.waterStraightFlowing[0]);
  inlet.anchor.set(1, 0.5); inlet.position.set(boardX, boardY + tileSize * 1.5 + 5);
  inlet.scale.set(tileSize / 240); inlet.roundPixels = true;
  const outlet = new Sprite(hardware.waterStraightDry[1]);
  outlet.anchor.set(0, 0.5); outlet.position.set(boardX + tileSize * 4, boardY + tileSize * 3.5 - 6);
  outlet.scale.set(tileSize / 240); outlet.roundPixels = true;
  // The source crops are optically offset inside their square frames. These
  // are the painted pipe centerlines, not the sprite pivot positions above.
  const inletCenterY = boardY + tileSize * 1.5;
  const outletCenterY = boardY + tileSize * 3.5;
  const inletMask = new Graphics()
    .rect(boardX - tileSize, inletCenterY - 22, tileSize, 44)
    .fill(0xffffff);
  const outletMask = new Graphics()
    .rect(boardX + tileSize * 4, outletCenterY - 22, tileSize, 44)
    .fill(0xffffff);
  inlet.mask = inletMask; outlet.mask = outletMask;
  const terminalFramePositions = [
    [boardX - tileSize, inletCenterY],
    [boardX + tileSize * 5, outletCenterY]
  ] as const;
  const voidCanvas = document.createElement("canvas");
  voidCanvas.width = 128; voidCanvas.height = 128;
  const voidContext = voidCanvas.getContext("2d");
  if (!voidContext) throw new Error("Unable to create water terminal gradient");
  const voidGradient = voidContext.createRadialGradient(64, 64, 4, 64, 64, 62);
  voidGradient.addColorStop(0, "rgba(0, 1, 2, 0.98)");
  voidGradient.addColorStop(0.42, "rgba(0, 2, 3, 0.94)");
  voidGradient.addColorStop(0.7, "rgba(2, 7, 8, 0.68)");
  voidGradient.addColorStop(0.88, "rgba(3, 10, 11, 0.24)");
  voidGradient.addColorStop(1, "rgba(3, 10, 11, 0)");
  voidContext.fillStyle = voidGradient;
  voidContext.fillRect(0, 0, 128, 128);
  const terminalVoidTexture = Texture.from(voidCanvas);
  const terminalVoids = terminalFramePositions.map(([x, y]) => {
    const terminalVoid = new Sprite(terminalVoidTexture);
    terminalVoid.anchor.set(0.5); terminalVoid.position.set(x, y);
    terminalVoid.width = 74; terminalVoid.height = 74;
    return terminalVoid;
  });
  const flowArrowShadow = new Graphics();
  const flowArrows = new Graphics();
  const inletArrowX = boardX - tileSize - 34;
  const inletArrowY = inletCenterY;
  const outletArrowX = boardX + tileSize * 5 + 34;
  const outletArrowY = outletCenterY;
  const drawFlowArrows = (graphics: Graphics) => graphics
    .moveTo(inletArrowX - 8, inletArrowY)
    .lineTo(inletArrowX + 11, inletArrowY)
    .moveTo(inletArrowX + 11, inletArrowY)
    .lineTo(inletArrowX + 5, inletArrowY - 5)
    .moveTo(inletArrowX + 11, inletArrowY)
    .lineTo(inletArrowX + 5, inletArrowY + 5)
    .moveTo(outletArrowX - 10, outletArrowY)
    .lineTo(outletArrowX + 9, outletArrowY)
    .moveTo(outletArrowX + 9, outletArrowY)
    .lineTo(outletArrowX + 3, outletArrowY - 5)
    .moveTo(outletArrowX + 9, outletArrowY)
    .lineTo(outletArrowX + 3, outletArrowY + 5);
  drawFlowArrows(flowArrowShadow).stroke({ color: 0x020303, width: 3.5, alpha: 0.38 });
  drawFlowArrows(flowArrows).stroke({ color: 0xe1b45a, width: 1.75, alpha: 0.34 });
  // Fade the pipe mouth into the void. The gradient intentionally renders over
  // the pipe art; unlike the former frame, it has no visible rectangular edge.
  water.body.addChild(inlet, inletMask, outlet, outletMask, ...terminalVoids, flowArrowShadow, flowArrows);

  const pod = shell(
    nameplates.transferPod,
    { x: 22, y: 20, width: 185, rotation: -0.014 },
    frames.standard,
    () => close(),
    { x: 300, width: 360 }
  );
  const podCrtGlow = new Graphics()
    .roundRect(100, 61, 160, 39, 4)
    .fill({ color: 0x2b6b61, alpha: 0.34 });
  podCrtGlow.blendMode = "add";
  podCrtGlow.filters = [new BlurFilter({ strength: 8, quality: 1 })];
  const podCrt = new Graphics()
    .roundRect(100, 61, 160, 39, 4)
    .fill({ color: 0x061313, alpha: 0.98 });
  const podPhosphor = new Graphics()
    .roundRect(106, 67, 148, 27, 7)
    .fill({ color: 0x3a8b78, alpha: 0.1 });
  podPhosphor.blendMode = "add";
  const podScanlines = new Graphics();
  for (let y = 64; y < 98; y += 2) podScanlines.moveTo(103, y).lineTo(257, y);
  podScanlines.stroke({ color: 0x000000, width: 1, alpha: 0.5 });
  const podDisplayGlow = text("------", 25, 0xf0b44c);
  podDisplayGlow.anchor.set(0.5); podDisplayGlow.position.set(180, 83);
  podDisplayGlow.alpha = 0.55;
  podDisplayGlow.blendMode = "add";
  podDisplayGlow.filters = [new BlurFilter({ strength: 3, quality: 1 })];
  const podDisplay = text("------", 25, 0xe2a348);
  podDisplay.anchor.set(0.5); podDisplay.position.set(180, 83);
  const podSuccessCheckGlow = new Graphics()
    .moveTo(163, 83).lineTo(175, 92).lineTo(198, 70)
    .stroke({ color: 0x6ee37b, width: 8, alpha: 0.38 });
  podSuccessCheckGlow.blendMode = "add";
  podSuccessCheckGlow.filters = [new BlurFilter({ strength: 5, quality: 1 })];
  const podSuccessCheck = new Graphics()
    .moveTo(163, 83).lineTo(175, 92).lineTo(198, 70)
    .stroke({ color: 0x79db77, width: 4, alpha: 0.98 });
  podSuccessCheck.visible = false;
  podSuccessCheckGlow.visible = false;
  const podNumpad = new Sprite(hardware.podNumpad);
  podNumpad.position.set(100, 100); podNumpad.width = 160; podNumpad.height = 220; podNumpad.alpha = 0.72; podNumpad.roundPixels = true;
  pod.body.addChild(podCrtGlow, podCrt, podPhosphor, podScanlines, podDisplayGlow, podDisplay, podSuccessCheckGlow, podSuccessCheck, podNumpad);
  const keyColumns = [140, 180, 221];
  const keyRows = [143, 187, 231, 275];
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "DEL", "0", "ENTER"].forEach((digit, index) => {
    const key = new Container(); key.position.set(keyColumns[index % 3]!, keyRows[Math.floor(index / 3)]!);
    key.eventMode = "static"; key.cursor = "pointer"; key.hitArea = new Rectangle(-21, -20, 42, 40);
    const caption = text(digit, digit.length > 1 ? 10 : 18, 0xf0b44c); caption.anchor.set(0.5); key.addChild(caption);
    key.on("pointerdown", () => { caption.y = 2; caption.tint = 0xffd079; });
    key.on("pointerup", () => { caption.y = 0; caption.tint = 0xffffff; });
    key.on("pointerupoutside", () => { caption.y = 0; caption.tint = 0xffffff; });
    key.on("pointertap", () => {
      handlers.interfaceClick();
      if (digit === "DEL") handlers.dispatch({ type: "POD_BACKSPACE" });
      else if (digit === "ENTER") handlers.dispatch({ type: "SUBMIT_POD_CODE" });
      else handlers.dispatch({ type: "POD_DIGIT", digit });
    });
    pod.body.addChild(key);
  });

  const panels = { pressure, vents, water, ignition, pod };
  const transitions = Object.fromEntries(Object.entries(panels).map(([id, panel]) => [id, new PanelApertureTransition(panel.root)])) as Record<Level2PuzzleId, PanelApertureTransition>;
  container.addChild(pressure.root, vents.root, water.root, ignition.root, pod.root);

  const drawPressureGauge = (value: number, band: { min: number; max: number }) => {
    pressureGauge.clear();
    pressureGaugeGlow.clear();
    const inset = 8;
    const y = pressureScope.y + inset;
    const height = pressureScope.height - inset * 2;
    const bandY = y + height * (1 - band.max / 100);
    const bandHeight = height * (band.max - band.min) / 100;
    const needleY = y + height * (1 - value / 100);

    pressureGauge
      .roundRect(pressureScope.x + 5, bandY, pressureScope.width - 10, bandHeight, 3)
      .fill({ color: 0x68bd62, alpha: 0.34 })
      .stroke({ color: 0x68bd62, width: 1, alpha: 0.78 })
      .rect(pressureScope.x + 3, needleY - 2, pressureScope.width - 6, 5)
      .fill({ color: 0xe2a348, alpha: 0.96 });
    pressureGaugeGlow
      .roundRect(pressureScope.x + 6, bandY + 1, pressureScope.width - 12, Math.max(2, bandHeight - 2), 3)
      .fill({ color: 0x68bd62, alpha: 0.16 })
      .rect(pressureScope.x + 3, needleY - 3, pressureScope.width - 6, 7)
      .fill({ color: 0xe2a348, alpha: 0.48 });
  };

  const refresh = () => {
    const state = handlers.snapshot();
    pressureWheel.rotation = wheelVisualAngle;
    const pressureBand = getPressureBand(state);
    drawPressureGauge(pressureNeedle, pressureBand);

    tempInstrument.clear();
    tempGaugeGlow.clear();
    const tempInset = 8;
    const tempX = tempScope.x + tempInset;
    const tempWidth = tempScope.width - tempInset * 2;
    const safeX = tempX + tempWidth * TEMPERATURE_SAFE_BAND.min / 100;
    const safeWidth = tempWidth * (TEMPERATURE_SAFE_BAND.max - TEMPERATURE_SAFE_BAND.min) / 100;
    const needleX = tempX + tempWidth * temperatureNeedle / 100;
    tempInstrument
      .roundRect(safeX, tempScope.y + 8, safeWidth, tempScope.height - 16, 3)
      .fill({ color: 0x68bd62, alpha: 0.34 })
      .stroke({ color: 0x68bd62, width: 1, alpha: 0.78 })
      .rect(needleX - 2, tempScope.y + 5, 5, tempScope.height - 10)
      .fill({ color: 0xe2a348, alpha: 0.96 });
    tempGaugeGlow
      .roundRect(safeX + 1, tempScope.y + 9, Math.max(2, safeWidth - 2), tempScope.height - 18, 3)
      .fill({ color: 0x68bd62, alpha: 0.16 })
      .rect(needleX - 3, tempScope.y + 4, 7, tempScope.height - 8)
      .fill({ color: 0xe2a348, alpha: 0.48 });
    thermalHardware.clear();
    const mismatchCount = getThermalMismatchCount(state);
    if (state.thermal.cycle !== lastThermalCycle) {
      lastThermalCycle = state.thermal.cycle;
      thermalFlickerMs = 520;
    }
    THERMAL_FEED_IDS.forEach((_feed, index) => {
      const y = feedY[index];
      for (let step = 0; step < 11; step += 1) {
        const radius = 19 - step * 1.55;
        thermalHardware.circle(feedX, y, radius).fill({ color: 0x010304, alpha: 0.04 + step * 0.072 });
      }
    });
    THERMAL_PORT_IDS.forEach((port, index) => {
      const wanted = state.thermal.portAssignments[index];
      const occupant = THERMAL_FEED_IDS.find((feed) => state.thermal.connections[feed] === port);
      const matched = occupant === wanted;
      const affected = state.thermal.lastSwap?.includes(index) ?? false;
      const flicker = affected && thermalFlickerMs > 0 ? 0.25 + Math.abs(Math.sin(thermalFlickerMs * 0.055)) * 0.75 : 1;
      const socketView = socketViews[index]!;
      socketView.sprite.visible = !occupant;
      const ledView = ledViews[index]!;
      ledView.sprite.texture = hardware.thermalLed[wanted];
      ledView.sprite.scale.set(31 / ledView.sprite.texture.width);
      ledView.sprite.alpha = (matched ? 1 : 0.42) * flicker;
    });
    thermalCableLayer.alpha = 1 - mismatchCount * 0.07;
    cableViews.forEach((view) => {
      const connected = Boolean(state.thermal.connections[view.feed]);
      const texture = connected ? hardware.thermalConnected[view.feed] : hardware.thermalDisconnected[view.feed];
      const scale = connected ? 57 / texture.width : 40 / texture.height;
      // The connected texture includes the receiver plate on its right side.
      // Its visual plate centre sits at roughly 62% of the cropped frame, not
      // at the texture centre. Anchor there so occupied and empty sockets share
      // the exact same room-space centre.
      const anchorX = connected ? 0.62 : 0.82;
      view.plugArt.texture = texture;
      view.plugArt.anchor.set(anchorX, 0.5);
      view.plugArt.scale.set(scale);
      view.plugShadow.texture = texture;
      view.plugShadow.anchor.set(anchorX, 0.5);
      view.plugShadow.scale.set(scale);
    });

    for (const view of pipeViews) {
      const tile = state.water.tiles[view.index]!;
      const flowing = state.water.flowingIndices.includes(view.index);
      view.root.cursor = tile.kind === "blocked" || tile.kind === "empty" ? "default" : "pointer";
      const shape = tile.kind === "stage" ? tile.shape : tile.kind;
      view.art.visible = tile.kind !== "blocked" && tile.kind !== "empty";
      view.pipeMask.clear();
      const rotation = state.water.rotations[view.index] ?? 0;
      const straightIndex = rotation % 2 === 0
        ? view.row < 2 ? 0 : 1
        : view.column < 2 ? 2 : 3;
      const directionalIndex = shape === "straight" ? straightIndex : rotation % 4;
      if (view.art.visible) view.art.texture = shape === "straight"
        ? (flowing ? hardware.waterStraightFlowing : hardware.waterStraightDry)[straightIndex]!
        : (flowing ? hardware.waterElbowFlowing : hardware.waterElbowDry)[directionalIndex]!;
      view.art.scale.set(tileSize / 240);
      const horizontalTop = shape === "straight" ? straightIndex === 0 : directionalIndex < 2;
      const horizontalBottom = shape === "straight" ? straightIndex === 1 : directionalIndex >= 2;
      const verticalLeft = shape === "straight" ? straightIndex === 2 : directionalIndex === 0 || directionalIndex === 3;
      const verticalRight = shape === "straight" ? straightIndex === 3 : directionalIndex === 1 || directionalIndex === 2;
      view.art.position.set(
        tileSize / 2 + (verticalLeft ? 2.5 : verticalRight ? -2 : 0),
        tileSize / 2 + (horizontalTop ? 5 : horizontalBottom ? -6 : 0)
      );
      view.art.rotation = 0;
      if (view.art.visible) {
        const center = tileSize / 2;
        for (const side of getWaterConnections(tile, rotation) as WaterSide[]) {
          const endX = side === 1 ? tileSize : side === 3 ? 0 : center;
          const endY = side === 2 ? tileSize : side === 0 ? 0 : center;
          view.pipeMask.moveTo(center, center).lineTo(endX, endY);
        }
        view.pipeMask.stroke({ color: 0xffffff, width: 40 });
        view.pipeMask.circle(center, center, 20).fill(0xffffff);
      }
      view.stageCollar.visible = tile.kind === "stage";
      view.letter.text = tile.stage ?? "";
    }
    inlet.texture = hardware.waterStraightFlowing[0];
    outlet.texture = state.water.connected ? hardware.waterStraightFlowing[1] : hardware.waterStraightDry[1];

    const nextHitCount = state.ignition.results.filter((result) => result === "hit").length;
    const nextMissCount = state.ignition.results.filter((result) => result === "miss").length;
    state.ignition.results.forEach((result, index) => {
      if (result === null || result === ignitionPreviousResults[index]) return;
      const lane = state.ignition.pattern[index];
      if (lane === undefined) return;
      ignitionTargetFeedback[lane] = { kind: result, ms: result === "hit" ? 260 : 340 };
    });
    ignitionPreviousResults = [...state.ignition.results];
    if (nextHitCount > ignitionHitCount) ignitionHitFlashMs = 190;
    if (nextMissCount > ignitionMissCount) ignitionMissFlashMs = 230;
    ignitionHitCount = nextHitCount;
    ignitionMissCount = nextMissCount;
    const laneStart = 78;
    const contactX = 528;
    const laneY = (lane: number) => 106 + lane * 58;
    const levelX = 78;
    const levelY = 68;
    const levelWidth = 450;
    const levelFill = levelWidth * state.ignition.charge / 100;
    const rhythmPulse = (Math.sin(pulseMs / 210) + 1) * 0.5;
    ignitionScreenGlow.alpha = 0.72 + rhythmPulse * 0.18;
    ignitionScanlines.alpha = 0.72 + rhythmPulse * 0.14;
    ignitionNotesGlow.alpha = 0.82 + rhythmPulse * 0.18;
    ignitionFieldGlow.clear()
      .roundRect(levelX, levelY, levelFill, 9, 3)
      .fill({ color: state.ignition.charge >= 100 ? 0x72c86a : 0xe2a348, alpha: 0.34 });
    if (ignitionHitFlashMs > 0) ignitionFieldGlow
      .roundRect(53, 55, 524, 232, 4)
      .fill({ color: 0x72c86a, alpha: 0.12 * ignitionHitFlashMs / 190 });
    if (ignitionMissFlashMs > 0) ignitionFieldGlow
      .roundRect(53, 55, 524, 232, 4)
      .fill({ color: 0xc65347, alpha: 0.14 * ignitionMissFlashMs / 230 });
    ignitionField.clear()
      .roundRect(levelX - 3, levelY - 3, levelWidth + 6, 15, 4)
      .fill({ color: 0x1b1409, alpha: 0.94 })
      .stroke({ color: 0x8b6b35, width: 1, alpha: 0.84 })
      .roundRect(levelX, levelY, levelFill, 9, 3)
      .fill(state.ignition.charge >= 100 ? 0x72c86a : 0xe2a348);
    for (let tick = 1; tick < 4; tick += 1) {
      const x = levelX + levelWidth * tick / 4;
      ignitionField.moveTo(x, levelY).lineTo(x, levelY + 9).stroke({ color: 0xd29b45, width: 1, alpha: 0.38 });
    }
    const finishWidth = 18;
    const finishX = levelX + levelWidth - finishWidth;
    ignitionField.roundRect(finishX, levelY, finishWidth, 9, 2).fill({ color: 0x72c86a, alpha: 0.96 });
    ignitionFieldGlow.roundRect(finishX, levelY, finishWidth, 9, 2).fill({ color: 0x72c86a, alpha: 0.18 + rhythmPulse * 0.12 });
    for (let lane = 0; lane < 4; lane += 1) {
      const y = laneY(lane);
      const feedback = ignitionTargetFeedback[lane]!;
      const feedbackDuration = feedback.kind === "hit" ? 260 : 340;
      const feedbackStrength = feedback.kind ? feedback.ms / feedbackDuration : 0;
      const missShake = feedback.kind === "miss" ? Math.sin(pulseMs / 24) * 3 * feedbackStrength : 0;
      const targetX = contactX + missShake;
      const targetColor = feedback.kind === "hit" ? 0x72c86a : feedback.kind === "miss" ? 0xc65347 : 0xe2a348;
      const targetExpansion = feedback.kind === "hit" ? 3 * feedbackStrength : 0;
      ignitionField.moveTo(laneStart, y).lineTo(contactX - 47, y).stroke({ color: 0x31504e, width: 2, alpha: 0.78 });
      ignitionField.roundRect(targetX - 42 - targetExpansion, y - 18 - targetExpansion, 84 + targetExpansion * 2, 36 + targetExpansion * 2, 3)
        .fill({ color: targetColor, alpha: feedback.kind ? 0.12 + feedbackStrength * 0.18 : 0.075 });
      ignitionFieldGlow.roundRect(targetX - 42 - targetExpansion, y - 18 - targetExpansion, 84 + targetExpansion * 2, 36 + targetExpansion * 2, 3)
        .fill({ color: targetColor, alpha: feedback.kind ? 0.08 + feedbackStrength * 0.12 : 0.025 + rhythmPulse * 0.025 });
      drawArrow(ignitionField, 66, y, lane, 0xe2a348, 0.72);
      drawArrow(ignitionField, targetX, y, lane, targetColor, feedback.kind ? 0.32 + feedbackStrength * 0.42 : 0.16);
    }
    ignitionNotes.clear();
    ignitionNotesGlow.clear();
    if (state.ignition.running) {
      const travelMs = 1_400;
      state.ignition.pattern.forEach((lane, index) => {
        if (state.ignition.results[index] !== null) return;
        const contactTime = getIgnitionContactTime(state, index);
        const x = contactX - (contactTime - state.ignition.runElapsedMs) / travelMs * (contactX - laneStart);
        if (x < laneStart - 22 || x > contactX + 34) return;
        const notePhase = pulseMs / 125 + index * 1.7;
        const noteX = x + Math.cos(notePhase * 0.72) * 0.9;
        const y = laneY(lane) + Math.sin(notePhase) * 1.5;
        const color = Math.abs(contactTime - state.ignition.runElapsedMs) <= getIgnitionTimingWindow(state) ? 0xf4c15b : 0xb66a38;
        drawArrow(ignitionNotesGlow, noteX, y, lane, color, 0.52);
        drawArrow(ignitionNotes, noteX - 4, y, lane, color, 0.13);
        drawArrow(ignitionNotes, noteX, y, lane, color);
      });
    }
    const countingDown = state.ignition.running && state.ignition.runElapsedMs < 0;
    ignitionCountdown.visible = countingDown;
    if (countingDown) {
      const remainingMs = -state.ignition.runElapsedMs;
      const phase = (3_000 - remainingMs) % 1_000 / 1_000;
      ignitionCountdown.text = String(Math.max(1, Math.ceil(remainingMs / 1_000)));
      ignitionCountdown.scale.set(1.35 - phase * 0.35);
      ignitionCountdown.alpha = 1 - phase * 0.18;
    }
    starterCableMeshPoints.forEach((point, index) => {
      const source = ropePoints[index]!;
      point.set(source.x / starterCableScale, source.y / starterCableScale);
    });
    starter.position.set(ropePoints.at(-1)!.x, ropePoints.at(-1)!.y);
    starterCallout.visible = !state.ignition.running && !state.ignition.solved;

    const podCode = `${state.pod.input}${"-".repeat(Math.max(0, 6 - state.pod.input.length))}`;
    podDisplay.text = podCode;
    podDisplayGlow.text = podCode;
    podDisplay.visible = !state.pod.opened;
    podDisplayGlow.visible = !state.pod.opened;
    podSuccessCheck.visible = state.pod.opened;
    podSuccessCheckGlow.visible = state.pod.opened;
    const crtFlicker = 0.92 + Math.sin(pulseMs / 43) * 0.045 + Math.sin(pulseMs / 17) * 0.025;
    podDisplay.alpha = crtFlicker;
    podDisplayGlow.alpha = 0.42 + crtFlicker * 0.15;
    podCrtGlow.alpha = 0.78 + Math.sin(pulseMs / 67) * 0.08;
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (active !== "ignition" || event.repeat) return;
    const key = event.key;
    const stateBeforeStrike = handlers.snapshot();
    const ignitionState = stateBeforeStrike.ignition;
    if (ignitionState.runElapsedMs < 0 || !ignitionState.keys.includes(key)) return;
    event.preventDefault();
    handlers.dispatch({ type: "STRIKE_CONTACT", key });
    const stateAfterStrike = handlers.snapshot();
    if (stateAfterStrike.reserve < stateBeforeStrike.reserve) {
      const lane = ignitionState.keys.indexOf(key);
      if (lane >= 0) ignitionTargetFeedback[lane] = { kind: "miss", ms: 340 };
    }
  };
  window.addEventListener("keydown", onKeyDown);

  return {
    container,
    close: () => close(false),
    open(id) {
      if (activeTransition?.visible) close(false);
      active = id; activeTransition = transitions[id]; handlers.dispatch({ type: "SET_OVERLAY", open: true });
      if (id === "ignition") handlers.dispatch({ type: "SET_IGNITION_PANEL", open: true });
      if (id === "vents") handlers.dispatch({ type: "SET_THERMAL_PANEL", open: true });
      handlers.panelOpened(); refresh(); activeTransition.open();
    },
    refresh,
    update(deltaMs) {
      pulseMs += deltaMs; Object.values(transitions).forEach((transition) => transition.update(deltaMs));
      const seconds = Math.min(0.05, deltaMs / 1000);
      if (wheelDragAngle === null && Math.abs(wheelVelocity) > 0.002) {
        const travel = wheelVelocity * seconds;
        wheelVisualAngle += travel;
        handlers.dispatch({ type: "CRANK_PRESSURE", amount: travel * 0.72 });
        wheelVelocity *= Math.exp(-8.4 * seconds);
      }
      const activelyDragged = wheelDragAngle !== null && performance.now() - wheelLastMotionAt < 110;
      const wheelMotion = activelyDragged || wheelDragAngle === null ? Math.min(1, Math.abs(wheelVelocity) / 8) : 0;
      handlers.pressureWheelMotion(active === "pressure" ? wheelMotion : 0, deltaMs);
      const state = handlers.snapshot();
      pressureNeedleVelocity += (state.pressure - pressureNeedle) * 68 * seconds;
      pressureNeedleVelocity *= Math.exp(-8.2 * seconds);
      pressureNeedle += pressureNeedleVelocity * seconds;
      temperatureNeedleVelocity += (state.temperature - temperatureNeedle) * 58 * seconds;
      temperatureNeedleVelocity *= Math.exp(-7.6 * seconds);
      temperatureNeedle += temperatureNeedleVelocity * seconds;
      if (active === "vents") {
        thermalFlickerMs = Math.max(0, thermalFlickerMs - deltaMs);
        const thermalState = state.thermal;
        cableViews.forEach((view) => {
          const anchor = { x: feedX, y: feedY[view.index] };
          const socket = thermalState.connections[view.feed];
          const headPosition = activeThermalFeed === view.feed
            ? thermalDragPoint
            : socket
              ? socketPositions[socket]
              : parkedThermalPositions[view.feed];
          const endpoint = {
            // Extend beneath the head's rounded rear collar. Ending at the
            // alpha edge exposed a visible gap between two otherwise aligned
            // sprites.
            x: headPosition.x - (socket ? 31 : 43),
            y: headPosition.y
          };
          view.plug.position.set(headPosition.x, headPosition.y);
          const distance = Math.hypot(endpoint.x - anchor.x, endpoint.y - anchor.y);
          const sag = 14 + Math.min(30, distance * 0.055);
          view.points.forEach((point, index) => {
            const t = index / (view.points.length - 1);
            if (index === 0) { point.x = anchor.x; point.y = anchor.y; point.px = point.x; point.py = point.y; return; }
            if (index === view.points.length - 1) { point.x = endpoint.x; point.y = endpoint.y; point.px = point.x; point.py = point.y; return; }
            const curve = Math.pow(Math.sin(Math.PI * t), 2.2);
            const targetX = anchor.x + (endpoint.x - anchor.x) * t;
            const targetY = anchor.y + (endpoint.y - anchor.y) * t + curve * sag;
            point.x = targetX; point.y = targetY;
            point.px = targetX; point.py = targetY;
          });
          view.meshPoints.forEach((point, index) => {
            const source = view.points[index]!;
            point.set(source.x / view.pipeScale, source.y / view.pipeScale);
          });
        });
      }
      if (active === "ignition") {
        ignitionHitFlashMs = Math.max(0, ignitionHitFlashMs - deltaMs);
        ignitionMissFlashMs = Math.max(0, ignitionMissFlashMs - deltaMs);
        ignitionTargetFeedback.forEach((feedback) => {
          feedback.ms = Math.max(0, feedback.ms - deltaMs);
          if (feedback.ms === 0) feedback.kind = null;
        });
        const tail = ropePoints.at(-1)!;
        for (let index = 1; index < ropePoints.length; index += 1) {
          const point = ropePoints[index]!;
          if (starterDragging && index === ropePoints.length - 1) continue;
          const vx = (point.x - point.px) * 0.92;
          const vy = (point.y - point.py) * 0.92;
          point.px = point.x; point.py = point.y;
          point.x += vx; point.y += vy + 210 * seconds * seconds;
        }
        if (!starterDragging) {
          const recoil = Math.min(1, seconds * 14);
          tail.x += (starterRest.x - tail.x) * recoil;
          tail.y += (starterRest.y - tail.y) * recoil;
          tail.px += (starterRest.x - tail.px) * recoil;
          tail.py += (starterRest.y - tail.py) * recoil;
        }
        ropePoints[0]!.x = starterAnchor.x; ropePoints[0]!.y = starterAnchor.y;
        const extension = Math.hypot(tail.x - starterAnchor.x, tail.y - starterAnchor.y);
        const segmentLength = Math.max(5.7, Math.min(31, extension / (ropePoints.length - 1)));
        for (let iteration = 0; iteration < 6; iteration += 1) {
          ropePoints[0]!.x = starterAnchor.x; ropePoints[0]!.y = starterAnchor.y;
          for (let index = 0; index < ropePoints.length - 1; index += 1) {
            const a = ropePoints[index]!; const b = ropePoints[index + 1]!;
            const dx = b.x - a.x; const dy = b.y - a.y; const distance = Math.max(0.001, Math.hypot(dx, dy));
            const correction = (distance - segmentLength) / distance;
            if (index > 0) { a.x += dx * correction * 0.5; a.y += dy * correction * 0.5; }
            if (!(starterDragging && index + 1 === ropePoints.length - 1)) { b.x -= dx * correction * 0.5; b.y -= dy * correction * 0.5; }
          }
        }
      }
      wheelCue.pulseBorder.alpha = 0.35 + (Math.sin(pulseMs / 360) + 1) * 0.25;
      if (active) refresh();
    },
    destroy() {
      handlers.pressureWheelMotion(0, 1_000);
      window.removeEventListener("keydown", onKeyDown);
      handlers.dispatch({ type: "SET_IGNITION_PANEL", open: false });
      handlers.dispatch({ type: "SET_THERMAL_PANEL", open: false });
      handlers.dispatch({ type: "SET_OVERLAY", open: false });
      container.destroy({ children: true });
      terminalVoidTexture.destroy(true);
    }
  };
}
