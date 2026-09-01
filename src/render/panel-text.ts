import { CanvasSource, Sprite, Texture } from "pixi.js";
import { PANEL_FONT } from "../fonts";

const RENDER_RESOLUTION = 2;
const MAX_TILT_RADIANS = 0.035;
const MAX_BASELINE_JITTER = 0.75;

const hashUnit = (value: string): number => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
};

/** Static, canvas-backed panel lettering with stable character-level wear. */
export class PanelText extends Sprite {
  private readonly canvas: HTMLCanvasElement;
  private readonly canvasSource: CanvasSource;
  private readonly fontSize: number;
  private readonly seed: string;
  private value: string;

  constructor(text: string, size = 12, fill = 0xc9c5ba, seed = text) {
    const canvas = document.createElement("canvas");
    const source = new CanvasSource({
      resource: canvas,
      resolution: RENDER_RESOLUTION,
      transparent: true,
      antialias: true,
      scaleMode: "linear"
    });
    super(new Texture({ source }));
    this.canvas = canvas;
    this.canvasSource = source;
    this.fontSize = size;
    this.seed = seed;
    this.value = text;
    this.tint = fill;
    this.redraw();
  }

  get text(): string {
    return this.value;
  }

  set text(next: string) {
    if (next === this.value) return;
    this.value = next;
    this.redraw();
  }

  private redraw(): void {
    const measure = document.createElement("canvas").getContext("2d");
    if (!measure) return;
    measure.font = `${this.fontSize}px "${PANEL_FONT}"`;
    const lines = this.value.split("\n");
    const letterSpacing = Math.max(0.25, this.fontSize * 0.025);
    const lineHeight = this.fontSize * 1.25;
    const padding = Math.ceil(this.fontSize * 0.28);
    const lineWidths = lines.map((line) => Array.from(line).reduce(
      (width, character) => width + measure.measureText(character).width + letterSpacing,
      0
    ));
    const logicalWidth = Math.max(1, Math.ceil(Math.max(...lineWidths, 0) + padding * 2));
    const logicalHeight = Math.max(1, Math.ceil(lines.length * lineHeight + padding * 2));
    this.canvasSource.resize(logicalWidth, logicalHeight, RENDER_RESOLUTION);

    const context = this.canvas.getContext("2d");
    if (!context) return;
    context.setTransform(RENDER_RESOLUTION, 0, 0, RENDER_RESOLUTION, 0, 0);
    context.clearRect(0, 0, logicalWidth, logicalHeight);
    context.font = `${this.fontSize}px "${PANEL_FONT}"`;
    context.fillStyle = "#ffffff";
    context.textBaseline = "alphabetic";

    lines.forEach((line, lineIndex) => {
      let cursorX = padding;
      const baseline = padding + this.fontSize + lineIndex * lineHeight;
      Array.from(line).forEach((character, characterIndex) => {
        const advance = measure.measureText(character).width;
        if (character.trim()) {
          const characterSeed = `${this.seed}:${lineIndex}:${characterIndex}:${character}`;
          const tilt = (hashUnit(`${characterSeed}:tilt`) * 2 - 1) * MAX_TILT_RADIANS;
          const baselineJitter = (hashUnit(`${characterSeed}:baseline`) * 2 - 1) * MAX_BASELINE_JITTER;
          context.save();
          context.translate(cursorX + advance / 2, baseline + baselineJitter);
          context.rotate(tilt);
          context.fillText(character, -advance / 2, 0);
          context.restore();
        }
        cursorX += advance + letterSpacing;
      });
    });
    this.canvasSource.update();
  }
}

export const panelText = (text: string, size = 12, fill = 0xc9c5ba, seed = text): PanelText =>
  new PanelText(text, size, fill, seed);
