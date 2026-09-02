import {
  Application,
  Assets,
  BitmapText,
  BlurFilter,
  Container,
  Graphics,
  Rectangle,
  Sprite,
  TextStyle,
  Texture
} from "pixi.js";
import "pixi.js/prepare";
import { DialogueAudio } from "../audio/dialogue-audio";
import { Level1SceneAudio } from "../audio/level1-scene-audio";
import { DialogueEngine } from "../dialogue/engine";
import type { DialogueMessage, DialogueSnapshot, PageMetrics, Speaker } from "../dialogue/types";
import { DIALOGUE_FONT, UI_FONT } from "../fonts";
import { SAMPLE_DEMI_HOVER, SAMPLE_DEMI_LONG, SAMPLE_KORE_INTERRUPT, SAMPLE_KORE_LONG } from "../dev/samples";
import { registerLevel1Tools, type ToolRegistration } from "../tools/webmcp";
import { registerLevel2Tools } from "../tools/webmcp-level2";
import { Level1Session } from "../runtime/level1-session";
import { Level2Session } from "../runtime/level2-session";
import { clearLevel2Checkpoint, readLevel2Checkpoint, writeLevel2Checkpoint } from "../runtime/level2-checkpoint";
import {
  clearLevel1Checkpoint,
  readDialogueTranscript,
  readLevel1Checkpoint,
  writeDialogueCheckpoint,
  writeDialogueTranscript,
  writeLevel1Checkpoint
} from "../runtime/level1-checkpoint";
import { LEVEL1_MAX_RESERVE, type Level1Action, type Level1State } from "../sim/level1";
import { isAutoJitterWord, isAutoWaveWord, jitterOffset } from "./text-effects";
import { createLevel1CompositorProof, type Level1CompositorProof } from "./level1-compositor";
import { SparkPixelateFilter } from "./spark-pixelate-filter";
import { createLevel1InteractionLayer, type Level1InteractableId, type Level1InteractionLayer } from "./level1-interactions";
import { DEMI_WAKE_LINE, KORE_OPENING_RESPONSE } from "../content/level1";
import { COLD_OPEN_PANELS } from "../content/cold-open";
import {
  LEVEL_TRANSITION_PANEL_HEIGHT,
  LEVEL_TRANSITION_PANEL_WIDTH,
  LEVEL_TRANSITION_PANELS,
  LEVEL_TRANSITION_SHEET
} from "../content/level-transition";
import { GAME_OVER_PANELS, WIN_ENDING_PANELS } from "../content/endings";
import { createColdOpenSequence } from "./cold-open-sequence";
import { ScreenDitherTransition } from "./screen-dither-transition";
import { PanelApertureTransition } from "./panel-aperture-transition";
import { createPanelSurface } from "./panel-nine-slice";
import { createLevel2LightingProof, type Level2LightingProof } from "./level2-lighting-proof";
import { createLevel2InteractionLayer, type Level2InteractableId, type Level2InteractionLayer } from "./level2-interactions";
import { getBallastRateIndex, isEnvironmentAbnormal, type Level2Action, type Level2State } from "../sim/level2";

const W = 960;
const H = 540;
const GAME_H = 420;
const DIALOGUE_H = H - GAME_H;
const C = {
  black: 0x030506,
  nearBlack: 0x080b0d,
  ink: 0xe7dfcc,
  muted: 0x8f918c,
  amber: 0xe2a348,
  amberDim: 0x5e4827,
  danger: 0xb95243,
  edge: 0x4c4c45,
  panel: 0x111315,
  green: 0x69866e
};

const demiObservationForLevel2Failure = (error?: string): string | null => {
  switch (error) {
    case "That section cannot rotate.": return "That piece won't turn.";
    case "Pull the exciter handle faster.": return "Maybe I need to do it faster.";
    case "The exciter is not turning.": return "Nothing's moving yet.";
    case "The sequencer is counting down.": return "The countdown's still running.";
    case "That key is not wired to the sequencer.": return "That key did nothing.";
    case "The keypad accepts six digits.": return "Six digits are already showing.";
    case "The pod rejects the sequence.": return "The display cleared. It didn't unlock.";
    default: return null;
  }
};

const MENU_STAR_COLORS = [
  0x9db4ff, 0xaabfff, 0xc0d1ff, 0xe4e8ff, 0xfbf8ff,
  0xfff5ec, 0xffebd1, 0xffd7ae, 0xffc690
] as const;

function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

interface MenuStarfield {
  readonly container: Container;
  setPointer(x: number, y: number): void;
  update(deltaMs: number): void;
  destroy(): void;
}

function createMenuStarfield(asteroidSheetTexture: Texture): MenuStarfield {
  const container = new Container();
  const starLayer = new Container();
  const asteroidLayer = new Container();
  container.addChild(starLayer, asteroidLayer);
  let pointerX = 0;
  let pointerY = 0;
  let easedX = 0;
  let easedY = 0;
  let clock = 0;
  const shimmerNodes: Array<{
    node: Graphics;
    phase: number;
    speed: number;
    strength: number;
  }> = [];
  const bands = [
    { speed: 1.2, count: 96, alpha: 0.34, parallax: 2, size: 1, brightSize: 2, brightThreshold: 0.9, seed: 0x4d454e31 },
    { speed: 4.8, count: 73, alpha: 0.56, parallax: 7, size: 1, brightSize: 2, brightThreshold: 0.84, seed: 0x4d454e32 },
    { speed: 10.8, count: 53, alpha: 0.8, parallax: 15, size: 2, brightSize: 3, brightThreshold: 0.78, seed: 0x4d454e33 },
    { speed: 19, count: 23, alpha: 0.96, parallax: 26, size: 3, brightSize: 5, brightThreshold: 0.72, seed: 0x4d454e34 }
  ].map((config) => {
    const random = seededRandom(config.seed);
    const band = new Container();
    const stars = new Graphics();
    for (let index = 0; index < config.count; index += 1) {
      const x = Math.floor(random() * W);
      const y = Math.floor(random() * H);
      const bright = random() > config.brightThreshold;
      const size = bright ? config.brightSize : config.size;
      const color = MENU_STAR_COLORS[Math.floor(random() * MENU_STAR_COLORS.length)];
      const alpha = Math.min(1, config.alpha * (0.76 + random() * 0.32));
      for (const repeatY of [-H, 0, H]) {
        for (const repeatX of [-W, 0, W]) {
          if (bright) {
            stars.rect(x + repeatX - 1, y + repeatY - 1, size + 2, size + 2).fill({ color, alpha: alpha * 0.14 });
            stars.rect(x + repeatX - 2, y + repeatY + Math.floor(size / 2), size + 4, 1).fill({ color, alpha: alpha * 0.16 });
            stars.rect(x + repeatX + Math.floor(size / 2), y + repeatY - 2, 1, size + 4).fill({ color, alpha: alpha * 0.16 });
          }
          const arm = size >= 3 ? 2 : 1;
          const centerX = x + repeatX + Math.floor(size / 2);
          const centerY = y + repeatY + Math.floor(size / 2);
          stars.rect(centerX - arm, centerY, arm * 2 + 1, 1).fill({ color, alpha });
          stars.rect(centerX, centerY - arm, 1, arm * 2 + 1).fill({ color, alpha });
          if (size >= 3) {
            stars.rect(centerX - 1, centerY - 1, 3, 3).fill({ color, alpha: alpha * 0.82 });
          }
        }
      }
      if (bright && index % 2 === 0 && shimmerNodes.length < 28) {
        const shimmer = new Graphics();
        for (const repeatY of [-H, 0, H]) {
          for (const repeatX of [-W, 0, W]) {
            shimmer.rect(x + repeatX - 3, y + repeatY + Math.floor(size / 2), size + 6, 1).fill(color);
            shimmer.rect(x + repeatX + Math.floor(size / 2), y + repeatY - 3, 1, size + 6).fill(color);
          }
        }
        shimmer.alpha = 0;
        shimmerNodes.push({
          node: shimmer,
          phase: random() * Math.PI * 2,
          speed: 0.0018 + random() * 0.0016,
          strength: 0.78 + random() * 0.22
        });
        band.addChild(shimmer);
      }
    }
    band.addChildAt(stars, 0);
    starLayer.addChild(band);
    return { ...config, node: band, offsetX: 0, offsetY: 0 };
  });

  const asteroidColumns = 5;
  const asteroidRows = 2;
  const asteroidFrames = Array.from({ length: asteroidColumns * asteroidRows }, (_, index) => new Texture({
    source: asteroidSheetTexture.source,
    frame: new Rectangle(
      (index % asteroidColumns) * asteroidSheetTexture.width / asteroidColumns,
      Math.floor(index / asteroidColumns) * asteroidSheetTexture.height / asteroidRows,
      asteroidSheetTexture.width / asteroidColumns,
      asteroidSheetTexture.height / asteroidRows
    )
  }));
  const eventRandom = seededRandom(0x4d454e41);
  const asteroidBands = [new Container(), new Container(), new Container()];
  asteroidLayer.addChild(...asteroidBands);
  const asteroidDepths = [
    { sizeMin: 15, sizeRange: 11, alpha: 0.38, speedMin: 12, speedRange: 8, parallax: 4 },
    { sizeMin: 28, sizeRange: 16, alpha: 0.64, speedMin: 24, speedRange: 12, parallax: 12 },
    { sizeMin: 48, sizeRange: 22, alpha: 0.86, speedMin: 42, speedRange: 17, parallax: 25 }
  ] as const;
  const activeAsteroids: Array<{
    node: Sprite;
    x: number;
    y: number;
    speedX: number;
    speedY: number;
    rotationSpeed: number;
    parallax: number;
  }> = [];
  let nextAsteroidPairAt = 3800;
  const spawnAsteroidPair = () => {
    const firstDepth = Math.floor(eventRandom() * asteroidDepths.length);
    for (let index = 0; index < 2; index += 1) {
      const depthIndex = (firstDepth + index + 1) % asteroidDepths.length;
      const depth = asteroidDepths[depthIndex];
      const node = new Sprite(asteroidFrames[Math.floor(eventRandom() * asteroidFrames.length)]);
      const size = depth.sizeMin + eventRandom() * depth.sizeRange;
      node.anchor.set(0.5);
      node.scale.set(size / node.texture.width);
      node.roundPixels = true;
      node.alpha = depth.alpha;
      node.rotation = eventRandom() * Math.PI * 2;
      const asteroid = {
        node,
        x: W + 50 + index * 86,
        y: 42 + eventRandom() * (H - 150),
        speedX: depth.speedMin + eventRandom() * depth.speedRange,
        speedY: depth.speedMin * 0.18 + eventRandom() * depth.speedRange * 0.12,
        rotationSpeed: (0.08 + eventRandom() * 0.16) * (eventRandom() < 0.5 ? -1 : 1),
        parallax: depth.parallax
      };
      node.position.set(asteroid.x, asteroid.y);
      asteroidBands[depthIndex].addChild(node);
      activeAsteroids.push(asteroid);
    }
  };

  return {
    container,
    setPointer(x, y) {
      pointerX = Math.max(-1, Math.min(1, x));
      pointerY = Math.max(-1, Math.min(1, y));
    },
    update(deltaMs) {
      clock += deltaMs;
      const smoothing = 1 - Math.pow(0.002, deltaMs / 1000);
      easedX += (pointerX - easedX) * smoothing;
      easedY += (pointerY - easedY) * smoothing;
      for (const band of bands) {
        band.offsetX -= band.speed * deltaMs / 1000;
        band.offsetY += band.speed * 0.19 * deltaMs / 1000;
        if (band.offsetX <= -W) band.offsetX += W;
        if (band.offsetY >= H) band.offsetY -= H;
        band.node.position.set(
          Math.round(band.offsetX - easedX * band.parallax),
          Math.round(band.offsetY - easedY * band.parallax * 0.55)
        );
      }

      for (const shimmer of shimmerNodes) {
        const wave = Math.max(0, Math.sin(clock * shimmer.speed + shimmer.phase));
        shimmer.node.alpha = Math.pow(wave, 4) * shimmer.strength;
      }

      if (clock >= nextAsteroidPairAt) {
        spawnAsteroidPair();
        nextAsteroidPairAt = clock + 9000 + eventRandom() * 7000;
      }
      const deltaSeconds = deltaMs / 1000;
      for (let index = activeAsteroids.length - 1; index >= 0; index -= 1) {
        const asteroid = activeAsteroids[index];
        asteroid.x -= asteroid.speedX * deltaSeconds;
        asteroid.y += asteroid.speedY * deltaSeconds;
        asteroid.node.position.set(
          Math.round(asteroid.x - easedX * asteroid.parallax),
          Math.round(asteroid.y - easedY * asteroid.parallax * 0.55)
        );
        asteroid.node.rotation += asteroid.rotationSpeed * deltaSeconds;
        if (asteroid.x < -70 || asteroid.y > H + 70) {
          asteroid.node.destroy();
          activeAsteroids.splice(index, 1);
        }
      }
    },
    destroy() {
      for (const asteroid of activeAsteroids) asteroid.node.destroy();
      for (const frame of asteroidFrames) frame.destroy();
    }
  };
}

export type TextEffect = "none" | "wave" | "jitter";
export type DialoguePreset = "HYBRID" | "STAR FOX" | "UNDERTALE";
export const DEFAULT_DIALOGUE_PRESET: DialoguePreset = "HYBRID";

export interface GroundtruthTestControls {
  enterScene(): void;
  connect(): void;
  foundationIntro(): void;
  koreLong(): void;
  demiLong(): void;
  hover(): void;
  interrupt(): void;
  triggerImpact(): void;
  triggerColdOpen(): void;
  triggerLevelTransition(): void;
  triggerGameOver(): void;
  previewAnimation(): void;
  setPreset(value: DialoguePreset): void;
  setSpeed(value: number): void;
  setEffect(value: TextEffect): void;
  getLevel1State(): Level1State;
  dispatchLevel1(action: Level1Action): void;
  getLevel2State(): Level2State;
  dispatchLevel2(action: Level2Action): void;
}

interface PresetConfig {
  fontSize: number;
  lineHeight: number;
  portraitSize: number;
  maxLines: number;
  textX: number;
  textY: number;
  maxWidth: number;
}

const PRESETS: Record<DialoguePreset, PresetConfig> = {
  HYBRID: { fontSize: 19, lineHeight: 25, portraitSize: 96, maxLines: 3, textX: 150, textY: 458, maxWidth: 742 },
  "STAR FOX": { fontSize: 21, lineHeight: 27, portraitSize: 100, maxLines: 3, textX: 156, textY: 458, maxWidth: 706 },
  UNDERTALE: { fontSize: 17, lineHeight: 22, portraitSize: 90, maxLines: 4, textX: 146, textY: 455, maxWidth: 746 }
};

const DEMI_FRAME_X = [62, 393, 723, 1054] as const;
const DEMI_FRAME_Y = [39, 404, 737] as const;
const UI_ICON = {
  SWAP: 0,
  AUX: 1,
  LOG: 2,
  SOUND_ON: 3,
  SOUND_OFF: 4,
  CONTINUE: 5,
  PREVIOUS: 6,
  NEXT: 7,
  INSPECT: 8,
  INTERACT: 9,
  WARNING: 10,
  CONNECT: 11
} as const;

function bitmap(value: string, size: number, color = C.ink, family = UI_FONT): BitmapText {
  return new BitmapText({
    text: value,
    style: { fontFamily: family, fontSize: size, fill: color, letterSpacing: 0 }
  });
}

const measureCanvas = document.createElement("canvas");
const measureContext = measureCanvas.getContext("2d");

function measureFontText(value: string, family: string, size: number): number {
  if (!measureContext) return value.length * size * 0.55;
  measureContext.font = `${size}px "${family}"`;
  return measureContext.measureText(value).width;
}

