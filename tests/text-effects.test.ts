import { describe, expect, it } from "vitest";
import { isAutoJitterWord, isAutoWaveWord, jitterOffset } from "../src/render/text-effects";

describe("jitterOffset", () => {
  it("moves independently along both axes", () => {
    const frames = Array.from({ length: 10 }, (_, frame) => jitterOffset(frame, 3, 2));
    const xValues = new Set(frames.map((offset) => offset.x));
    const yValues = new Set(frames.map((offset) => offset.y));

    expect(xValues.size).toBeGreaterThan(1);
    expect(yValues.size).toBeGreaterThan(1);
    expect(frames.some((offset) => offset.x !== offset.y)).toBe(true);
  });

  it("keeps the motion restrained to a single pixel", () => {
    const frames = Array.from({ length: 20 }, (_, frame) => jitterOffset(frame, 4, 1));
    expect(frames.every(({ x, y }) => Math.abs(x) <= 1 && Math.abs(y) <= 1)).toBe(true);
    expect(frames.filter(({ x, y }) => x === 0 && y === 0).length).toBeGreaterThanOrEqual(4);
  });

  it("recognizes glitch words without affecting ordinary dialogue", () => {
    expect(isAutoJitterWord("Bzzzt connection")).toBe(true);
    expect(isAutoJitterWord("thud")).toBe(true);
    expect(isAutoJitterWord("diagnostics")).toBe(false);
  });

  it("recognizes the drawn-out wake sound as an automatic wave word", () => {
    expect(isAutoWaveWord("uhhhhh")).toBe(true);
    expect(isAutoWaveWord("uhh")).toBe(false);
    expect(isAutoWaveWord("I hear you")).toBe(false);
  });

  it("jitters physical impact words letter by letter", () => {
    expect(isAutoJitterWord("Thud...")).toBe(true);
  });
});
