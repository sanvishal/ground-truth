import { Container } from "pixi.js";

type PanelMotion = "closed" | "opening" | "open" | "closing";

const OPEN_MS = 190;
const CLOSE_MS = 145;

export class PanelApertureTransition {
  private motion: PanelMotion = "closed";
  private elapsedMs = 0;
  private readonly reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  constructor(private readonly target: Container, private readonly centerX = 480, private readonly centerY = 210) {
    this.target.pivot.set(centerX, centerY);
    this.target.position.set(centerX, centerY);
    this.hideImmediately();
  }

  get visible(): boolean {
    return this.motion !== "closed";
  }

  open(): void {
    this.target.visible = true;
    this.target.eventMode = "static";
    if (this.reducedMotion.matches) {
      this.motion = "open";
      this.applyOpen();
      return;
    }
    this.motion = "opening";
    this.elapsedMs = 0;
    this.applyProgress(0, true);
  }

  close(): void {
    if (this.motion === "closed" || this.motion === "closing") return;
    this.target.eventMode = "none";
    if (this.reducedMotion.matches) {
      this.hideImmediately();
      return;
    }
    this.motion = "closing";
    this.elapsedMs = 0;
  }

  hideImmediately(): void {
    this.motion = "closed";
    this.elapsedMs = 0;
    this.target.visible = false;
    this.target.eventMode = "none";
    this.target.alpha = 1;
    this.target.scale.set(1);
  }

  update(deltaMs: number): void {
    if (this.motion !== "opening" && this.motion !== "closing") return;
    this.elapsedMs += deltaMs;
    const duration = this.motion === "opening" ? OPEN_MS : CLOSE_MS;
    const raw = Math.min(1, this.elapsedMs / duration);
    if (this.motion === "opening") {
      const eased = 1 - Math.pow(1 - raw, 3);
      this.applyProgress(eased, true);
      if (raw >= 1) {
        this.motion = "open";
        this.applyOpen();
      }
      return;
    }
    const eased = raw * raw;
    this.applyProgress(1 - eased, false);
    if (raw >= 1) this.hideImmediately();
  }

  private applyOpen(): void {
    this.target.alpha = 1;
    this.target.scale.set(1);
  }

  private applyProgress(progress: number, opening: boolean): void {
    const aperture = Math.max(0.025, progress);
    const snap = opening ? Math.sin(progress * Math.PI) * 0.018 : 0;
    this.target.scale.set(aperture, 1 + snap);
    this.target.alpha = 0.28 + progress * 0.72;
  }
}
