import type { Speaker } from "../dialogue/types";

import { applyMasterVolume } from "./mix";

export class DialogueAudio {
  private context: AudioContext | null = null;
  private characterSerial = 0;
  muted = false;

  setMuted(value: boolean): boolean {
    this.muted = value;
    return this.muted;
  }

  private getContext(): AudioContext | null {
    if (this.muted) return null;
    this.context ??= new AudioContext();
    if (this.context.state === "suspended") void this.context.resume();
    return this.context;
  }

  tick(speaker: Speaker, character: string): void {
    if (/\s/.test(character) || ++this.characterSerial % 3 !== 0) return;
    const context = this.getContext();
    if (!context) return;
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const filter = context.createBiquadFilter();
    oscillator.type = speaker === "KORE" ? "square" : "triangle";
    oscillator.frequency.setValueAtTime(speaker === "KORE" ? 224 : 154, now);
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(speaker === "KORE" ? 1050 : 720, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(applyMasterVolume(speaker === "KORE" ? 0.035 : 0.045), now + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + (speaker === "KORE" ? 0.035 : 0.048));
    oscillator.connect(filter).connect(gain).connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.055);
  }

  transmitArrival(): void {
    const context = this.getContext();
    if (!context) return;
    const now = context.currentTime;
    const length = Math.floor(context.sampleRate * 0.08);
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    gain.gain.setValueAtTime(applyMasterVolume(0.07), now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
    source.connect(gain).connect(context.destination);
    source.start(now);

    const click = context.createOscillator();
    const clickGain = context.createGain();
    click.type = "square";
    click.frequency.setValueAtTime(72, now);
    clickGain.gain.setValueAtTime(applyMasterVolume(0.12), now);
    clickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.028);
    click.connect(clickGain).connect(context.destination);
    click.start(now);
    click.stop(now + 0.035);
  }

  advance(): void {
    const context = this.getContext();
    if (!context) return;
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "square";
    oscillator.frequency.setValueAtTime(98, now);
    gain.gain.setValueAtTime(applyMasterVolume(0.025), now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.018);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.022);
  }

  destroy(): void {
    if (this.context) void this.context.close();
    this.context = null;
  }
}