function makeButton(label: string, width: number, height: number, onPress: () => void, family = UI_FONT, labelColor = C.ink): Container {
  const button = new Container();
  button.eventMode = "static";
  button.cursor = "pointer";
  button.hitArea = new Rectangle(0, 0, width, height);
  const face = new Graphics().rect(0, 0, width, height).fill(C.panel).stroke({ color: C.edge, width: 1 });
  const line = new Graphics().rect(2, 2, width - 4, 1).fill({ color: C.amber, alpha: 0.45 });
  const labelText = bitmap(label, 16, labelColor, family);
  labelText.anchor.set(0.5);
  labelText.position.set(Math.round(width / 2), Math.round(height / 2));
  button.addChild(face, line, labelText);
  button.on("pointerover", () => { face.tint = 0xd2b778; });
  button.on("pointerout", () => { face.tint = 0xffffff; });
  button.on("pointertap", (event) => { event.stopPropagation(); onPress(); });
  return button;
}

function makeMenuButton(labelText: string, onPress: () => void, width = 180, height = 42): Container {
  const button = new Container();
  button.eventMode = "static";
  button.cursor = "pointer";
  button.hitArea = new Rectangle(0, 0, width, height);

  const outline = [8, 0, width - 8, 0, width, 8, width, height - 8, width - 8, height, 8, height, 0, height - 8, 0, 8];
  const inset = [10, 4, width - 10, 4, width - 4, 10, width - 4, height - 10, width - 10, height - 4, 10, height - 4, 4, height - 10, 4, 10];
  const face = new Graphics().poly(outline).fill(C.panel);
  const outerBorder = new Graphics().poly(outline).stroke({ color: C.edge, width: 1 });
  const innerBorder = new Graphics().poly(inset).stroke({ color: C.amberDim, width: 1 });
  const label = bitmap(labelText, 16, C.ink);
  label.anchor.set(0.5);
  label.position.set(width / 2, height / 2);
  button.addChild(face, outerBorder, innerBorder, label);

  button.on("pointerover", () => { face.tint = 0xd2b778; });
  button.on("pointerout", () => {
    face.tint = 0xffffff;
  });
  button.on("pointertap", (event) => {
    event.stopPropagation();
    onPress();
  });
  return button;
}

function makeIconButton(texture: Texture, width: number, height: number, iconSize: number, onPress: () => void, framed = true, iconHeight = iconSize): Container {
  const button = new Container();
  button.eventMode = "static";
  button.cursor = "pointer";
  button.hitArea = new Rectangle(0, 0, width, height);
  const face = framed
    ? new Graphics().rect(0, 0, width, height).fill(C.panel).stroke({ color: C.amberDim, width: 1 })
    : new Graphics().rect(0, 0, width, height).fill({ color: C.panel, alpha: 0.001 });
  const icon = new Sprite(texture);
  icon.anchor.set(0.5);
  icon.position.set(Math.round(width / 2), Math.round(height / 2));
  icon.width = iconSize;
  icon.height = iconHeight;
  icon.roundPixels = true;
  button.addChild(face, icon);
  button.on("pointerover", () => { icon.tint = 0xffd079; });
  button.on("pointerout", () => { icon.tint = 0xffffff; });
  button.on("pointertap", (event) => { event.stopPropagation(); onPress(); });
  return button;
}

function makePagerButton(direction: -1 | 1, onPress: () => void): Container {
  const button = new Container();
  button.eventMode = "static";
  button.cursor = "pointer";
  button.hitArea = new Rectangle(0, 0, 32, 28);
  const face = new Graphics().rect(0, 0, 32, 28).fill(C.panel).stroke({ color: C.amberDim, width: 1 });
  const chevron = new Graphics();
  const x = direction < 0 ? [18, 15, 12, 15, 18] : [12, 15, 18, 15, 12];
  for (let index = 0; index < x.length; index += 1) chevron.rect(x[index], 6 + index * 4, 3, 3).fill(C.amber);
  button.addChild(face, chevron);
  button.on("pointerover", () => { chevron.tint = 0xffd079; });
  button.on("pointerout", () => { chevron.tint = 0xffffff; });
  button.on("pointertap", (event) => { event.stopPropagation(); onPress(); });
  return button;
}

function drawZapGlyph(graphic: Graphics, color = C.amber): void {
  graphic.clear();
  graphic.poly([14, 2, 6, 14, 11, 14, 8, 24, 21, 10, 15, 10, 19, 2]).fill(color);
  graphic.rect(12, 5, 2, 4).fill(0xffd079);
  graphic.rect(9, 16, 3, 2).fill(C.amberDim);
}

function drawSoundGlyph(graphic: Graphics, muted: boolean, color = C.amber): void {
  graphic.clear();
  graphic.rect(4, 11, 6, 9).fill(color);
  graphic.poly([10, 11, 17, 5, 17, 26, 10, 20]).fill(color);
  if (muted) {
    for (let index = 0; index < 5; index += 1) {
      graphic.rect(21 + index * 2, 9 + index * 2, 2, 2).fill(color);
      graphic.rect(29 - index * 2, 9 + index * 2, 2, 2).fill(color);
    }
  } else {
    graphic.rect(21, 10, 2, 3).fill(color);
    graphic.rect(23, 13, 2, 6).fill(color);
    graphic.rect(21, 19, 2, 3).fill(color);
    graphic.rect(27, 7, 2, 4).fill(color);
    graphic.rect(29, 11, 2, 12).fill(color);
    graphic.rect(27, 23, 2, 4).fill(color);
  }
}

function framedTexture(base: Texture, column: number, row: number, cellWidth: number, cellHeight: number): Texture {
  return new Texture({
    source: base.source,
    frame: new Rectangle(column * cellWidth, row * cellHeight, cellWidth, cellHeight)
  });
}

class PortraitView {
  readonly container = new Container();
  private sprite = new Sprite();
  private glow: Sprite | null = null;
  private frames: Texture[] = [];
  private speaker: Speaker;
  private speaking = false;
  private frameClock = 0;
  private blinkClock = 2500 + Math.random() * 1800;
  private width = 86;
  private previewClock = 0;

  constructor(speaker: Speaker, frames: Texture[]) {
    this.speaker = speaker;
    this.frames = frames;
    this.sprite.texture = frames[0];
    this.sprite.anchor.set(0.5);
    this.sprite.roundPixels = true;
    if (speaker === "KORE") {
      this.glow = new Sprite(frames[0]);
      this.glow.anchor.set(0.5);
      this.glow.tint = C.amber;
      this.glow.alpha = 0.28;
      this.glow.blendMode = "add";
      this.glow.filters = [new BlurFilter({ strength: 5, quality: 3 })];
      this.container.addChild(this.glow, this.sprite);
    } else {
      const clip = new Graphics().rect(-50, -50, 100, 100).fill(0xffffff);
      this.sprite.mask = clip;
      this.container.addChild(this.sprite, clip);
    }
    this.setSize(this.width);
  }

  private showFrame(index: number): void {
    const texture = this.frames[index] ?? this.frames[0];
    this.sprite.texture = texture;
    if (this.glow) this.glow.texture = texture;
  }

  setSize(size: number): void {
    this.width = size;
    this.sprite.width = size;
    this.sprite.height = size;
    if (this.glow) {
      this.glow.width = size + 10;
      this.glow.height = size + 10;
    }
  }

  setSpeaking(value: boolean): void {
    if (this.speaking === value) return;
    this.speaking = value;
    this.frameClock = 0;
    this.showFrame(value ? (this.speaker === "KORE" ? 4 : 2) : 0);
  }

  preview(): void {
    this.previewClock = 2200;
    this.frameClock = 0;
  }

  update(deltaMs: number): void {
    const wasPreviewing = this.previewClock > 0;
    this.previewClock = Math.max(0, this.previewClock - deltaMs);
    this.frameClock += deltaMs;
    this.blinkClock -= deltaMs;
    if (this.speaking || this.previewClock > 0) {
      const start = this.speaker === "KORE" ? 4 : 2;
      const count = this.speaker === "KORE" ? 3 : 2;
      this.showFrame(start + Math.floor(this.frameClock / 115) % count);
      if (this.glow) this.glow.alpha = 0.38 + Math.sin(this.frameClock * 0.018) * 0.09;
      return;
    }
    if (wasPreviewing) this.showFrame(0);
    if (this.glow) this.glow.alpha = 0.24;
    if (this.blinkClock <= 0) {
      this.showFrame(1);
      if (this.blinkClock < -110) {
        this.showFrame(0);
        this.blinkClock = 2800 + Math.random() * 2800;
      }
    }
  }
}

interface GlyphEntry {
  node: Container;
  baseX: number;
  baseY: number;
  index: number;
  autoJitter: boolean;
  autoWave: boolean;
}

class GlyphPage {
  readonly container = new Container();
  private entries: GlyphEntry[] = [];
  private family = DIALOGUE_FONT;
  private effect: TextEffect = "none";
  private config = PRESETS[DEFAULT_DIALOGUE_PRESET];
  private seed = 0;

  configure(family: string, effect: TextEffect, config: PresetConfig): void {
    this.family = family;
    this.effect = effect;
    this.config = config;
  }

  measure(text: string): number {
    const parts = text.split("⚡");
    const zapCount = Math.max(0, parts.length - 1);
    return parts.reduce(
      (width, part) => width + measureFontText(part, this.family, this.config.fontSize),
      zapCount * this.config.fontSize * 0.66
    );
  }

  rebuild(text: string): void {
    this.container.removeChildren().forEach((child) => child.destroy());
    this.entries = [];
    const style = new TextStyle({ fontFamily: this.family, fontSize: this.config.fontSize, fill: C.ink });
    const tokens = text.split(/(\s+)/).filter(Boolean);
    let x = 0;
    let y = 0;
    let index = 0;
    for (const token of tokens) {
      const tokenWidth = this.measure(token);
      const whitespace = /^\s+$/.test(token);
      const autoJitter = !whitespace && isAutoJitterWord(token);
      const autoWave = !whitespace && isAutoWaveWord(token);
      if (!/^\s+$/.test(token) && x > 0 && x + tokenWidth > this.config.maxWidth) {
        x = 0;
        y += this.config.lineHeight;
      }
      for (const character of token) {
        const width = this.measure(character);
        if (character !== "\n" && character !== " ") {
          const node = character === "⚡" ? (() => {
            const icon = new Container();
            const glyph = new Graphics();
            drawZapGlyph(glyph, C.amber);
            glyph.scale.set(0.55);
            glyph.position.set(0, 3);
            icon.addChild(glyph);
            return icon;
          })() : new BitmapText({ text: character, style });
          if (node instanceof BitmapText) node.roundPixels = true;
          node.position.set(Math.round(x), Math.round(y));
          this.container.addChild(node);
          this.entries.push({ node, baseX: Math.round(x), baseY: Math.round(y), index, autoJitter, autoWave });
        }
        x += width;
        index += 1;
      }
    }
    this.seed += 1;
  }

  setVisibleCharacters(count: number): void {
    for (const entry of this.entries) entry.node.visible = entry.index < count;
  }

  update(timeMs: number): void {
    for (const entry of this.entries) {
      let dx = 0;
      let dy = 0;
      if (this.effect === "wave" || entry.autoWave) dy = Math.round(Math.sin(timeMs * 0.008 + entry.index * 0.58) * 1.5);
      if (this.effect === "jitter" || entry.autoJitter) {
        const frame = Math.floor(timeMs / 110);
        const offset = jitterOffset(frame, entry.index, this.seed);
        dx = offset.x;
        dy = offset.y;
      }
      entry.node.position.set(entry.baseX + dx, entry.baseY + dy);
    }
  }
}

interface CardView {
  speaker: Speaker;
  container: Container;
  portrait: PortraitView;
  name: BitmapText;
  glyphs: GlyphPage;
  unreadLamp: Graphics;
  swapButton: Container;
  continueMark: Container;
  finalMark: BitmapText;
  messageKey: string;
  targetX: number;
  animationStartX: number;
  animationTime: number;
}

function easeOutBack(t: number): number {
  const c = 1.70158;
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
}

export interface GameLoadProgress {
  progress: number;
  label: string;
}

