import { Container, Graphics, Rectangle } from "pixi.js";

const BAYER_4X4 = [
  0, 8, 2, 10,
  12, 4, 14, 6,
  3, 11, 1, 9,
  15, 7, 13, 5
] as const;

export function drawBayerMask(
  mask: Graphics,
  progress: number,
  width: number,
  height: number,
  cellSize = 8
): void {
  const clamped = Math.max(0, Math.min(1, progress));
  mask.clear();
  for (let y = 0; y < height; y += cellSize) {
    const matrixY = Math.floor(y / cellSize) % 4;
    for (let x = 0; x < width; x += cellSize) {
      const matrixX = Math.floor(x / cellSize) % 4;
      const threshold = (BAYER_4X4[matrixY * 4 + matrixX] + 1) / 16;
      if (threshold <= clamped) mask.rect(x, y, cellSize, cellSize);
    }
  }
  mask.fill(0xffffff);
}

export class ScreenDitherTransition {
  readonly container = new Container();

  private readonly mask = new Graphics();
  private elapsed = 0;
  private covered = false;
  private running = false;
  private onCovered: (() => void) | undefined;
  private onComplete: (() => void) | undefined;

  constructor(
    private readonly width: number,
    private readonly height: number,
    private readonly durationMs = 800,
    color = 0x030506
  ) {
    const curtain = new Graphics().rect(0, 0, width, height).fill(color);
    curtain.mask = this.mask;
    this.container.addChild(curtain, this.mask);
    this.container.hitArea = new Rectangle(0, 0, width, height);
    this.container.eventMode = "none";
    this.container.visible = false;
  }

  get active(): boolean {
    return this.running;
  }

  play(onCovered: () => void, onComplete?: () => void): void {
    if (this.running) return;
    this.elapsed = 0;
    this.covered = false;
    this.running = true;
    this.onCovered = onCovered;
    this.onComplete = onComplete;
    this.container.visible = true;
    this.container.eventMode = "static";
    drawBayerMask(this.mask, 0, this.width, this.height);
  }

  update(deltaMs: number): void {
    if (!this.running) return;
    this.elapsed = Math.min(this.durationMs, this.elapsed + deltaMs);
    const progress = this.elapsed / this.durationMs;
    const coverage = progress < 0.5 ? progress * 2 : (1 - progress) * 2;
    drawBayerMask(this.mask, coverage, this.width, this.height);

    if (!this.covered && progress >= 0.5) {
      this.covered = true;
      this.onCovered?.();
      this.onCovered = undefined;
    }
    if (this.elapsed < this.durationMs) return;

    this.running = false;
    this.container.visible = false;
    this.container.eventMode = "none";
    this.mask.clear();
    const callback = this.onComplete;
    this.onComplete = undefined;
    callback?.();
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
