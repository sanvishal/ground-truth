import { BitmapText, BlurFilter, Container, Graphics, MeshRope, NineSliceSprite, Point, Rectangle, Sprite, type Texture } from "pixi.js";
import { UI_FONT } from "../fonts";
import type { Level2Action, Level2State, ThermalFeedId, ThermalSocketId, WaterSide } from "../sim/level2";
import { BALLAST_RATES, getIgnitionContactTime, getIgnitionTimingWindow, getPressureBand, getThermalMismatchCount, getWaterConnections, THERMAL_FEED_IDS, THERMAL_PORT_IDS, TEMPERATURE_SAFE_BAND } from "../sim/level2";
import { PanelApertureTransition } from "./panel-aperture-transition";
import { createHardwareSprite, createInteractionCue, createPanelNameplate, createPanelSurface, type PanelFrameTextures, type PanelNameplateTextures } from "./panel-nine-slice";
import { panelText } from "./panel-text";

export type Level2PuzzleId = "pressure" | "vents" | "water" | "ignition" | "pod";
export interface Level2PuzzleHandlers {
  snapshot(): Level2State; dispatch(action: Level2Action): void; panelOpened(): void;
  panelClosed(): void; controlStep(): void; mistake(): void;
}
export interface Level2PuzzleOverlays {
  readonly container: Container; open(id: Level2PuzzleId): void; refresh(): void;
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
  close: () => void
) {
  const root = new Container(); root.visible = false; root.eventMode = "none";
  const shade = new Graphics().rect(0, 0, 960, 420).fill({ color: 0x020304, alpha: 0.84 });
  shade.eventMode = "static"; shade.cursor = "pointer"; shade.on("pointertap", close);
  const body = new Container(); body.position.set(146, 32); body.eventMode = "static";
  body.hitArea = new Rectangle(0, 0, 668, 352); body.on("pointertap", (event) => event.stopPropagation());
  body.addChild(createPanelSurface(frame, 668, 352));
  const heading = createPanelNameplate(nameplateTexture, placement.x, placement.y, placement.width, placement.rotation);
  const closeButton = new Container(); closeButton.position.set(616, 13); closeButton.eventMode = "static"; closeButton.cursor = "pointer";
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
  // The painted rim is optically above the source canvas midpoint. Align its
  // center with the interaction pivot so the wheel does not orbit while turning.
  pressureWheelArt.position.y = 5.5;
  // Pixel rounding is useful for stationary hardware, but makes a rotating
  // sprite jump between adjacent pixels as its transform changes.
  for (const child of pressureWheelArt.children) {
    if (child instanceof Sprite) child.roundPixels = false;
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

  const ignition = shell(nameplates.ignitionSequencer, { x: 132, y: 20, width: 225, rotation: -0.008 }, frames.standard, () => close());
  const ignitionField = new Graphics();
  const ignitionNotes = new Graphics();
  const ignitionStatus = text("PULL THE EXCITER HANDLE", 11); ignitionStatus.anchor.set(0.5); ignitionStatus.position.set(414, 312);
  const rope = new Graphics();
  const starterAnchor = { x: 72, y: 307 };
  const starterRest = { x: 116, y: 307 };
  const starterHousing = new Graphics()
    .circle(starterAnchor.x, starterAnchor.y, 27).fill(0x15191a).stroke({ color: 0x8c724d, width: 5 })
    .circle(starterAnchor.x, starterAnchor.y, 14).fill(0x090b0c).stroke({ color: 0xe2a348, width: 2 })
    .circle(starterAnchor.x, starterAnchor.y, 4).fill(0x5a4931);
  const starter = new Container(); starter.eventMode = "static"; starter.cursor = "grab"; starter.hitArea = new Rectangle(-32, -18, 64, 36);
  starter.addChild(new Graphics()
    .roundRect(-28, -11, 56, 22, 4).fill(0x6e3c25).stroke({ color: 0xe2a348, width: 2 })
    .rect(-18, -7, 3, 14).fill(0x2a201b).rect(-6, -7, 3, 14).fill(0x2a201b)
    .rect(6, -7, 3, 14).fill(0x2a201b).rect(18, -7, 3, 14).fill(0x2a201b)
    .rect(-4, 11, 8, 7).fill(0x8c724d));
  const ropePoints = Array.from({ length: 8 }, (_, index) => {
    const x = starterAnchor.x + index * ((starterRest.x - starterAnchor.x) / 7);
    return { x, y: starterAnchor.y, px: x, py: starterAnchor.y };
  });
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
    tail.x = Math.max(starterRest.x, Math.min(270, point.x));
    tail.y = Math.max(starterAnchor.y - 24, Math.min(starterAnchor.y + 24, point.y));
    starterPeakExtension = Math.max(starterPeakExtension, tail.x - starterRest.x);
  };
  const releaseStarter = () => {
    if (starterDragging) {
      const elapsedMs = Math.max(1, performance.now() - starterPullStartMs);
      const distanceSpeed = starterPeakExtension / elapsedMs * 1000;
      handlers.dispatch({ type: "START_IGNITION", pullSpeed: Math.max(starterPeakSpeed, distanceSpeed) });
    }
    starterDragging = false; starter.cursor = "grab";
  };
  starter.on("globalpointermove", moveStarter);
  starter.on("pointerup", releaseStarter);
  starter.on("pointerupoutside", releaseStarter);
  ignition.body.addChild(ignitionField, ignitionNotes, starterHousing, rope, starter, ignitionStatus);

  const water = shell(nameplates.waterReclamation, { x: 130, y: 18, width: 220, rotation: 0.012 }, frames.reinforced, () => close());
  const tileSize = 58; const boardX = 218; const boardY = 66;
  const pipeViews = Array.from({ length: 16 }, (_, index) => {
    const root = new Container(); root.position.set(boardX + (index % 4) * tileSize, boardY + Math.floor(index / 4) * tileSize);
    root.eventMode = "static"; root.cursor = "pointer"; root.hitArea = new Rectangle(0, 0, tileSize, tileSize);
    const art = new Graphics(); const letter = text("", 15, 0xe9dfc7); letter.anchor.set(0.5); letter.position.set(tileSize / 2, tileSize / 2);
    root.addChild(art, letter); root.on("pointertap", () => handlers.dispatch({ type: "ROTATE_PIPE", index })); water.body.addChild(root);
    return { root, art, letter, index };
  });
  const source = text("RECLAIM", 11, 0xe2a348); source.anchor.set(1, 0.5); source.position.set(boardX - 18, boardY + tileSize * 1.5);
  const feed = text("BENCH FEED", 11, 0xe2a348); feed.position.set(boardX + tileSize * 4 + 18, boardY + tileSize * 3.5);
  const stubs = new Graphics();
  const flowCounter = text("---", 25, 0x72c86a); flowCounter.position.set(520, 72);
  const waterStatus = text("NO FLOW", 11); waterStatus.anchor.set(0.5); waterStatus.position.set(334, 320);
  water.body.addChild(stubs, source, feed, flowCounter, waterStatus);

  const pod = shell(nameplates.transferPod, { x: 110, y: 20, width: 185, rotation: -0.014 }, frames.sealed, () => close());
  const podDisplay = text("______", 30, 0xe2a348); podDisplay.position.set(250, 68);
  const podStatus = text("ENTER LAUNCH SEQUENCE", 12); podStatus.position.set(234, 108);
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "DEL", "0", "ENTER"].forEach((digit, index) => {
    const key = new Container(); key.position.set(213 + (index % 3) * 82, 148 + Math.floor(index / 3) * 48);
    key.eventMode = "static"; key.cursor = "pointer"; key.hitArea = new Rectangle(0, 0, 68, 36);
    const back = new Graphics().roundRect(0, 0, 68, 36, 3).fill(0x111517).stroke({ color: 0x6b5735, width: 1 });
    const caption = text(digit, digit.length > 1 ? 10 : 15, 0xe2a348); caption.anchor.set(0.5); caption.position.set(34, 18); key.addChild(back, caption);
    key.on("pointertap", () => {
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

    stubs.clear().moveTo(boardX - 16, boardY + tileSize * 1.5).lineTo(boardX, boardY + tileSize * 1.5).stroke({ color: 0xa97b42, width: 12 })
      .moveTo(boardX + tileSize * 4, boardY + tileSize * 3.5).lineTo(boardX + tileSize * 4 + 16, boardY + tileSize * 3.5).stroke({ color: state.water.solved ? 0x5d9fbd : 0xa97b42, width: 12 });
    for (const view of pipeViews) {
      const tile = state.water.tiles[view.index]!;
      const flowing = state.water.flowingIndices.includes(view.index);
      const pipeColor = flowing ? 0x5d9fbd : 0x9a7040;
      view.root.cursor = tile.kind === "blocked" || tile.kind === "empty" ? "default" : "pointer";
      view.art.clear().rect(0, 0, tileSize, tileSize).fill(tile.kind === "blocked" ? 0x151313 : 0x0b0d0e).stroke({ color: 0x343b39, width: 1 });
      if (tile.kind === "blocked") {
        view.art.moveTo(8, 9).lineTo(48, 47).moveTo(47, 8).lineTo(12, 51).stroke({ color: 0x743b34, width: 6 });
      } else if (tile.kind !== "empty") {
        const connections = getWaterConnections(tile, state.water.rotations[view.index] ?? 0);
        for (const side of connections as WaterSide[]) {
          const cx = tileSize / 2, cy = tileSize / 2;
          const ex = side === 1 ? tileSize : side === 3 ? 0 : cx;
          const ey = side === 2 ? tileSize : side === 0 ? 0 : cy;
          view.art.moveTo(cx, cy).lineTo(ex, ey).stroke({ color: pipeColor, width: tile.kind === "stage" ? 13 : 10 });
        }
        if (tile.kind === "stage") view.art.circle(tileSize / 2, tileSize / 2, 18).fill(0x24282a).stroke({ color: pipeColor, width: 5 });
      }
      view.letter.text = tile.stage ?? "";
    }
    flowCounter.text = state.water.solved ? state.water.digits : "---";
    waterStatus.text = state.water.solved ? "RECLAIM CYCLE CERTIFIED" : state.water.invalidOrder ? "FLOW ESTABLISHED. RECLAIM CYCLE NOT CERTIFIED." : state.water.connected ? "FLOW ESTABLISHED" : "NO FLOW";
    waterStatus.tint = state.water.invalidOrder ? 0xc96b5d : 0xc9c5ba;

    const laneStart = 92;
    const contactX = 562;
    const laneY = (lane: number) => 98 + lane * 48;
    ignitionField.clear()
      .roundRect(42, 72, 584, 208, 4).fill(0x080a0b).stroke({ color: 0x4c4c45, width: 1 })
      .roundRect(222, 49, 364, 12, 3).fill(0x050607).stroke({ color: 0x5d543f, width: 1 })
      .rect(226, 53, state.ignition.charge * 3.56, 4).fill(state.ignition.charge >= 100 ? 0x72c86a : 0xe2a348)
      .moveTo(582, 45).lineTo(582, 65).stroke({ color: 0x72c86a, width: 2 });
    for (let lane = 0; lane < 4; lane += 1) {
      const y = laneY(lane);
      ignitionField.moveTo(laneStart, y).lineTo(contactX + 16, y).stroke({ color: 0x343b39, width: 2 });
      ignitionField.roundRect(contactX - 52, y - 20, 104, 40, 3).fill({ color: 0xe2a348, alpha: 0.10 }).stroke({ color: 0xe2a348, width: 2 });
      drawArrow(ignitionField, 66, y, lane, 0xe2a348, 0.68);
      drawArrow(ignitionField, contactX, y, lane, 0xe2a348, 0.18);
    }
    for (let index = 0; index < BALLAST_RATES.length; index += 1) {
      ignitionField.circle(72 + index * 17, 54, 5).fill(index <= BALLAST_RATES.indexOf(state.ignition.rate) ? 0xe2a348 : 0x29261f);
    }
    ignitionNotes.clear();
    if (state.ignition.running) {
      const travelMs = 1_400;
      state.ignition.pattern.forEach((lane, index) => {
        if (state.ignition.results[index] !== null) return;
        const contactTime = getIgnitionContactTime(state, index);
        const x = contactX - (contactTime - state.ignition.runElapsedMs) / travelMs * (contactX - laneStart);
        if (x < laneStart - 22 || x > contactX + 34) return;
        const y = laneY(lane);
        const color = Math.abs(contactTime - state.ignition.runElapsedMs) <= getIgnitionTimingWindow(state) ? 0xf4c15b : 0xb66a38;
        drawArrow(ignitionNotes, x, y, lane, color);
      });
    }
    rope.clear().moveTo(ropePoints[0]!.x, ropePoints[0]!.y);
    ropePoints.slice(1).forEach((point) => rope.lineTo(point.x, point.y));
    rope.stroke({ color: 0xb79a66, width: 4 });
    starter.position.set(ropePoints.at(-1)!.x, ropePoints.at(-1)!.y);
    ignitionStatus.text = state.ignition.solved ? `IGNITION HELD  ${state.ignition.digits}` : state.ignition.running ? "STRIKE THE CONTACTS" : "PULL THE EXCITER HANDLE FAST";

    podDisplay.text = `${state.pod.input}${"_".repeat(Math.max(0, 6 - state.pod.input.length))}`;
    podStatus.text = state.pod.opened ? "POD UNSEALED" : state.plant.transferred ? "ENTER LAUNCH SEQUENCE" : "TRANSFER REQUIRED";
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (active !== "ignition" || event.repeat) return;
    const key = event.key;
    if (!handlers.snapshot().ignition.keys.includes(key)) return;
    event.preventDefault();
    handlers.dispatch({ type: "STRIKE_CONTACT", key });
  };
  window.addEventListener("keydown", onKeyDown);

  return {
    container,
    open(id) {
      if (id === "pod" && !handlers.snapshot().plant.transferred) { handlers.mistake(); return; }
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
      window.removeEventListener("keydown", onKeyDown);
      handlers.dispatch({ type: "SET_IGNITION_PANEL", open: false });
      handlers.dispatch({ type: "SET_THERMAL_PANEL", open: false });
      handlers.dispatch({ type: "SET_OVERLAY", open: false });
      container.destroy({ children: true });
    }
  };
}