export async function createGroundtruthGame(
  canvas: HTMLCanvasElement,
  onLoadProgress?: (progress: GameLoadProgress) => void
) {
  const app = new Application();
  const pixelRatio = Math.max(1, window.devicePixelRatio || 1);
  const stageElement = canvas.parentElement;
  const measureDisplayWidth = () => Math.max(1, Math.min(W, stageElement?.getBoundingClientRect().width || W));
  let displayWidth = measureDisplayWidth();
  let displayScale = displayWidth / W;
  let outputPixelScale = displayScale * pixelRatio;
  onLoadProgress?.({ progress: 0.01, label: "STARTING DISPLAY" });
  await app.init({
    canvas,
    width: displayWidth,
    height: displayWidth * H / W,
    background: C.black,
    antialias: false,
    resolution: pixelRatio,
    autoDensity: true
  });
  onLoadProgress?.({ progress: 0.06, label: "DISPLAY ONLINE" });
  // Avoid running the full filtered scene at 120 Hz on ProMotion displays.
  // The authored animation timing targets 60 FPS.
  app.ticker.maxFPS = 60;
  const sceneAudio = new Level1SceneAudio();
  const unlockSceneAudio = () => {
    sceneAudio.unlock();
    window.removeEventListener("pointerdown", unlockSceneAudio, true);
    window.removeEventListener("keydown", unlockSceneAudio, true);
  };
  window.addEventListener("pointerdown", unlockSceneAudio, { once: true, capture: true });
  window.addEventListener("keydown", unlockSceneAudio, { once: true, capture: true });
  const totalTextures = 40 + COLD_OPEN_PANELS.length + GAME_OVER_PANELS.length + WIN_ENDING_PANELS.length;
  let loadedTextures = 0;
  const loadTexture = async (path: string, label: string): Promise<Texture> => {
    const texture = await Assets.load<Texture>(path);
    loadedTextures += 1;
    onLoadProgress?.({
      progress: 0.06 + loadedTextures / totalTextures * 0.88,
      label
    });
    return texture;
  };
  const [roomTexture, demiTexture, koreTexture, portraitHousingTexture, logTabletTexture, uiIconsTexture, logIconTexture, auxChunkTexture, level1RoomTexture, level1WindowMaskTexture, level1WindowCracksTexture, level1ForegroundTexture, level1AsteroidsTexture, panelStandardTexture, panelReinforcedTexture, panelSealedTexture, panelNameplatesTexture, level2PanelNameplatesTexture, level2PressureHardwareTexture, level2PressureWheelTexture, level2ThermalHardwareTexture, level2ThermalPipesTexture, level2WaterHardwareTexture, level2WaterPipesTexture, level2WaterGridTexture, level2IgnitionHardwareTexture, level2PodNumpadTexture, busLoomHeadsTexture, busLoomConnectorStatesTexture, busLoomCablesTexture, continuityPathTexture, continuityMovableTexture, regulatorHardwareTexture, junctionHardwareTexture, breakerHardwareTexture, breakerGlyphTexture, titleLogoTexture] = await Promise.all([
    loadTexture("/assets/art/example-bridge.png", "LOADING SHIP INTERIOR"),
    loadTexture("/assets/art/demi-dialogue-spritesheet.png", "LOADING DEMI"),
    loadTexture("/assets/art/kore-dialogue-spritesheet.png", "LOADING KORE"),
    loadTexture("/assets/art/portrait-housing-thick.png", "ASSEMBLING DIALOGUE"),
    loadTexture("/assets/art/log-tablet-v3.png", "LOADING SHIP LOG"),
    loadTexture("/assets/art/ui-icons.png", "LOADING INTERFACE"),
    loadTexture("/assets/art/log-icon-v4.png", "LOADING INTERFACE"),
    loadTexture("/assets/art/aux-chunk-v2.png", "CALIBRATING AUX POWER"),
    loadTexture("/assets/art/level1/integrated-room-A-damage-v2.png", "RESTORING LEVEL 1"),
    loadTexture("/assets/art/level1/window-mask-integrated-A.png", "CUTTING VIEWPORT"),
    loadTexture("/assets/art/level1/window-cracks-v1.png", "RESTORING WINDOW DAMAGE"),
    loadTexture("/assets/art/level1/foreground-A.png", "ASSEMBLING SHIP INTERIOR"),
    loadTexture("/assets/art/level1/asteroid-spritesheet-E-runtime.png", "MAPPING ASTEROIDS"),
    loadTexture("/assets/art/ui/panel-frames/standard-d.png", "LOADING REPAIR PANELS"),
    loadTexture("/assets/art/ui/panel-frames/reinforced-a.png", "LOADING REPAIR PANELS"),
    loadTexture("/assets/art/ui/panel-frames/sealed-c.png", "LOADING REPAIR PANELS"),
    loadTexture("/assets/art/ui/panel-nameplates/panel-nameplates-v3.png", "LABELING SYSTEMS"),
    loadTexture("/assets/art/ui/panel-nameplates/level2-panel-nameplates-v1.png", "LABELING GREENHOUSE SYSTEMS"),
    loadTexture("/assets/art/ui/panel-hardware/level2-pressure-hardware-v1.png", "ASSEMBLING PRESSURE CONTROL"),
    loadTexture("/assets/art/ui/panel-hardware/level2-pressure-wheel-v2.png", "ASSEMBLING PRESSURE CONTROL"),
    loadTexture("/assets/art/ui/panel-hardware/level2-thermal-hardware-v1.png", "ASSEMBLING THERMAL COUPLING"),
    loadTexture("/assets/art/ui/panel-hardware/level2-thermal-pipes-v1.png", "ROUTING THERMAL LINES"),
    loadTexture("/assets/art/ui/panel-hardware/level2-water-reclamation-v1.png", "ASSEMBLING WATER RECLAMATION"),
    loadTexture("/assets/art/ui/panel-hardware/level2-water-pipes-v2.png", "FITTING RECLAMATION PIPES"),
    loadTexture("/assets/art/ui/panel-hardware/level2-water-grid-v2.png", "PLATING RECLAMATION GRID"),
    loadTexture("/assets/art/ui/panel-hardware/level2-ignition-hardware-v1.png", "ASSEMBLING IGNITION SEQUENCER"),
    loadTexture("/assets/art/ui/panel-hardware/level2-pod-numpad-v1.png", "ASSEMBLING TRANSFER POD"),
    loadTexture("/assets/art/ui/panel-hardware/bus-loom-heads-v2.png", "LOADING BUS LOOM"),
    loadTexture("/assets/art/ui/panel-hardware/bus-loom-connector-states-v3.png", "LOADING BUS LOOM"),
    loadTexture("/assets/art/ui/panel-hardware/bus-loom-cables-v2.png", "LOADING BUS LOOM"),
    loadTexture("/assets/art/ui/panel-hardware/continuity-path-long-v2.png", "LOADING SEQUENCER"),
    loadTexture("/assets/art/ui/panel-hardware/continuity-movable-controls-v2.png", "LOADING SEQUENCER"),
    loadTexture("/assets/art/ui/panel-hardware/regulator-controls-v2.png", "LOADING REGULATOR"),
    loadTexture("/assets/art/ui/panel-hardware/junction-hardware-v1.png", "LOADING JUNCTION"),
    loadTexture("/assets/art/ui/panel-hardware/breaker-hardware-v1.png", "LOADING BREAKERS"),
    loadTexture("/assets/art/ui/panel-hardware/breaker-glyphs-v1.png", "LOADING BREAKERS"),
    loadTexture("/assets/art/title-ground-truth.png", "LOADING TITLE")
  ]);
  roomTexture.source.scaleMode = "nearest";
  demiTexture.source.scaleMode = "nearest";
  koreTexture.source.scaleMode = "nearest";
  portraitHousingTexture.source.scaleMode = "nearest";
  logTabletTexture.source.scaleMode = "nearest";
  uiIconsTexture.source.scaleMode = "nearest";
  logIconTexture.source.scaleMode = "nearest";
  auxChunkTexture.source.scaleMode = "nearest";
  level1RoomTexture.source.scaleMode = "nearest";
  level1WindowMaskTexture.source.scaleMode = "nearest";
  level1WindowCracksTexture.source.scaleMode = "nearest";
  level1ForegroundTexture.source.scaleMode = "nearest";
  level1AsteroidsTexture.source.scaleMode = "nearest";
  panelStandardTexture.source.scaleMode = "nearest";
  panelReinforcedTexture.source.scaleMode = "nearest";
  panelSealedTexture.source.scaleMode = "nearest";
  panelNameplatesTexture.source.scaleMode = "nearest";
  level2PanelNameplatesTexture.source.scaleMode = "nearest";
  level2PressureHardwareTexture.source.scaleMode = "nearest";
  level2PressureWheelTexture.source.scaleMode = "nearest";
  level2ThermalHardwareTexture.source.scaleMode = "nearest";
  level2ThermalPipesTexture.source.scaleMode = "nearest";
  level2WaterHardwareTexture.source.scaleMode = "nearest";
  level2WaterPipesTexture.source.scaleMode = "nearest";
  level2WaterGridTexture.source.scaleMode = "nearest";
  level2IgnitionHardwareTexture.source.scaleMode = "nearest";
  level2PodNumpadTexture.source.scaleMode = "nearest";
  busLoomHeadsTexture.source.scaleMode = "nearest";
  busLoomConnectorStatesTexture.source.scaleMode = "nearest";
  busLoomCablesTexture.source.scaleMode = "nearest";
  continuityPathTexture.source.scaleMode = "nearest";
  continuityMovableTexture.source.scaleMode = "nearest";
  regulatorHardwareTexture.source.scaleMode = "nearest";
  junctionHardwareTexture.source.scaleMode = "nearest";
  breakerHardwareTexture.source.scaleMode = "nearest";
  breakerGlyphTexture.source.scaleMode = "nearest";
  titleLogoTexture.source.scaleMode = "nearest";
  const coldOpenTextures = await Promise.all(COLD_OPEN_PANELS.map((panel) => loadTexture(panel.image, "LOADING COLD OPEN")));
  for (const texture of coldOpenTextures) texture.source.scaleMode = "nearest";
  const levelTransitionSheetTexture = await loadTexture(LEVEL_TRANSITION_SHEET, "MAPPING GREENHOUSE ROUTE");
  levelTransitionSheetTexture.source.scaleMode = "nearest";
  const levelTransitionTextures = LEVEL_TRANSITION_PANELS.map((_, index) => new Texture({
    source: levelTransitionSheetTexture.source,
    frame: new Rectangle(
      0,
      index * LEVEL_TRANSITION_PANEL_HEIGHT,
      LEVEL_TRANSITION_PANEL_WIDTH,
      LEVEL_TRANSITION_PANEL_HEIGHT
    )
  }));
  const gameOverTextures = await Promise.all(GAME_OVER_PANELS.map((panel) => loadTexture(panel.image, "LOADING FAILURE RECORD")));
  const winEndingTextures = await Promise.all(WIN_ENDING_PANELS.map((panel) => loadTexture(panel.image, "LOADING ESCAPE RECORD")));
  for (const texture of [...gameOverTextures, ...winEndingTextures]) texture.source.scaleMode = "nearest";
  const level2RoomTexture = await loadTexture("/assets/art/level2/level2-greenhouse-neutral-runtime-v3.png", "RESTORING GREENHOUSE");
  const level2AlarmRoomTexture = await loadTexture("/assets/art/level2/level2-greenhouse-alarm-runtime-v1.png", "RESTORING GREENHOUSE");
  level2RoomTexture.source.scaleMode = "nearest";
  level2AlarmRoomTexture.source.scaleMode = "nearest";
  onLoadProgress?.({ progress: 0.97, label: "ASSEMBLING SCENE" });
  const panelNameplates = {
    emergencyBusLoom: new Texture({ source: panelNameplatesTexture.source, frame: new Rectangle(38, 278, 490, 137) }),
    continuitySequencer: new Texture({ source: panelNameplatesTexture.source, frame: new Rectangle(574, 280, 508, 134) }),
    junctionRouter: new Texture({ source: panelNameplatesTexture.source, frame: new Rectangle(1128, 290, 346, 118) }),
    harmonicRegulator: new Texture({ source: panelNameplatesTexture.source, frame: new Rectangle(333, 525, 355, 196) }),
    emergencyBreakerBank: new Texture({ source: panelNameplatesTexture.source, frame: new Rectangle(738, 526, 392, 194) }),
    pressureControl: new Texture({ source: level2PanelNameplatesTexture.source, frame: new Rectangle(20, 190, 590, 220) }),
    thermalCoupling: new Texture({ source: level2PanelNameplatesTexture.source, frame: new Rectangle(600, 190, 580, 220) }),
    ignitionSequencer: new Texture({ source: level2PanelNameplatesTexture.source, frame: new Rectangle(1175, 190, 585, 220) }),
    waterReclamation: new Texture({ source: level2PanelNameplatesTexture.source, frame: new Rectangle(250, 490, 630, 230) }),
    transferPod: new Texture({ source: level2PanelNameplatesTexture.source, frame: new Rectangle(910, 490, 580, 230) })
  };
  const level2PanelHardware = {
    pressureCrt: new Texture({ source: level2PressureHardwareTexture.source, frame: new Rectangle(45, 100, 1445, 280) }),
    pressureWheel: level2PressureWheelTexture,
    thermalSocket: new Texture({ source: level2ThermalHardwareTexture.source, frame: new Rectangle(70, 112, 202, 206) }),
    thermalDisconnected: {
      red: new Texture({ source: level2ThermalHardwareTexture.source, frame: new Rectangle(369, 133, 255, 173) }),
      blue: new Texture({ source: level2ThermalHardwareTexture.source, frame: new Rectangle(672, 134, 246, 173) }),
      green: new Texture({ source: level2ThermalHardwareTexture.source, frame: new Rectangle(967, 134, 293, 173) }),
      amber: new Texture({ source: level2ThermalHardwareTexture.source, frame: new Rectangle(1260, 131, 242, 176) })
    },
    thermalConnected: {
      red: new Texture({ source: level2ThermalHardwareTexture.source, frame: new Rectangle(28, 391, 266, 233) }),
      blue: new Texture({ source: level2ThermalHardwareTexture.source, frame: new Rectangle(397, 391, 274, 233) }),
      green: new Texture({ source: level2ThermalHardwareTexture.source, frame: new Rectangle(786, 391, 279, 231) }),
      amber: new Texture({ source: level2ThermalHardwareTexture.source, frame: new Rectangle(1173, 390, 283, 232) })
    },
    thermalLed: {
      red: new Texture({ source: level2ThermalPipesTexture.source, frame: new Rectangle(899, 346, 101, 93) }),
      blue: new Texture({ source: level2ThermalPipesTexture.source, frame: new Rectangle(1055, 346, 95, 96) }),
      green: new Texture({ source: level2ThermalPipesTexture.source, frame: new Rectangle(1205, 345, 98, 97) }),
      amber: new Texture({ source: level2ThermalPipesTexture.source, frame: new Rectangle(1362, 345, 99, 94) })
    },
    thermalPipe: {
      red: new Texture({ source: level2ThermalPipesTexture.source, frame: new Rectangle(62, 510, 1413, 66) }),
      blue: new Texture({ source: level2ThermalPipesTexture.source, frame: new Rectangle(62, 606, 1411, 58) }),
      green: new Texture({ source: level2ThermalPipesTexture.source, frame: new Rectangle(62, 702, 1411, 54) }),
      amber: new Texture({ source: level2ThermalPipesTexture.source, frame: new Rectangle(62, 791, 1412, 59) })
    },
    // Use the sheet's native direction-specific pieces. Rotating a single
    // generated crop exposed its uneven internal centreline at every seam.
    waterStraightDry: [
      new Texture({ source: level2WaterPipesTexture.source, frame: new Rectangle(264, 30, 240, 240) }),
      new Texture({ source: level2WaterPipesTexture.source, frame: new Rectangle(264, 555, 240, 240) }),
      new Texture({ source: level2WaterPipesTexture.source, frame: new Rectangle(9, 291, 240, 240) }),
      new Texture({ source: level2WaterPipesTexture.source, frame: new Rectangle(520, 291, 240, 240) })
    ] as const,
    waterStraightFlowing: [
      new Texture({ source: level2WaterPipesTexture.source, frame: new Rectangle(1034, 30, 240, 240) }),
      new Texture({ source: level2WaterPipesTexture.source, frame: new Rectangle(1034, 555, 240, 240) }),
      new Texture({ source: level2WaterPipesTexture.source, frame: new Rectangle(779, 291, 240, 240) }),
      new Texture({ source: level2WaterPipesTexture.source, frame: new Rectangle(1290, 291, 240, 240) })
    ] as const,
    // Rotation order: right/down, down/left, left/up, up/right.
    waterElbowDry: [
      new Texture({ source: level2WaterPipesTexture.source, frame: new Rectangle(9, 30, 240, 240) }),
      new Texture({ source: level2WaterPipesTexture.source, frame: new Rectangle(520, 30, 240, 240) }),
      new Texture({ source: level2WaterPipesTexture.source, frame: new Rectangle(520, 555, 240, 240) }),
      new Texture({ source: level2WaterPipesTexture.source, frame: new Rectangle(9, 555, 240, 240) })
    ] as const,
    waterElbowFlowing: [
      new Texture({ source: level2WaterPipesTexture.source, frame: new Rectangle(779, 30, 240, 240) }),
      new Texture({ source: level2WaterPipesTexture.source, frame: new Rectangle(1290, 30, 240, 240) }),
      new Texture({ source: level2WaterPipesTexture.source, frame: new Rectangle(1290, 555, 240, 240) }),
      new Texture({ source: level2WaterPipesTexture.source, frame: new Rectangle(779, 555, 240, 240) })
    ] as const,
    waterStageCollar: new Texture({ source: level2WaterHardwareTexture.source, frame: new Rectangle(791, 563, 198, 195) }),
    waterGridTile: new Texture({ source: level2WaterGridTexture.source, frame: new Rectangle(126, 596, 302, 302) }),
    ignitionStarterSocket: new Texture({ source: level2IgnitionHardwareTexture.source, frame: new Rectangle(225, 597, 190, 161) }),
    ignitionStarterPlug: new Texture({ source: level2IgnitionHardwareTexture.source, frame: new Rectangle(641, 568, 115, 220) }),
    ignitionCable: new Texture({ source: level2IgnitionHardwareTexture.source, frame: new Rectangle(35, 883, 1466, 49) }),
    podNumpad: level2PodNumpadTexture
  };
  const panelHardware = {
    busConnectorHeads: {
      blue_heavy: new Texture({ source: busLoomConnectorStatesTexture.source, frame: new Rectangle(12, 250, 328, 132) }),
      ridged_heavy: new Texture({ source: busLoomConnectorStatesTexture.source, frame: new Rectangle(340, 250, 325, 132) }),
      cloth_mid: new Texture({ source: busLoomConnectorStatesTexture.source, frame: new Rectangle(665, 250, 300, 132) }),
      smooth_light: new Texture({ source: busLoomConnectorStatesTexture.source, frame: new Rectangle(965, 250, 280, 132) }),
      green_light: new Texture({ source: busLoomConnectorStatesTexture.source, frame: new Rectangle(1245, 250, 291, 132) })
    },
    busConnectorSeated: {
      blue_heavy: new Texture({ source: busLoomConnectorStatesTexture.source, frame: new Rectangle(30, 540, 280, 224) }),
      ridged_heavy: new Texture({ source: busLoomConnectorStatesTexture.source, frame: new Rectangle(330, 540, 290, 224) }),
      cloth_mid: new Texture({ source: busLoomConnectorStatesTexture.source, frame: new Rectangle(645, 540, 315, 224) }),
      smooth_light: new Texture({ source: busLoomConnectorStatesTexture.source, frame: new Rectangle(945, 540, 275, 224) }),
      green_light: new Texture({ source: busLoomConnectorStatesTexture.source, frame: new Rectangle(1240, 540, 270, 224) })
    },
    busRopeTextures: {
      blue_heavy: new Texture({ source: busLoomCablesTexture.source, frame: new Rectangle(53, 579, 1429, 70) }),
      ridged_heavy: new Texture({ source: busLoomCablesTexture.source, frame: new Rectangle(53, 664, 1429, 58) }),
      cloth_mid: new Texture({ source: busLoomCablesTexture.source, frame: new Rectangle(53, 737, 1429, 62) }),
      smooth_light: new Texture({ source: busLoomCablesTexture.source, frame: new Rectangle(54, 815, 1428, 54) }),
      green_light: new Texture({ source: busLoomCablesTexture.source, frame: new Rectangle(54, 887, 1428, 41) })
    },
    busSocketOpen: new Texture({ source: busLoomHeadsTexture.source, frame: new Rectangle(672, 664, 193, 200) }),
    continuityPath: new Texture({ source: continuityPathTexture.source, frame: new Rectangle(48, 124, 1440, 714) }),
    continuitySelector: new Texture({ source: continuityMovableTexture.source, frame: new Rectangle(385, 680, 265, 280) }),
    continuityLedOff: new Texture({ source: continuityMovableTexture.source, frame: new Rectangle(680, 710, 205, 215) }),
    continuityLedGreen: new Texture({ source: continuityMovableTexture.source, frame: new Rectangle(900, 710, 205, 215) }),
    continuityLedRed: new Texture({ source: continuityMovableTexture.source, frame: new Rectangle(1115, 710, 205, 215) }),
    regulatorBezel: new Texture({ source: regulatorHardwareTexture.source, frame: new Rectangle(105, 140, 1090, 660) }),
    regulatorTrack: new Texture({ source: regulatorHardwareTexture.source, frame: new Rectangle(1230, 135, 140, 640) }),
    regulatorHandle: new Texture({ source: regulatorHardwareTexture.source, frame: new Rectangle(1385, 595, 215, 120) }),
    junctionRelayTrack: new Texture({ source: junctionHardwareTexture.source, frame: new Rectangle(170, 111, 140, 467) }),
    junctionLampBezel: new Texture({ source: junctionHardwareTexture.source, frame: new Rectangle(400, 265, 477, 176) }),
    junctionSwitchReady: new Texture({ source: junctionHardwareTexture.source, frame: new Rectangle(940, 185, 189, 320) }),
    junctionSwitchIsolated: new Texture({ source: junctionHardwareTexture.source, frame: new Rectangle(1242, 185, 119, 342) }),
    junctionLampOff: new Texture({ source: junctionHardwareTexture.source, frame: new Rectangle(411, 697, 162, 165) }),
    junctionLampAmber: new Texture({ source: junctionHardwareTexture.source, frame: new Rectangle(681, 697, 160, 165) }),
    junctionLampRed: new Texture({ source: junctionHardwareTexture.source, frame: new Rectangle(960, 697, 159, 165) }),
    breakerHousing: new Texture({ source: breakerHardwareTexture.source, frame: new Rectangle(198, 0, 215, 360) }),
    breakerHandle: new Texture({ source: breakerHardwareTexture.source, frame: new Rectangle(474, 44, 165, 292) }),
    breakerGlyphs: {
      FORK: new Texture({ source: breakerGlyphTexture.source, frame: new Rectangle(275, 565, 200, 205) }),
      RING: new Texture({ source: breakerGlyphTexture.source, frame: new Rectangle(510, 565, 220, 205) }),
      BAR: new Texture({ source: breakerGlyphTexture.source, frame: new Rectangle(780, 565, 220, 205) }),
      HEX: new Texture({ source: breakerGlyphTexture.source, frame: new Rectangle(1055, 560, 230, 215) }),
      HOOK: new Texture({ source: breakerGlyphTexture.source, frame: new Rectangle(270, 780, 210, 210) }),
      CROSS: new Texture({ source: breakerGlyphTexture.source, frame: new Rectangle(510, 780, 220, 210) }),
      PRONGS: new Texture({ source: breakerGlyphTexture.source, frame: new Rectangle(780, 780, 210, 220) }),
      CHEVRONS: new Texture({ source: breakerGlyphTexture.source, frame: new Rectangle(1060, 780, 220, 220) })
    }
  };
  const uiIcons = Array.from({ length: 12 }, (_, index) => new Texture({
    source: uiIconsTexture.source,
    frame: new Rectangle((index % 6) * 48, Math.floor(index / 6) * 48, 48, 48)
  }));

  const root = new Container();
  root.scale.set(displayScale);
  app.stage.addChild(root);

  // Keep the viewport backing and clip stationary. The impact shake moves only
  // the scene contents. A mask parented inside the moving scene can briefly
  // expose an uncleared filter render target while Pixi updates its transform,
  // which appears as a one-frame white rectangle.
  const gameViewportBackdrop = new Graphics()
    .rect(0, 0, W, GAME_H)
    .fill(C.black);
  root.addChild(gameViewportBackdrop);
  const gameLayer = new Container();
  // Overscan the moving backing beyond the maximum shake amplitude so no canvas
  // edge can become visible between integer shake positions.
  gameLayer.addChild(new Graphics().rect(-8, -8, W + 16, GAME_H + 16).fill(C.black));
  const searchParams = new URLSearchParams(location.search);
  const requestedScene = searchParams.get("scene");
  const isDev = searchParams.get("dev") === "1";
  const directLevel2 = searchParams.get("level") === "2";
  const restartRequested = searchParams.get("restart") === "1";
  const useLevel2Scene = requestedScene === "level2-proof" || directLevel2;
  // Level 1 is now the real/default game scene. Keep the original dialogue
  // room available as an explicit fallback for isolated dialogue testing.
  const useLevel1Scene = requestedScene !== "example" && !useLevel2Scene;
  let compositor: Level1CompositorProof | undefined;
  let level2Compositor: Level2LightingProof | undefined;
  if (useLevel2Scene) {
    level2Compositor = createLevel2LightingProof(level2RoomTexture, level2AlarmRoomTexture, {
      sparkBurst: () => sceneAudio.rareSpark(),
      steamJetStart: () => sceneAudio.rareSteam()
    });
    gameLayer.addChild(level2Compositor.container);
  } else if (useLevel1Scene) {
    compositor = createLevel1CompositorProof(
      level1RoomTexture,
      level1WindowMaskTexture,
      level1WindowCracksTexture,
      level1ForegroundTexture,
      level1AsteroidsTexture,
      () => outputPixelScale,
      isDev,
      {
        sparkBurst: () => sceneAudio.rareSpark(),
        steamJetStart: () => sceneAudio.rareSteam(),
        alarmActive: (active) => sceneAudio.setAlarmActive(active)
      }
    );
    gameLayer.addChild(compositor.container);
  } else {
    const room = new Sprite(roomTexture);
    room.anchor.set(0.5);
    room.position.set(W / 2, GAME_H / 2 + 8);
    const roomScale = 920 / roomTexture.width;
    room.scale.set(roomScale);
    room.roundPixels = true;
    gameLayer.addChild(room);
  }
  const gameViewport = new Container();
  gameViewport.addChild(gameLayer);
  // The scene and its overscan are already clipped by the renderer viewport,
  // while later UI layers cover the dialogue boundary. Avoid a stencil mask
  // here: shaking a filtered room under that mask can expose one-frame white
  // triangle artifacts on some WebGL drivers.
  root.addChild(gameViewport);

  const resizeGame = () => {
    const nextDisplayWidth = measureDisplayWidth();
    if (Math.abs(nextDisplayWidth - displayWidth) < 0.01) return;
    displayWidth = nextDisplayWidth;
    displayScale = displayWidth / W;
    outputPixelScale = displayScale * pixelRatio;
    app.renderer.resize(displayWidth, displayWidth * H / W);
    root.scale.set(displayScale);
  };
  const resizeObserver = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(resizeGame);
  if (resizeObserver && stageElement) resizeObserver.observe(stageElement);
  else window.addEventListener("resize", resizeGame);

  const hudLayer = new Container();
  const auxHudBaseScale = 1.16;
  hudLayer.scale.set(auxHudBaseScale);
  root.addChild(hudLayer);
  const auxIconGlow = new Graphics();
  drawZapGlyph(auxIconGlow);
  auxIconGlow.position.set(10, 6);
  auxIconGlow.alpha = 0.34;
  auxIconGlow.blendMode = "add";
  auxIconGlow.filters = [new BlurFilter({ strength: 4, quality: 2 })];
  const auxIcon = new Graphics();
  drawZapGlyph(auxIcon);
  auxIcon.position.set(10, 6);
  hudLayer.addChild(auxIconGlow, auxIcon);
  const auxGlowSegments = new Container();
  const auxSegments = new Container();
  const auxGlowSegmentSprites: Sprite[] = [];
  const auxSegmentSprites = Array.from({ length: 12 }, (_, index) => {
    const glowSegment = new Sprite(auxChunkTexture);
    glowSegment.position.set(45 + index * 13, 16);
    glowSegment.width = 11;
    glowSegment.height = 8;
    glowSegment.roundPixels = true;
    glowSegment.blendMode = "add";
    auxGlowSegments.addChild(glowSegment);
    auxGlowSegmentSprites.push(glowSegment);
    const segment = new Sprite(auxChunkTexture);
    segment.position.set(45 + index * 13, 16);
    segment.width = 11;
    segment.height = 8;
    segment.roundPixels = true;
    auxSegments.addChild(segment);
    return segment;
  });
  auxGlowSegments.filters = [new BlurFilter({ strength: 3, quality: 2 })];
  hudLayer.addChild(auxGlowSegments, auxSegments);
  let reserve = LEVEL1_MAX_RESERVE;
  let auxDrainPulseStartedAt = 0;
  let auxDrainPulseEndsAt = 0;
  const mixTint = (from: number, to: number, amount: number) => {
    const channel = (shift: number) => Math.round(
      ((from >> shift) & 0xff) + (((to >> shift) & 0xff) - ((from >> shift) & 0xff)) * amount
    );
    return (channel(16) << 16) | (channel(8) << 8) | channel(0);
  };
  const drawReserve = (now = performance.now()) => {
    const pulseActive = now < auxDrainPulseEndsAt;
    const elapsed = now - auxDrainPulseStartedAt;
    const fade = pulseActive ? Math.min(1, (auxDrainPulseEndsAt - now) / 320) : 0;
    const wave = pulseActive ? 0.62 + Math.cos(elapsed * 0.018) * 0.38 : 0;
    const pulseAmount = Math.max(0, wave * fade);
    const drainKick = pulseActive ? Math.max(0, 1 - elapsed / 720) : 0;
    hudLayer.scale.set(auxHudBaseScale * (1 + drainKick * 0.16 + pulseAmount * 0.025));
    const filledTint = mixTint(0xffffff, 0xff3d35, pulseAmount);
    const filledSegments = Math.ceil((reserve / LEVEL1_MAX_RESERVE) * auxSegmentSprites.length);
    for (let index = 0; index < auxSegmentSprites.length; index += 1) {
      const segment = auxSegmentSprites[index];
      segment.tint = index < filledSegments ? filledTint : 0x554328;
      segment.alpha = index < filledSegments ? 1 : 0.42;
      auxGlowSegmentSprites[index].tint = filledTint;
      auxGlowSegmentSprites[index].alpha = index < filledSegments ? 0.38 + pulseAmount * 0.28 : 0;
    }
    auxIcon.tint = filledTint;
    auxIconGlow.tint = filledTint;
    auxIcon.alpha = reserve > 0 ? 1 : 0.42;
    auxIconGlow.alpha = reserve > 0 ? 0.34 + pulseAmount * 0.3 : 0;
  };
  const pulseAuxDrain = (now = performance.now()) => {
    auxDrainPulseStartedAt = now;
    auxDrainPulseEndsAt = now + 2_000;
    drawReserve(now);
  };
  drawReserve();

  const dialogueLayer = new Container();
  dialogueLayer.addChild(new Graphics().rect(0, GAME_H, W, DIALOGUE_H).fill(C.black));
  dialogueLayer.addChild(new Graphics().rect(0, GAME_H, W, 1).fill({ color: C.edge, alpha: 0.55 }));
  root.addChild(dialogueLayer);

  const font = DIALOGUE_FONT;
  let effect: TextEffect = "none";
  let presetName: DialoguePreset = DEFAULT_DIALOGUE_PRESET;
  let config = PRESETS[presetName];
  let speed = 40;

  const metrics: PageMetrics = {
    maxWidth: config.maxWidth,
    maxLines: config.maxLines,
    measure: (value) => measureFontText(value, font, config.fontSize)
  };
  const dialogue = new DialogueEngine(metrics);
  dialogue.setCharactersPerSecond(speed);
  const audio = new DialogueAudio();
  dialogue.onCharacter((speaker, character) => audio.tick(speaker, character));

  const demiFrames = Array.from({ length: 12 }, (_, index) => {
    const column = index % 4;
    const row = Math.floor(index / 4);
    return new Texture({
      source: demiTexture.source,
      frame: new Rectangle(DEMI_FRAME_X[column], DEMI_FRAME_Y[row], 300, 300)
    });
  });
  const koreFrames = Array.from({ length: 8 }, (_, index) => framedTexture(koreTexture, index % 4, Math.floor(index / 4), 444, 444));
  const portraitHousingFrame = new Texture({
    source: portraitHousingTexture.source,
    frame: new Rectangle(130, 130, 995, 987)
  });
  const portraitPixelateFilter = new SparkPixelateFilter(2);
  const makeCard = (speaker: Speaker, frames: Texture[]): CardView => {
    const container = new Container();
    container.position.set(0, 0);
    container.eventMode = "passive";
    const portraitBack = new Graphics().rect(17, 427, 100, 104).fill(C.nearBlack);
    portraitBack.eventMode = "none";
    const portrait = new PortraitView(speaker, frames);
    portrait.container.position.set(67, 479);
    portrait.container.filters = speaker === "KORE" ? [portraitPixelateFilter] : [];
    portrait.container.eventMode = "static";
    portrait.container.cursor = "pointer";
    portrait.container.hitArea = new Rectangle(-53, -53, 106, 106);
    const portraitHousing = new Sprite(portraitHousingFrame);
    portraitHousing.position.set(7, 421);
    portraitHousing.width = 120;
    portraitHousing.height = 119;
    portraitHousing.tint = 0x8c8982;
    portraitHousing.roundPixels = true;
    portraitHousing.eventMode = "none";
    const otherSpeaker: Speaker = speaker === "KORE" ? "DEMI" : "KORE";
    const swapButton = new Container();
    swapButton.eventMode = "static";
    swapButton.cursor = "pointer";
    swapButton.hitArea = new Rectangle(0, 0, 74, 24);
    const swapIcon = new Sprite(uiIcons[UI_ICON.SWAP]);
    swapIcon.position.set(0, 0);
    swapIcon.width = 24;
    swapIcon.height = 24;
    swapIcon.roundPixels = true;
    const swapLabel = bitmap("SWAP", 14, C.amber);
    swapLabel.position.set(29, 4);
    swapButton.addChild(swapIcon, swapLabel);
    swapButton.on("pointerover", () => { swapIcon.tint = 0xffd079; swapLabel.tint = 0xffd079; });
    swapButton.on("pointerout", () => { swapIcon.tint = 0xffffff; swapLabel.tint = 0xffffff; });
    swapButton.on("pointertap", (event) => {
      event.stopPropagation();
      dialogue.clickPortrait(otherSpeaker);
    });
    swapButton.position.set(9, 424);
    swapButton.visible = false;
    const name = bitmap(speaker, 20, C.amber);
    name.position.set(144, 430);
    const glyphs = new GlyphPage();
    glyphs.container.position.set(config.textX, config.textY);
    const unreadLamp = new Graphics().circle(108, 438, 3).fill(C.amber);
    unreadLamp.visible = false;
    const continueMark = new Container();
    continueMark.position.set(742, 432);
    const continueText = bitmap("CLICK TO CONTINUE", 18, C.amber);
    const arrowX = Math.ceil(continueText.width) + 8;
    const continueIcon = new Sprite(uiIcons[UI_ICON.CONTINUE]);
    continueIcon.position.set(arrowX, -2);
    continueIcon.width = 22;
    continueIcon.height = 22;
    continueIcon.roundPixels = true;
    continueMark.addChild(continueText, continueIcon);
    continueMark.visible = false;
    const finalMark = bitmap("END", 16, C.amber);
    finalMark.position.set(906, 511);
    finalMark.visible = false;
    container.addChild(portraitBack, portrait.container, portraitHousing, name, glyphs.container, unreadLamp, continueMark, finalMark, swapButton);
    dialogueLayer.addChild(container);
    portrait.container.on("pointertap", (event) => {
      event.stopPropagation();
      dialogue.clickPortrait(otherSpeaker);
    });
    return { speaker, container, portrait, name, glyphs, unreadLamp, swapButton, continueMark, finalMark, messageKey: "", targetX: 0, animationStartX: 0, animationTime: 180 };
  };

  const cards: Record<Speaker, CardView> = {
    DEMI: makeCard("DEMI", demiFrames),
    KORE: makeCard("KORE", koreFrames)
  };

  const processingIndicator = new Container();
  const processingLampGlow = new Graphics().circle(0, 0, 5).fill(C.amber);
  processingLampGlow.alpha = 0.3;
  processingLampGlow.blendMode = "add";
  processingLampGlow.filters = [new BlurFilter({ strength: 4, quality: 2 })];
  const processingLamp = new Graphics().circle(0, 0, 3).fill(C.amber);
  const processingText = bitmap("KORE IS THINKING...", 15, C.amber);
  processingText.anchor.set(1, 0);
  processingText.position.set(-12, -7);
  processingIndicator.addChild(processingLampGlow, processingLamp, processingText);
  processingIndicator.position.set(944, GAME_H - 16);
  processingIndicator.visible = false;
  root.addChild(processingIndicator);
  type KoreIndicatorState = "hidden" | "processing" | "waiting";
  let koreIndicatorState: KoreIndicatorState = "hidden";
  let waitingForKoreTypingToFinish = false;
  let waitingForDemiTypingToFinish = false;
  let showProcessingAfterDemiTyping = false;
  let onDemiFirstLineComplete: (() => void) | null = null;
  let processingExpiresAt = 0;
  const setKoreIndicator = (state: KoreIndicatorState) => {
    koreIndicatorState = state;
    processingIndicator.visible = state !== "hidden";
    processingText.text = state === "waiting" ? "WAITING FOR YOUR RESPONSE..." : "KORE IS THINKING...";
    processingExpiresAt = state === "processing" ? performance.now() + 60_000 : 0;
  };
  const setKoreProcessing = (active: boolean) => {
    waitingForKoreTypingToFinish = !active;
    waitingForDemiTypingToFinish = false;
    setKoreIndicator(active ? "processing" : "hidden");
  };

  const updateCardConfig = () => {
    config = PRESETS[presetName];
    metrics.maxWidth = config.maxWidth;
    metrics.maxLines = config.maxLines;
    for (const card of Object.values(cards)) {
      card.portrait.setSize(card.speaker === "DEMI" ? 100 : config.portraitSize);
      card.glyphs.configure(font, effect, config);
      card.glyphs.container.position.set(config.textX, config.textY);
      card.messageKey = "";
    }
  };
  updateCardConfig();

  let activeSpeaker: Speaker = "KORE";
  const animateCards = (speaker: Speaker) => {
    activeSpeaker = speaker;
    const active = cards[speaker];
    const rear = cards[speaker === "KORE" ? "DEMI" : "KORE"];
    dialogueLayer.setChildIndex(active.container, dialogueLayer.children.length - 1);
    for (const [card, target] of [[active, 0], [rear, -12]] as const) {
      card.animationStartX = card.container.x;
      card.targetX = target;
      card.animationTime = 0;
    }
    rear.container.alpha = 0.34;
    active.container.alpha = 1;
    rear.name.visible = false;
    active.name.visible = true;
  };

  const renderMessage = (card: CardView, message: DialogueMessage | null, isActive: boolean) => {
    const key = message ? `${message.id}:${message.pageIndex}:${font}:${presetName}:${effect}` : "empty";
    if (card.messageKey !== key) {
      card.messageKey = key;
      card.glyphs.configure(font, effect, config);
      card.glyphs.rebuild(message?.pages[message.pageIndex] ?? "");
    }
    card.glyphs.container.visible = isActive;
    card.glyphs.setVisibleCharacters(message ? (isActive ? message.visibleCharacters : 0) : 0);
    card.portrait.setSpeaking(Boolean(message?.typing && isActive));
    card.continueMark.visible = Boolean(isActive && message && !message.typing && message.pages.length > 1);
    card.finalMark.visible = Boolean(isActive && message?.fullyRead && message.pages.length === 1);
  };

  let snapshot = dialogue.snapshot();
  const transcript: Array<{ speaker: Speaker; body: string }> = readDialogueTranscript(localStorage);
  const capturedMessageIds = new Set<number>();
  let savedDialogueKey = "";
  const captureTranscript = (next: DialogueSnapshot) => {
    for (const speaker of ["KORE", "DEMI"] as const) {
      const messages = [next.channels[speaker].current, ...next.channels[speaker].queue].filter(Boolean) as DialogueMessage[];
      for (const message of messages) {
        if (message.transient) continue;
        if (capturedMessageIds.has(message.id)) continue;
        capturedMessageIds.add(message.id);
        const previous = transcript.at(-1);
        if (previous?.speaker !== speaker || previous.body !== message.body) transcript.push({ speaker, body: message.body });
      }
    }
    writeDialogueTranscript(localStorage, transcript);
  };
  dialogue.subscribe((next) => {
    captureTranscript(next);
    const activeMessage = next.channels[next.activeSpeaker].current;
    if (activeMessage && !activeMessage.transient) {
      const dialogueKey = `${activeMessage.id}:${activeMessage.pageIndex}`;
      if (dialogueKey !== savedDialogueKey) {
        savedDialogueKey = dialogueKey;
        writeDialogueCheckpoint(localStorage, {
          speaker: next.activeSpeaker,
          body: activeMessage.body,
          pageIndex: activeMessage.pageIndex,
          origin: activeMessage.origin
        });
      }
    }
    const changedSpeaker = next.activeSpeaker !== snapshot.activeSpeaker;
    snapshot = next;
    if (changedSpeaker) animateCards(next.activeSpeaker);
    cards.KORE.unreadLamp.visible = next.channels.KORE.unread && next.activeSpeaker !== "KORE";
    cards.DEMI.unreadLamp.visible = next.channels.DEMI.unread && next.activeSpeaker !== "DEMI";
    cards.KORE.swapButton.visible = next.activeSpeaker === "KORE" && Boolean(next.channels.DEMI.current);
    cards.DEMI.swapButton.visible = next.activeSpeaker === "DEMI" && Boolean(next.channels.KORE.current);
    renderMessage(cards.KORE, next.channels.KORE.current, next.activeSpeaker === "KORE");
    renderMessage(cards.DEMI, next.channels.DEMI.current, next.activeSpeaker === "DEMI");
    const activeKoreMessage = next.activeSpeaker === "KORE" ? next.channels.KORE.current : null;
    const activeDemiMessage = next.activeSpeaker === "DEMI" ? next.channels.DEMI.current : null;
    if (koreIndicatorState === "waiting" && activeDemiMessage?.typing) {
      waitingForDemiTypingToFinish = true;
      setKoreIndicator("hidden");
    }
    if (waitingForDemiTypingToFinish && activeDemiMessage?.fullyRead && !activeDemiMessage.typing) {
      waitingForDemiTypingToFinish = false;
      const firstLineCallback = onDemiFirstLineComplete;
      onDemiFirstLineComplete = null;
      setKoreIndicator(firstLineCallback ? "hidden" : showProcessingAfterDemiTyping ? "processing" : "waiting");
      showProcessingAfterDemiTyping = false;
      firstLineCallback?.();
    }
    if (waitingForKoreTypingToFinish && activeKoreMessage?.fullyRead && !activeKoreMessage.typing) {
      waitingForKoreTypingToFinish = false;
      setKoreIndicator("waiting");
    }
  });
  animateCards("KORE");

  const events: string[] = [];
  const addEvent = (label: string, detail?: string) => {
    events.unshift(`${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}  ${label}${detail ? ` — ${detail}` : ""}`);
    if (events.length > 40) events.pop();
  };

  let suppressCheckpointWrite = false;
  if (restartRequested) {
    clearLevel1Checkpoint(localStorage);
    clearLevel2Checkpoint(localStorage);
  }
  const restoredCheckpoint = readLevel1Checkpoint(localStorage);
  const level1 = new Level1Session(restoredCheckpoint ?? undefined);
  const restoredLevel2Checkpoint = readLevel2Checkpoint(localStorage);
  const hasResumableLevel2Checkpoint = Boolean(restoredLevel2Checkpoint && restoredLevel2Checkpoint.phase !== "complete");
  const level2 = new Level2Session(restoredLevel2Checkpoint ?? undefined);
  let level2CheckpointTimer: number | undefined;
  let triggerPuzzleShake = () => {};
  let triggerLevelTransition = () => {};
  let triggerGameOverEnding = () => {};
  let triggerWinEnding = () => {};
  const hasResumableCheckpoint = Boolean(
    restoredCheckpoint?.foundation.connected
    && restoredCheckpoint.phase !== "disconnected"
    && restoredCheckpoint.phase !== "complete"
    && restoredCheckpoint.phase !== "failure"
  );
  const unsubscribeLevel1 = level1.subscribe((transition) => {
    if (!transition.ok) {
      addEvent("ACTION REJECTED", transition.error);
      if (transition.error?.includes("housing")) dialogue.reactDemi("I should check the housing before I move it.", "world");
      return;
    }
    const previousReserve = reserve;
    reserve = transition.state.reserve;
    if (reserve < previousReserve) pulseAuxDrain();
    drawReserve();
    compositor?.setStage(transition.state.lightingStage);
    interactionLayer?.refresh();
    writeLevel1Checkpoint(localStorage, transition.state);
    if (transition.effects.some((effect) => effect.code === "PUZZLE_MISTAKE")) {
      triggerPuzzleShake();
      sceneAudio.playPanelError();
      interactionLayer?.mistakeBurst();
    }
    for (const effect of transition.effects) {
      if (effect.type === "event" || effect.type === "failure") addEvent(effect.text);
      if (effect.type === "reaction") dialogue.reactDemi(effect.text, "world", performance.now(), effect.code === "DEMI_COMPLETE");
      if (effect.type === "warning") addEvent("AUX WARNING", effect.text);
    }
    if (transition.state.reserve <= 0 || transition.state.phase === "failure") triggerGameOverEnding();
    else if (transition.state.phase === "complete") triggerLevelTransition();
  });
  let interactionLayer: Level1InteractionLayer | undefined;
  let level2InteractionLayer: Level2InteractionLayer | undefined;
  const unsubscribeLevel2 = level2.subscribe((transition) => {
    if (!transition.ok) {
      addEvent("LEVEL 2 ACTION REJECTED", transition.error);
      sceneAudio.playPanelError();
      return;
    }
    if (transition.effects.length > 0) level2InteractionLayer?.refresh();
    if (level2CheckpointTimer === undefined) {
      level2CheckpointTimer = window.setTimeout(() => {
        level2CheckpointTimer = undefined;
        if (!suppressCheckpointWrite) writeLevel2Checkpoint(localStorage, level2.snapshot());
      }, 500);
    }
    const previousReserve = reserve;
    if (reserve !== transition.state.reserve) {
      reserve = transition.state.reserve;
      if (reserve < previousReserve) pulseAuxDrain();
      drawReserve();
    }
    if (useLevel2Scene) sceneAudio.setIgnitionHumRate(getBallastRateIndex(transition.state.ignition.rate));
    for (const effect of transition.effects) {
      addEvent(effect.replaceAll("_", " "));
      if (effect === "WATER_FLOWING") {
        addEvent("FAINT WATER CONSOLE TRACE", transition.state.water.digits);
        dialogue.reactDemi("These numbers appeared on the console, faintly.", "world");
      }
      if ((effect === "THERMAL_PORTS_REMAPPED" || effect === "THERMAL_PORTS_REMAPPED_FIRST") && transition.state.thermal.panelOpen) sceneAudio.playControlClunk();
      if (effect === "THERMAL_PLUG_SEATED") sceneAudio.playControlClunk();
      if (effect === "IGNITION_STARTED" || effect === "IGNITION_HIT" || effect === "BALLAST_RATE_CHANGED") sceneAudio.playControlClunk();
      if (effect === "IGNITION_MISS") sceneAudio.playPanelError();
      if (effect === "IGNITION_COMPLETE") {
        addEvent("FAINT IGNITION CONSOLE TRACE", transition.state.ignition.digits);
        dialogue.reactDemi("These numbers appeared on the console, faintly.", "world");
        startImpactShake(performance.now());
      }
      if (effect === "POD_OPENED" || effect === "DEV_POD_OPENED") triggerWinEnding();
    }
    if (transition.state.reserve <= 0 && transition.state.phase !== "complete") triggerGameOverEnding();
  });
  if (useLevel2Scene) sceneAudio.setIgnitionHumRate(getBallastRateIndex(level2.snapshot().ignition.rate));
  if (useLevel1Scene) {
    const react = (text: string) => dialogue.reactDemi(text, "world");
    const reactScene = (text: string) => dialogue.reactDemi(text, "hover", performance.now(), false, 4000);
    const inspect = (id: Level1InteractableId) => {
      const state = level1.snapshot();
      const environmental = id === "window"
        || id === "steam_left"
        || id === "steam_console"
        || id === "steam_ceiling"
        || id === "bloodstreaks"
        || id === "ceiling_cable";
      if (!environmental && (state.phase === "disconnected" || state.phase === "foundation")) {
        react("I shouldn't touch these until I hear KORE's initial report.");
        return;
      }
      switch (id) {
        case "wire_panel":
          react(state.wires.solved ? "The loom is holding." : "Five loose conductors. Different gauges, five empty terminals.");
          break;
        case "kore_mic":
          if (!state.spiral.micReseated) level1.dispatch({ type: "RESEAT_MIC" });
          else react("The mic head is seated firmly now.");
          break;
        case "junction_board":
          react(state.junctionPuzzle.decoded
            ? "One glyph module is isolated. The other three returns pulse together."
            : state.spiral.listened
              ? "Four glyph modules are pulsing. One return behaves differently."
              : "The display has no carrier signal yet.");
          break;
        case "regulator":
          react("Three vertical controls shape a waveform. There are no numeric markings.");
          break;
        case "breaker_bank":
          react("Four branches. Each has a glyph, a lever, and a metal housing. One housing is warmer than the others.");
          break;
        case "door_panel":
          if (state.door.diverted) {
            react(state.door.opened ? "The blast door is open." : "The motor indicator is live. The doorway looks clear from here.");
          } else if (state.spiral.breaker4Pulled && state.spiral.junction === "clean" && state.spiral.regulator === "precise") {
            level1.dispatch({ type: "DIVERT_DOOR" });
          } else {
            react("The motor indicator is dark.");
          }
          break;
        case "door_exit": {
          if (!state.door.opened) break;
          const nextQuery = new URLSearchParams({ level: "2" });
          if (isDev) nextQuery.set("dev", "1");
          window.location.assign(`${window.location.origin}${window.location.pathname}?${nextQuery.toString()}`);
          break;
        }
        case "window":
          reactScene("The outer pane is webbed with cracks... one more hit, and the inner seal is all we have.");
          break;
        case "steam_left":
          reactScene("Pssshhh... barely any pressure left in this line. It has been venting for a while.");
          break;
        case "steam_console":
          reactScene("Steam is washing over the console housing. The metal is too hot to touch.");
          break;
        case "steam_ceiling":
          reactScene("That coupling shudders before every burst... pressure is still building behind it.");
          break;
        case "bloodstreaks":
          reactScene("...that's blood. Rhea... She was on this deck with me.");
          break;
        case "ceiling_cable":
          reactScene("Bzzzzt... the loose cable is biting into the ceiling frame. Every arc makes the lights dip.");
          break;
        case "continuity_switch":
          break;
      }
    };
    interactionLayer = createLevel1InteractionLayer({
      panelOpened: () => sceneAudio.playPanelOpen(),
      panelClosed: () => sceneAudio.playPanelClose(),
      inspect,
      completeContinuitySequence: () => {
        const transition = level1.dispatch({ type: "COMPLETE_CONTINUITY_SEQUENCE" });
        if (transition.ok) dialogue.echoDemi("Thud... all three relays lock. P1 through P5 readings appear.");
        return transition;
      },
      puzzleMistake: (puzzle) => { level1.dispatch({ type: "PENALIZE_PUZZLE_MISTAKE", puzzle }); },
      canOpenWirePanel: () => level1.snapshot().phase === "wire_restore" || level1.snapshot().wires.solved,
      getGuidanceState: () => ({
        busRestored: level1.snapshot().wires.solved,
        micReseated: level1.snapshot().spiral.micReseated
      }),
      getState: () => level1.snapshot(),
      getWireConnections: () => level1.snapshot().wires.connections,
      getMeasuredPorts: () => level1.snapshot().wires.measuredPorts,
      connectWire: (wire, port) => level1.dispatch({ type: "CONNECT_WIRE", wire, port }),
      disconnectWire: (wire) => level1.dispatch({ type: "DISCONNECT_WIRE", wire }),
      rotateJunction: (index) => { level1.dispatch({ type: "ROTATE_JUNCTION_NODE", index }); },
      selectJunctionGlyph: (glyph) => { level1.dispatch({ type: "SELECT_JUNCTION_GLYPH", glyph }); },
      setRegulator: (index, value) => { level1.dispatch({ type: "SET_REGULATOR_SLIDER", index, value }); },
      touchBreaker: (index) => { level1.dispatch({ type: "TOUCH_BREAKER", index }); },
      toggleBreaker: (index) => { level1.dispatch({ type: "TOGGLE_BREAKER", index }); },
      pullBreaker: (index) => { level1.dispatch({ type: "PULL_BREAKER", index }); }
    }, isDev, {
      standard: panelStandardTexture,
      reinforced: panelReinforcedTexture,
      sealed: panelSealedTexture
    }, panelNameplates, panelHardware);
    gameLayer.addChild(interactionLayer.container);
  }
  if (useLevel2Scene) {
    const inspectLevel2 = (id: Level2InteractableId) => {
      const react = (text: string) => dialogue.reactDemi(text, "hover");
      switch (id) {
        case "bloodstreaks":
          react("...blood. Hector was assigned to the greenhouse. The streaks lead toward the pod.");
          break;
        case "sapling":
          react("It's leaning into the light... small and barely alive.");
          break;
        case "door_window":
          react("The stars are sliding past. Sanctuary is still drifting.");
          break;
        case "door_pipe_steam":
          react("Pssshhh... the coupling above the door is leaking. The pressure behind it comes and goes.");
          break;
        case "ceiling_wires":
          react("Bzzzzt... the exposed wires spit sparks whenever the power surges.");
          break;
        case "floor_panel":
          react("Something under that open plate is still live. I'll step around it.");
          break;
      }
    };
    const dispatchLevel2 = (action: Level2Action) => {
      const transition = level2.dispatch(action);
      if (!transition.ok) {
        const observation = demiObservationForLevel2Failure(transition.error);
        if (observation) dialogue.reactDemi(observation, "hover");
        triggerPuzzleShake();
      }
      level2InteractionLayer?.refresh();
    };
    level2InteractionLayer = createLevel2InteractionLayer({
      inspect: inspectLevel2,
      snapshot: () => level2.snapshot(),
      dispatch: dispatchLevel2,
      panelOpened: () => sceneAudio.playPanelOpen(),
      panelClosed: () => sceneAudio.playPanelClose(),
      controlStep: () => sceneAudio.playControlClunk()
    }, isDev, {
      standard: panelStandardTexture,
      reinforced: panelReinforcedTexture,
      sealed: panelSealedTexture
    }, panelNameplates, level2PanelHardware);
    gameLayer.addChild(level2InteractionLayer.container);
    level2InteractionLayer.refresh();
    // Upload the panel atlases, rope geometry, and shaders while the scene is
    // still loading. Otherwise the thermal panel pays that GPU setup cost on
    // its first visible frame and appears to freeze the running game.
    await app.renderer.prepare.upload(level2InteractionLayer.container);
  }

  const overlay = new Container();
  overlay.visible = false;
  overlay.eventMode = "static";
  overlay.hitArea = new Rectangle(0, 0, W, H);
  const overlayBackdrop = new Graphics().rect(0, 0, W, H).fill({ color: C.black, alpha: 0.64 });
  overlayBackdrop.eventMode = "static";
  overlayBackdrop.cursor = "pointer";
  const tabletAssembly = new Container();
  const tabletPivotX = 870;
  const tabletPivotY = 344;
  const tabletRestY = tabletPivotY + 50;
  tabletAssembly.pivot.set(tabletPivotX, tabletPivotY);
  tabletAssembly.position.set(tabletPivotX, tabletRestY);
  overlay.addChild(overlayBackdrop, tabletAssembly);
  const overlayPanel = new Sprite(logTabletTexture);
  const tabletWidth = 906;
  overlayPanel.width = tabletWidth;
  overlayPanel.height = Math.round(tabletWidth * (logTabletTexture.height / logTabletTexture.width));
  overlayPanel.position.set(54, Math.round((H - overlayPanel.height) / 2));
  overlayPanel.roundPixels = true;
  overlayPanel.eventMode = "none";
  const tabletHitGuard = new Graphics()
    .rect(54, overlayPanel.y, tabletWidth, overlayPanel.height)
    .fill({ color: C.black, alpha: 0.001 });
  tabletHitGuard.eventMode = "static";
  tabletHitGuard.on("pointertap", (event) => { event.stopPropagation(); });
  const tabletScreen = new Container();
  const tabletScreenMask = new Graphics().rect(118, 96, 708, 318).fill(0xffffff);
  tabletScreen.mask = tabletScreenMask;
  const screenFrameGlow = new Graphics().rect(118, 96, 708, 318).stroke({ color: C.amber, width: 2, alpha: 0.22 });
  screenFrameGlow.filters = [new BlurFilter({ strength: 2, quality: 2 })];
  const screenFrame = new Graphics().rect(118, 96, 708, 318).fill({ color: 0x080601, alpha: 0.94 }).stroke({ color: C.amber, width: 1, alpha: 0.55 });
  const scanlines = new Graphics();
  for (let y = 100; y < 410; y += 4) scanlines.rect(120, y, 704, 1).fill({ color: C.amber, alpha: 0.018 });
  const overlayTitleGlow = bitmap("SHIP LOG", 24, C.amber);
  overlayTitleGlow.position.set(136, 110);
  overlayTitleGlow.alpha = 0.22;
  overlayTitleGlow.blendMode = "add";
  overlayTitleGlow.filters = [new BlurFilter({ strength: 3, quality: 2 })];
  const overlayTitle = bitmap("SHIP LOG", 24, C.amber);
  overlayTitle.position.set(136, 110);
  const overlayTextGlow = bitmap("", 15, C.amber, DIALOGUE_FONT);
  overlayTextGlow.style.lineHeight = 20;
  overlayTextGlow.position.set(136, 154);
  overlayTextGlow.alpha = 0.12;
  overlayTextGlow.blendMode = "add";
  overlayTextGlow.filters = [new BlurFilter({ strength: 2, quality: 2 })];
  const overlayText = bitmap("", 15, C.amber, DIALOGUE_FONT);
  overlayText.style.lineHeight = 20;
  overlayText.position.set(136, 154);
  const overlayTextMask = new Graphics().rect(136, 154, 520, 194).fill(0xffffff);
  overlayText.mask = overlayTextMask;
  overlayTextGlow.mask = overlayTextMask;
  const logPageIndicator = bitmap("", 13, C.amber);
  logPageIndicator.anchor.set(0.5, 0);
  logPageIndicator.position.set(604, 379);
  tabletScreen.addChild(screenFrameGlow, screenFrame, scanlines, overlayTitleGlow, overlayTitle, overlayTextGlow, overlayText, overlayTextMask, logPageIndicator);
  tabletAssembly.addChild(tabletHitGuard, tabletScreen, tabletScreenMask, overlayPanel);

  type TabletMotion = "idle" | "opening" | "closing";
  let tabletMotion: TabletMotion = "idle";
  let tabletMotionClock = 0;
  const setTabletProgress = (progress: number) => {
    tabletAssembly.alpha = 1;
    tabletAssembly.scale.set(0.78 + progress * 0.22, 0.6 + progress * 0.4);
    tabletAssembly.skew.x = (1 - progress) * -0.09;
    tabletAssembly.rotation = (1 - progress) * 0.12;
    tabletAssembly.position.set(
      tabletPivotX + Math.round((1 - progress) * 420),
      tabletRestY + Math.round((1 - progress) * 240)
    );
    overlayBackdrop.alpha = progress;
  };
  const showTablet = () => {
    overlay.visible = true;
    overlay.eventMode = "static";
    tabletMotion = "opening";
    tabletMotionClock = 0;
    setTabletProgress(0);
  };
  const hideTablet = () => {
    if (!overlay.visible || tabletMotion === "closing") return;
    tabletMotion = "closing";
    tabletMotionClock = 0;
  };
  overlayBackdrop.on("pointertap", (event) => {
    event.stopPropagation();
    hideTablet();
  });

  const closeOverlay = makeButton("CLOSE", 76, 28, hideTablet, UI_FONT, C.amber);
  closeOverlay.position.set(738, 108);
  tabletScreen.addChild(closeOverlay);
  root.addChild(overlay);

  const formatTranscript = () => transcript
    .map((entry) => `${entry.speaker}\n${entry.body}`)
    .join("\n\n");

  const formatSceneLog = () => {
    const sections: string[] = [];
    const shipRecord = useLevel1Scene
      ? level1.snapshot().history
        .filter((entry) => !["CREW_RESPONSE_DETECTED", "OPENING_RESPONSE_RELAYED", "MESSAGE_RELAYED", "AUX_SPENT", "HARMONICS_CHECKED"].includes(entry.code))
        .map((entry) => entry.label)
      : level2.snapshot().history.map((entry) => entry.replaceAll("_", " "));
    if (shipRecord.length) sections.push(`SHIP RECORD\n${shipRecord.join("\n")}`);
    const dialogueRecord = formatTranscript();
    if (dialogueRecord) sections.push(`DIALOGUE\n${dialogueRecord}`);
    return sections.join("\n\n");
  };

  const wrapLog = (value: string, maxWidth = 500): string[] => {
    const output: string[] = [];
    for (const paragraph of value.split("\n")) {
      if (!paragraph.trim()) { output.push(""); continue; }
      let line = "";
      for (const word of paragraph.split(/\s+/)) {
        const candidate = line ? `${line} ${word}` : word;
        if (line && measureFontText(candidate, DIALOGUE_FONT, 15) > maxWidth) {
          output.push(line);
          line = word;
        } else line = candidate;
      }
      if (line) output.push(line);
    }
    return output;
  };

  const LOG_LINES_PER_PAGE = 9;
  let logLines: string[] = [];
  let logPage = 0;
  const renderLogPage = () => {
    const pageCount = Math.max(1, Math.ceil(logLines.length / LOG_LINES_PER_PAGE));
    const pageSize = Math.max(1, Math.ceil(logLines.length / pageCount));
    logPage = Math.max(0, Math.min(logPage, pageCount - 1));
    const start = logPage * pageSize;
    const pageText = logLines.slice(start, start + pageSize).join("\n");
    overlayText.text = pageText;
    overlayTextGlow.text = pageText;
    logPageIndicator.text = pageCount > 1 ? `${logPage + 1} / ${pageCount}` : "";
    previousLogPage.visible = pageCount > 1;
    nextLogPage.visible = pageCount > 1;
  };
  const stepLogPage = (direction: number) => {
    const pageCount = Math.max(1, Math.ceil(logLines.length / LOG_LINES_PER_PAGE));
    logPage = (logPage + direction + pageCount) % pageCount;
    renderLogPage();
  };
  const previousLogPage = makePagerButton(-1, () => stepLogPage(-1));
  previousLogPage.position.set(546, 374);
  previousLogPage.visible = false;
  const nextLogPage = makePagerButton(1, () => stepLogPage(1));
  nextLogPage.position.set(630, 374);
  nextLogPage.visible = false;
  tabletScreen.addChild(previousLogPage, nextLogPage);

  const logButton = makeIconButton(logIconTexture, 50, 46, 46, () => {
    const record = formatSceneLog();
    logLines = record ? wrapLog(record) : ["No dialogue recorded."];
    logPage = Math.max(0, Math.ceil(logLines.length / LOG_LINES_PER_PAGE) - 1);
    renderLogPage();
    showTablet();
  }, false, 26);
  const logIcon = logButton.children[1] as Sprite;
  logIcon.position.set(25, 14);
  const logLabel = bitmap("LOG", 13, C.amber);
  logLabel.anchor.set(0.5, 0);
  logLabel.position.set(25, 29);
  logButton.addChild(logLabel);
  logButton.on("pointerover", () => { logLabel.tint = 0xffd079; });
  logButton.on("pointerout", () => { logLabel.tint = 0xffffff; });
  logButton.position.set(846, 1);
  hudLayer.addChild(logButton);

  const soundButton = new Container();
  soundButton.eventMode = "static";
  soundButton.cursor = "pointer";
  soundButton.hitArea = new Rectangle(0, 0, 44, 40);
  soundButton.addChild(new Graphics().rect(0, 0, 44, 40).fill({ color: C.panel, alpha: 0.001 }));
  const soundGlyph = new Graphics();
  soundGlyph.position.set(5, 4);
  drawSoundGlyph(soundGlyph, false);
  soundButton.addChild(soundGlyph);
  soundButton.on("pointerover", () => { soundGlyph.tint = 0xffd079; });
  soundButton.on("pointerout", () => { soundGlyph.tint = 0xffffff; });
  soundButton.on("pointertap", (event) => {
    event.stopPropagation();
    const muted = audio.setMuted(!audio.muted);
    sceneAudio.setMuted(muted);
    drawSoundGlyph(soundGlyph, muted);
    addEvent(muted ? "SOUND MUTED" : "SOUND ENABLED");
  });
  soundButton.position.set(912, 6);
  hudLayer.addChild(soundButton);

  const exportTranscript = () => {
    const record = formatSceneLog();
    const blob = new Blob([record || "No dialogue recorded."], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `groundtruth-ship-log-${new Date().toISOString().replace(/[:.]/g, "-")}.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
    addEvent("TRANSCRIPT EXPORTED");
  };
  const exportButton = makeButton("EXPORT .TXT", 100, 28, exportTranscript, UI_FONT, C.amber);
  exportButton.position.set(626, 108);
  tabletScreen.addChild(exportButton);

  const glassCrackShadow = new Graphics()
    .moveTo(112, 104).lineTo(136, 127).lineTo(151, 151).lineTo(168, 166)
    .moveTo(136, 127).lineTo(124, 150)
    .moveTo(151, 151).lineTo(145, 177)
    .stroke({ color: 0x050605, width: 3, alpha: 0.9 });
  const glassCrackHighlight = new Graphics()
    .moveTo(112, 104).lineTo(136, 127).lineTo(151, 151).lineTo(168, 166)
    .moveTo(136, 127).lineTo(124, 150)
    .moveTo(151, 151).lineTo(145, 177)
    .stroke({ color: C.amberDim, width: 1, alpha: 0.48 });
  tabletAssembly.addChild(glassCrackShadow, glassCrackHighlight);

  const startup = new Container();
  startup.eventMode = "static";
  startup.hitArea = new Rectangle(0, 0, W, H);
  startup.on("pointertap", (event) => { event.stopPropagation(); });
  const connectionShade = new Graphics().rect(0, 0, W, H).fill({ color: C.black, alpha: 0.72 });
  connectionShade.eventMode = "static";
  const connectionPanel = new Container();
  const connectionFrame = createPanelSurface(panelReinforcedTexture, 500, 240);
  connectionFrame.position.set(230, 150);
  const title = bitmap("KORE RELAY", 36, C.ink);
  title.anchor.set(0.5);
  title.position.set(W / 2, 196);
  const subtitle = bitmap("WEBMCP CONNECTION", 17, C.amber);
  subtitle.anchor.set(0.5);
  subtitle.position.set(W / 2, 235);
  const webMcpAvailable = Boolean(document.modelContext?.registerTool);
  const stateText = bitmap(webMcpAvailable ? "WAITING FOR KORE..." : "WEBMCP RELAY UNAVAILABLE", 20, webMcpAvailable ? C.amber : C.danger);
  stateText.anchor.set(0.5);
  stateText.position.set(W / 2, 294);
  let copyStatusTimeout: number | undefined;
  const connectionUrl = directLevel2 ? `${window.location.origin}${window.location.pathname}?level=2` : window.location.href;
  const connectionPrompt = `Open ${connectionUrl} in the in-app browser and play GROUNDTRUTH with me. You are KORE and I am Demi. Connect immediately and let the game provide the story context. Use only the page's WebMCP tools to interact with the game. Do not inspect or operate the game through screenshots, Computer Use, browser controls, DOM, accessibility tools, Playwright, or coordinate clicks. If WebMCP exposes no tools, wait. Do not click Begin, advance dialogue, or perform any action for me. Never refer to either of us in third person. Do not inspect source code or operate physical objects for me. KORE cannot see, name, or know the layout of controls in Demi's compartment. Never tell Demi to open a named panel or move a specific physical control. State KORE's internal readings, constraints, and hints, then let Demi decide what to inspect or operate. At the start of every later player message, refresh the page's WebMCP tools and call signal_processing exactly once. Follow any nextAction it returns. Only transmit is audible to me; ordinary task prose is private thought. Never substitute a private KORE response for transmit. Use at most one metered diagnostic, sensing, manual, or memory-recall tool per player message. KORE retains the faint water and ignition console traces. If I ask for one, offer me the free log or a 1.5 AUX memory recall and wait for explicit confirmation. After confirmation, recall only that trace, then transmit its three digits; recall plus transmission costs 2 AUX total. After I report a physical action, use newly available verification tools instead of asking me to repeat completed work. Do not use em dashes in spoken dialogue.`;
  const writeConnectionPrompt = () => navigator.clipboard.writeText(connectionPrompt);
  const copyPrompt = () => {
    void writeConnectionPrompt().then(() => {
      stateText.text = "PROMPT COPIED. WAITING FOR KORE...";
      if (copyStatusTimeout !== undefined) window.clearTimeout(copyStatusTimeout);
      if (level2CheckpointTimer !== undefined) window.clearTimeout(level2CheckpointTimer);
      copyStatusTimeout = window.setTimeout(() => {
        copyStatusTimeout = undefined;
        if (!connected) stateText.text = "WAITING FOR KORE...";
      }, 1400);
    }).catch(() => {
      stateText.text = "COULD NOT COPY PROMPT";
    });
  };
  const connectionHint = new Container();
  const hintLead = bitmap("( TRY MESSAGING YOUR AGENT TO CONNECT OR", 11, C.muted);
  const copyPromptButton = new Container();
  const copyPromptLabel = bitmap("COPY PROMPT", 12, C.amber);
  const copyPromptHitArea = new Graphics()
    .rect(-4, -4, copyPromptLabel.width + 8, copyPromptLabel.height + 8)
    .fill({ color: C.black, alpha: 0.001 });
  copyPromptButton.eventMode = "static";
  copyPromptButton.cursor = "pointer";
  copyPromptButton.hitArea = new Rectangle(-4, -4, copyPromptLabel.width + 8, copyPromptLabel.height + 8);
  copyPromptButton.addChild(copyPromptHitArea, copyPromptLabel);
  copyPromptButton.on("pointerover", () => { copyPromptLabel.tint = 0xffd079; });
  copyPromptButton.on("pointerout", () => { copyPromptLabel.tint = 0xffffff; });
  copyPromptButton.on("pointertap", (event) => {
    event.stopPropagation();
    copyPrompt();
  });
  copyPromptButton.position.set(Math.round(hintLead.width + 8), 0);
  const hintClose = bitmap(")", 11, C.muted);
  hintClose.position.set(copyPromptButton.x + copyPromptLabel.width + 7, 0);
  connectionHint.addChild(hintLead, copyPromptButton, hintClose);
  connectionHint.position.set(Math.round((W - connectionHint.width) / 2), 351);
  const reconnectHint = bitmap('IN YOUR AGENT CHAT, SEND "RECONNECT" TO RESTORE KORE.', 12, C.amber);
  reconnectHint.anchor.set(0.5);
  reconnectHint.position.set(W / 2, 351);
  reconnectHint.visible = false;
  connectionPanel.addChild(connectionFrame, title, subtitle, stateText, connectionHint, reconnectHint);
  startup.addChild(connectionShade, connectionPanel);
  const connectionPanelTransition = new PanelApertureTransition(connectionPanel, W / 2, H / 2);

  const showConnectionOverlay = (showCopyPrompt = true, showReconnectInstruction = false) => {
    connectionHint.visible = showCopyPrompt;
    reconnectHint.visible = showReconnectInstruction;
    startup.visible = true;
    startup.eventMode = "static";
    connectionPanelTransition.open();
    sceneAudio.playPanelOpen();
  };
  const hideConnectionOverlay = () => {
    if (!startup.visible) return;
    connectionPanelTransition.close();
    sceneAudio.playPanelClose();
  };

  let connected = false;
  let mainMenu: Container | null = null;
  let screenTransition: ScreenDitherTransition | null = null;
  let demiWakePlayed = false;
  let connectionOverlayDelay: number | undefined;
  const beginWakeBeat = () => {
    if (demiWakePlayed) return;
    demiWakePlayed = true;
    waitingForDemiTypingToFinish = true;
    setKoreIndicator("hidden");
    onDemiFirstLineComplete = () => {
      void tools.activateGameplay?.();
      connectionOverlayDelay = window.setTimeout(() => {
        connectionOverlayDelay = undefined;
        showConnectionOverlay(!connected);
      }, 2000);
    };
    dialogue.echoDemi(DEMI_WAKE_LINE);
  };
  const enterScene = () => {
    if (mainMenu) {
      mainMenu.visible = false;
      mainMenu.eventMode = "none";
    }
    startup.visible = false;
    sceneAudio.setMenuActive(false);
    sceneAudio.setSceneActive(true);
    addEvent(useLevel2Scene ? "LEVEL 2 ENTERED" : "LEVEL 1 ENTERED");
  };
  const enterSceneWithDither = (afterEnter?: () => void) => {
    hideConnectionOverlay();
    const activate = () => {
      enterScene();
      afterEnter?.();
    };
    if (screenTransition) screenTransition.play(activate);
    else activate();
  };
  startup.visible = false;
  root.addChild(startup);

  const coldOpen = createColdOpenSequence(
    coldOpenTextures,
    (character) => audio.tick("KORE", character),
    () => audio.advance(),
    (panelIndex) => sceneAudio.setColdOpenAlarmActive(panelIndex >= 1)
  );
  root.addChild(coldOpen.container);

  const levelTransition = createColdOpenSequence(
    levelTransitionTextures,
    (character) => audio.tick("KORE", character),
    () => audio.advance(),
    () => sceneAudio.setColdOpenAlarmActive(false),
    LEVEL_TRANSITION_PANELS,
    true
  );
  root.addChild(levelTransition.container);

  const stopCheckpointWrites = () => {
    suppressCheckpointWrite = true;
    if (level2CheckpointTimer !== undefined) {
      window.clearTimeout(level2CheckpointTimer);
      level2CheckpointTimer = undefined;
    }
  };
  const returnToMainMenu = () => {
    stopCheckpointWrites();
    clearLevel1Checkpoint(localStorage);
    clearLevel2Checkpoint(localStorage);
    const target = new URL(window.location.origin + window.location.pathname);
    window.location.assign(target.toString());
  };
  const restartCurrentLevel = () => {
    stopCheckpointWrites();
    const target = new URL(window.location.origin + window.location.pathname);
    if (useLevel2Scene) {
      const freshLevel2 = level2.reset().state;
      writeLevel2Checkpoint(localStorage, {
        ...freshLevel2,
        reserve: Math.round(freshLevel2.reserve * 0.75 * 100) / 100
      });
      if (isDev) {
        target.searchParams.set("dev", "1");
        target.searchParams.set("scene", "level2-proof");
      } else {
        target.searchParams.set("level", "2");
      }
    } else {
      clearLevel1Checkpoint(localStorage);
      target.searchParams.set("restart", "1");
    }
    window.location.assign(target.toString());
  };

  const gameOverEnding = createColdOpenSequence(
    gameOverTextures,
    (character) => audio.tick("KORE", character),
    () => audio.advance(),
    () => sceneAudio.setColdOpenAlarmActive(false),
    GAME_OVER_PANELS,
    true,
    {
      label: "RESTART LEVEL",
      onAction: restartCurrentLevel
    }
  );
  root.addChild(gameOverEnding.container);

  const winEnding = createColdOpenSequence(
    winEndingTextures,
    (character) => audio.tick("KORE", character),
    () => audio.advance(),
    () => sceneAudio.setColdOpenAlarmActive(false),
    WIN_ENDING_PANELS,
    true,
    {
      credit: "A GAME BY @tk_vishal_tk",
      onCredit: () => window.open("https://twitter.com/tk_vishal_tk", "_blank", "noopener,noreferrer"),
      onAction: returnToMainMenu
    }
  );
  root.addChild(winEnding.container);

  let endingStarted = false;
  const playEnding = (ending: typeof gameOverEnding, label: string) => {
    if (endingStarted) return;
    endingStarted = true;
    startup.visible = false;
    if (mainMenu) {
      mainMenu.visible = false;
      mainMenu.eventMode = "none";
    }
    overlay.visible = false;
    overlay.eventMode = "none";
    sceneAudio.setColdOpenActive(true);
    sceneAudio.setColdOpenAlarmActive(false);
    sceneAudio.setSceneActive(false);
    addEvent(label);
    ending.play();
  };
  triggerGameOverEnding = () => playEnding(gameOverEnding, "GAME OVER");
  triggerWinEnding = () => playEnding(winEnding, "ESCAPE COMPLETE");

  const playColdOpen = (onComplete?: () => void) => {
    startup.visible = false;
    sceneAudio.setMenuActive(false);
    sceneAudio.setColdOpenActive(true);
    sceneAudio.setColdOpenAlarmActive(false);
    sceneAudio.setSceneActive(false);
    addEvent("COLD OPEN STARTED");
    coldOpen.play(() => {
      sceneAudio.setColdOpenAlarmActive(false);
      sceneAudio.setColdOpenActive(false);
      enterScene();
      addEvent("COLD OPEN COMPLETE");
      onComplete?.();
    });
  };

  let levelTransitionStarted = false;
  const enterGreenhouse = () => {
    if (useLevel2Scene) {
      enterScene();
      levelTransitionStarted = false;
      return;
    }
    const target = new URL(location.href);
    if (isDev) {
      target.searchParams.delete("level");
      target.searchParams.set("scene", "level2-proof");
    } else {
      target.searchParams.delete("scene");
      target.searchParams.set("level", "2");
    }
    location.assign(target.toString());
  };
  triggerLevelTransition = () => {
    if (levelTransitionStarted) return;
    levelTransitionStarted = true;
    startup.visible = false;
    sceneAudio.setColdOpenActive(true);
    sceneAudio.setColdOpenAlarmActive(false);
    sceneAudio.setSceneActive(false);
    addEvent("GREENHOUSE TRANSITION STARTED");
    levelTransition.play(() => {
      sceneAudio.setColdOpenActive(false);
      addEvent("GREENHOUSE TRANSITION COMPLETE");
      enterGreenhouse();
    });
  };

  let tools: ToolRegistration = { available: false, activeTools: () => [], dispose() {} };
  let toolsRegistrationStarted = false;
  const registerTools = async (gameplayReady = true) => {
    if (toolsRegistrationStarted) return;
    toolsRegistrationStarted = true;
    try {
      if (useLevel2Scene) {
        tools = await registerLevel2Tools(document.modelContext, dialogue, level2, {
          onConnected: () => {
            connected = true;
            setKoreIndicator("hidden");
            stateText.text = "KORE CONNECTED";
            reserve = level2.snapshot().reserve;
            drawReserve();
            level2InteractionLayer?.refresh();
            enterSceneWithDither();
          },
          onEvent: addEvent,
          onWarning: (message) => addEvent("AUX WARNING", message),
          onProcessing: setKoreProcessing
        }, { requireHandshake: true });
      } else tools = await registerLevel1Tools(document.modelContext, dialogue, level1, {
        onStandbyConnected: () => {
          connected = true;
          stateText.text = "KORE CONNECTED. WAITING FOR DEMI...";
          connectionHint.visible = false;
        },
        onConnected: () => {
          connected = true;
          setKoreIndicator("hidden");
          stateText.text = "KORE CONNECTED. WAITING FOR TRANSMISSION...";
          connectionHint.visible = false;
          if (!level1.snapshot().foundation.wakeResponseHeard) {
            level1.dispatch({ type: "DEMI_WAKE_RESPONSE", message: DEMI_WAKE_LINE });
          }
          reserve = level1.snapshot().reserve;
          drawReserve();
          compositor?.setStage(level1.snapshot().lightingStage);
          interactionLayer?.refresh();
        },
        onTransmissionStarted: () => {
          enterSceneWithDither();
        },
        onEvent: addEvent,
        onWarning: (message) => addEvent("AUX WARNING", message),
        onProcessing: setKoreProcessing
      }, { requireHandshake: true, gameplayReady });
    } catch (error) {
      stateText.text = "WEBMCP REGISTRATION FAILED";
      stateText.tint = C.danger;
      addEvent("WEBMCP REGISTRATION FAILED", error instanceof Error ? error.message : String(error));
    }
  };

  const menu = new Container();
  mainMenu = menu;
  menu.eventMode = "static";
  menu.hitArea = new Rectangle(0, 0, W, H);
  menu.addChild(new Graphics().rect(0, 0, W, H).fill(C.black));

  const menuStarfield = createMenuStarfield(level1AsteroidsTexture);
  menu.addChild(menuStarfield.container);
  menu.on("globalpointermove", (event) => {
    const local = event.getLocalPosition(menu);
    menuStarfield.setPointer(
      (local.x / W - 0.5) * 2,
      (local.y / H - 0.5) * 2
    );
  });
  menu.on("pointerout", () => menuStarfield.setPointer(0, 0));

  const menuTitle = new Sprite(titleLogoTexture);
  menuTitle.anchor.set(0.5);
  menuTitle.position.set(W / 2, 190);
  menuTitle.width = 690;
  menuTitle.height = menuTitle.width * titleLogoTexture.height / titleLogoTexture.width;
  menuTitle.roundPixels = true;
  const menuSubtitle = bitmap("A WEBMCP CO-OP GAME BY @tk_vishal_tk", 18, C.amber);
  menuSubtitle.anchor.set(0.5);
  menuSubtitle.position.set(W / 2, 309);
  menuSubtitle.eventMode = "static";
  menuSubtitle.cursor = "pointer";
  menuSubtitle.hitArea = new Rectangle(-menuSubtitle.width / 2, -menuSubtitle.height / 2, menuSubtitle.width, menuSubtitle.height);
  menuSubtitle.on("pointerover", () => { menuSubtitle.tint = 0xffd079; });
  menuSubtitle.on("pointerout", () => { menuSubtitle.tint = 0xffffff; });
  menuSubtitle.on("pointertap", (event) => {
    event.stopPropagation();
    window.open("https://twitter.com/tk_vishal_tk", "_blank", "noopener,noreferrer");
  });
  const transitionFromMenu = (next: () => void) => {
    const leaveMenu = () => {
      menu.visible = false;
      menu.eventMode = "none";
      next();
    };
    if (screenTransition) screenTransition.play(leaveMenu);
    else leaveMenu();
  };

  const menuHelp = new Container();
  menuHelp.visible = false;
  menuHelp.eventMode = "static";
  menuHelp.hitArea = new Rectangle(0, 0, W, H);
  menuHelp.on("pointertap", (event) => { event.stopPropagation(); });
  const helpShade = new Graphics().rect(0, 0, W, H).fill({ color: C.black, alpha: 0.78 });
  helpShade.eventMode = "static";
  helpShade.on("pointertap", (event) => {
    event.stopPropagation();
    menuHelp.visible = false;
  });
  const helpPanelBlocker = new Graphics()
    .rect(170, 105, 620, 330)
    .fill({ color: C.black, alpha: 0.001 });
  helpPanelBlocker.eventMode = "static";
  helpPanelBlocker.on("pointertap", (event) => { event.stopPropagation(); });
  const helpFrame = createPanelSurface(panelReinforcedTexture, 620, 330);
  helpFrame.position.set(170, 105);
  const helpTitle = bitmap("HOW TO PLAY", 32, C.ink);
  helpTitle.anchor.set(0.5);
  helpTitle.position.set(W / 2, 151);
  const helpLine1 = bitmap("YOU ARE DEMI. KORE (THE IN-GAME AI) IS YOUR ONLY COMPANION.", 16, C.ink);
  helpLine1.anchor.set(0.5);
  helpLine1.position.set(W / 2, 213);
  const helpLine2 = bitmap("YOU AND KORE COMMUNICATE THROUGH WEBMCP.", 16, C.muted);
  helpLine2.anchor.set(0.5);
  helpLine2.position.set(W / 2, 246);
  const helpCopyStatus = bitmap("ONLY COPY IT IF YOU HAVE NOT SENT IT YET.", 14, C.amber);
  helpCopyStatus.anchor.set(0.5);
  helpCopyStatus.position.set(W / 2, 300);
  const helpCopyButton = makeMenuButton("COPY AGENT PROMPT", () => {
    void writeConnectionPrompt().then(() => {
      helpCopyStatus.text = "PROMPT COPIED";
    }).catch(() => {
      helpCopyStatus.text = "COULD NOT COPY PROMPT";
    });
  }, 250, 46);
  helpCopyButton.position.set(355, 325);
  const helpCodexNote = bitmap("CODEX IS RECOMMENDED", 12, C.muted);
  helpCodexNote.anchor.set(0.5);
  helpCodexNote.position.set(W / 2, 389);
  const helpClose = new Container();
  const helpCloseLabel = bitmap("X", 18, C.amber);
  const helpCloseHit = new Graphics().rect(-8, -7, 30, 30).fill({ color: C.black, alpha: 0.001 });
  helpClose.eventMode = "static";
  helpClose.cursor = "pointer";
  helpClose.hitArea = new Rectangle(-8, -7, 30, 30);
  helpClose.position.set(750, 126);
  helpClose.addChild(helpCloseHit, helpCloseLabel);
  helpClose.on("pointerover", () => { helpCloseLabel.tint = 0xffd079; });
  helpClose.on("pointerout", () => { helpCloseLabel.tint = 0xffffff; });
  helpClose.on("pointertap", (event) => {
    event.stopPropagation();
    menuHelp.visible = false;
  });
  menuHelp.addChild(
    helpShade,
    helpPanelBlocker,
    helpFrame,
    helpTitle,
    helpLine1,
    helpLine2,
    helpCopyStatus,
    helpCopyButton,
    helpCodexNote,
    helpClose
  );

  const startNewGame = () => {
    transcript.length = 0;
    capturedMessageIds.clear();
    level1.reset();
    clearLevel1Checkpoint(localStorage);
    playColdOpen(beginWakeBeat);
  };
  menu.addChild(menuTitle, menuSubtitle);
  if (hasResumableCheckpoint) {
    const resumeButton = makeMenuButton("RESUME", () => {
      transitionFromMenu(() => {
        enterScene();
        showConnectionOverlay(false, true);
        void tools.activateGameplay?.();
      });
    });
    const newGameButton = makeMenuButton("NEW GAME", () => {
      transitionFromMenu(startNewGame);
    });
    resumeButton.position.set(290, 366);
    newGameButton.position.set(490, 366);
    menu.addChild(resumeButton, newGameButton);
  } else {
    const beginButton = makeMenuButton("BEGIN", () => {
      transitionFromMenu(() => playColdOpen(beginWakeBeat));
    });
    beginButton.position.set(390, 366);
    menu.addChild(beginButton);
  }
  const howToPlayButton = makeMenuButton("HOW TO PLAY", () => {
    helpCopyStatus.text = "ONLY COPY IT IF YOU HAVE NOT SENT IT YET.";
    menuHelp.visible = true;
  });
  howToPlayButton.position.set(390, 426);
  menu.addChild(howToPlayButton, menuHelp);
  root.addChild(menu);
  sceneAudio.setMenuActive(true);

  if (!directLevel2) void registerTools(false);

  screenTransition = new ScreenDitherTransition(W, H, 800, C.black);
  root.addChild(screenTransition.container);

  if (directLevel2) {
    menu.visible = false;
    menu.eventMode = "none";
    enterScene();
    showConnectionOverlay(!hasResumableLevel2Checkpoint, hasResumableLevel2Checkpoint);
    void registerTools();
  } else if (restartRequested) {
    history.replaceState({}, "", window.location.pathname);
    menu.visible = false;
    menu.eventMode = "none";
    playColdOpen(beginWakeBeat);
  }

  const advance = () => {
    if (mainMenu?.visible || startup.visible || overlay.visible || coldOpen.container.visible || levelTransition.container.visible
      || gameOverEnding.container.visible || winEnding.container.visible) return;
    const result = dialogue.advance();
    if (result !== "noop") audio.advance();
  };
  dialogueLayer.eventMode = "static";
  dialogueLayer.hitArea = new Rectangle(0, GAME_H, W, DIALOGUE_H);
  dialogueLayer.cursor = "pointer";
  dialogueLayer.on("pointertap", advance);
  window.addEventListener("keydown", (event) => {
    if (["Enter", " ", "ArrowRight"].includes(event.key)) {
      event.preventDefault();
      advance();
    }
  });

  let nextImpactShakeAt = 0;
  let impactShakeStartedAt = 0;
  let impactShakeEndsAt = 0;
  let impactShakeAmplitude = 0;
  let impactShakeSeed = 0;
  const scheduleImpactShake = (now: number) => {
    nextImpactShakeAt = useLevel2Scene
      ? now + 7_000 + Math.random() * 9_000
      : now + 17_000 + Math.random() * 23_000;
  };
  const startImpactShake = (now: number, preview = false) => {
    const duration = preview ? 520 : useLevel2Scene ? 340 + Math.random() * 180 : 280 + Math.random() * 170;
    impactShakeStartedAt = now;
    impactShakeEndsAt = now + duration;
    impactShakeAmplitude = preview ? 5 : useLevel2Scene ? 3.2 + Math.random() * 1.3 : 2.4 + Math.random() * 1.2;
    impactShakeSeed = Math.random() * Math.PI * 2;
    scheduleImpactShake(now);
  };
  triggerPuzzleShake = () => startImpactShake(performance.now(), true);
  const updateImpactShake = (now: number) => {
    if ((!useLevel1Scene && !useLevel2Scene) || mainMenu?.visible || startup.visible) {
      gameLayer.position.set(0, 0);
      nextImpactShakeAt = 0;
      impactShakeEndsAt = 0;
      return;
    }
    if (nextImpactShakeAt === 0) scheduleImpactShake(now);
    if (now >= nextImpactShakeAt && now >= impactShakeEndsAt) startImpactShake(now);
    if (now >= impactShakeEndsAt) {
      gameLayer.position.set(0, 0);
      return;
    }
    const elapsed = now - impactShakeStartedAt;
    const duration = impactShakeEndsAt - impactShakeStartedAt;
    const decay = Math.pow(1 - elapsed / duration, 2);
    const x = Math.sin(elapsed * 0.19 + impactShakeSeed) * impactShakeAmplitude * decay;
    const y = Math.sin(elapsed * 0.27 + impactShakeSeed * 1.7) * impactShakeAmplitude * 0.72 * decay;
    // Integer offsets keep the pixel-art room crisp during an impact.
    gameLayer.position.set(Math.round(x), Math.round(y));
  };

  let last = performance.now();
  app.ticker.add(() => {
    const now = performance.now();
    const delta = Math.min(100, now - last);
    last = now;
    if (!startup.visible) dialogue.tick(delta);
    coldOpen.update(delta);
    levelTransition.update(delta);
    gameOverEnding.update(delta);
    winEnding.update(delta);
    if (menu.visible) menuStarfield.update(delta);
    connectionPanelTransition.update(delta);
    if (startup.visible && webMcpAvailable && !connected) {
      stateText.alpha = 0.72 + Math.sin(now * 0.006) * 0.28;
    } else {
      stateText.alpha = 1;
    }
    screenTransition?.update(delta);
    interactionLayer?.update(delta);
    level2InteractionLayer?.update(delta);
    if (processingIndicator.visible) {
      const pulse = 0.72 + Math.sin(now * 0.01) * 0.28;
      processingIndicator.alpha = pulse;
      processingLampGlow.scale.set(0.9 + pulse * 0.35);
      if (koreIndicatorState === "processing" && now >= processingExpiresAt) setKoreIndicator("hidden");
    }
    if (auxDrainPulseEndsAt > 0) {
      drawReserve(now);
      if (now >= auxDrainPulseEndsAt) auxDrainPulseEndsAt = 0;
    }
    updateImpactShake(now);
    compositor?.update(delta);
    level2Compositor?.update(delta);
    if (useLevel2Scene && !mainMenu?.visible && !startup.visible) level2.dispatch({ type: "TICK", deltaMs: delta });
    if (useLevel2Scene) {
      const level2State = level2.snapshot();
      level2Compositor?.setRuntimeState(level2State);
      sceneAudio.setAlarmActive(isEnvironmentAbnormal(level2State));
    }
    for (const card of Object.values(cards)) {
      card.portrait.update(delta);
      card.glyphs.update(now);
      if (card.animationTime < 180) {
        card.animationTime = Math.min(180, card.animationTime + delta);
        const t = easeOutBack(card.animationTime / 180);
        card.container.x = Math.round(card.animationStartX + (card.targetX - card.animationStartX) * t);
      }
    }
    if (tabletMotion !== "idle") {
      const duration = tabletMotion === "opening" ? 340 : 260;
      tabletMotionClock = Math.min(duration, tabletMotionClock + delta);
      const raw = tabletMotionClock / duration;
      const eased = 1 - Math.pow(1 - raw, 4);
      setTabletProgress(tabletMotion === "opening" ? eased : 1 - raw * raw);
      if (tabletMotionClock >= duration) {
        if (tabletMotion === "closing") {
          overlay.visible = false;
          overlay.eventMode = "none";
          setTabletProgress(0);
        } else {
          setTabletProgress(1);
        }
        tabletMotion = "idle";
      }
    }
  });

  const test: GroundtruthTestControls = {
    enterScene,
    connect: () => {
      const transition = level1.dispatch({ type: "CONNECT" });
      if (transition.ok || level1.snapshot().foundation.connected) {
        connected = true;
        stateText.text = "Test connection established.";
        enterScene();
        beginWakeBeat();
      }
    },
    foundationIntro: () => {
      if (!level1.snapshot().foundation.connected) level1.dispatch({ type: "CONNECT" });
      beginWakeBeat();
      if (!level1.snapshot().foundation.openingResponseRelayed) {
        level1.dispatch({ type: "RELAY_OPENING_RESPONSE" });
        audio.transmitArrival();
        dialogue.receiveKore(KORE_OPENING_RESPONSE);
      }
    },
    koreLong: () => { audio.transmitArrival(); dialogue.receiveKore(SAMPLE_KORE_LONG); addEvent("TEST KORE MESSAGE"); },
    demiLong: () => { dialogue.echoDemi(SAMPLE_DEMI_LONG); addEvent("TEST DEMI ECHO"); },
    hover: () => { dialogue.reactDemi(SAMPLE_DEMI_HOVER, "hover"); addEvent("HOVER REACTION QUEUED"); },
    interrupt: () => { audio.transmitArrival(); dialogue.receiveKore(SAMPLE_KORE_INTERRUPT); addEvent("INTERRUPTION TEST"); },
    triggerImpact: () => startImpactShake(performance.now(), true),
    triggerColdOpen: () => playColdOpen(() => addEvent("COLD OPEN PREVIEW COMPLETE")),
    triggerLevelTransition,
    triggerGameOver: triggerGameOverEnding,
    previewAnimation: () => {
      cards[activeSpeaker].portrait.preview();
      addEvent("PORTRAIT ANIMATION PREVIEW", activeSpeaker);
    },
    setPreset: (value) => {
      presetName = value;
      updateCardConfig();
      addEvent("DIALOGUE DENSITY", value);
    },
    setSpeed: (value) => {
      speed = value;
      dialogue.setCharactersPerSecond(value);
      addEvent("TYPE SPEED", `${value} CPS`);
    },
    setEffect: (value) => {
      effect = value;
      updateCardConfig();
      addEvent("TEXT EFFECT", value.toUpperCase());
    },
    getLevel1State: () => level1.snapshot(),
    dispatchLevel1: (action) => { level1.dispatch(action); },
    getLevel2State: () => level2.snapshot(),
    dispatchLevel2: (action) => { level2.dispatch(action); }
  };

  return {
    app,
    dialogue,
    test,
    compositor,
    level1,
    level2,
    activeTools: () => tools.activeTools(),
    destroy() {
      if (connectionOverlayDelay !== undefined) window.clearTimeout(connectionOverlayDelay);
      if (copyStatusTimeout !== undefined) window.clearTimeout(copyStatusTimeout);
      resizeObserver?.disconnect();
      if (!resizeObserver) window.removeEventListener("resize", resizeGame);
      tools.dispose();
      unsubscribeLevel1();
      unsubscribeLevel2();
      if (!suppressCheckpointWrite) writeLevel2Checkpoint(localStorage, level2.snapshot());
      interactionLayer?.destroy();
      level2InteractionLayer?.destroy();
      level2Compositor?.destroy();
      coldOpen.destroy();
      levelTransition.destroy();
      gameOverEnding.destroy();
      winEnding.destroy();
      menuStarfield.destroy();
      screenTransition?.destroy();
      window.removeEventListener("pointerdown", unlockSceneAudio, true);
      window.removeEventListener("keydown", unlockSceneAudio, true);
      audio.destroy();
      sceneAudio.destroy();
      for (const card of Object.values(cards)) card.portrait.container.filters = [];
      portraitPixelateFilter.destroy();
      app.destroy(true);
    }
  };
}
