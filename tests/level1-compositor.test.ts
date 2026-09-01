import { describe, expect, it } from "vitest";
import {
  LEVEL1_STAGE_DARKNESS_DEFAULTS,
  LEVEL1_STAGE_LIGHTS,
  LEVEL1_TUBE_LIGHT_DEFAULTS
} from "../src/render/level1-lighting";
import { LEVEL1_LIGHTING_STAGES, LEVEL1_SCENE_HEIGHT, LEVEL1_SCENE_WIDTH } from "../src/render/level1-spec";

describe("Level 1 compositor contract", () => {
  it("keeps every generated scene layer on the locked scene grid", () => {
    expect(LEVEL1_SCENE_WIDTH).toBe(960);
    expect(LEVEL1_SCENE_HEIGHT).toBe(420);
  });

  it("defines the five authored lighting stages in order", () => {
    expect(LEVEL1_LIGHTING_STAGES.map((stage) => stage.id)).toEqual([1, 2, 3, 4, 5]);
    expect(LEVEL1_LIGHTING_STAGES.map((stage) => stage.label)).toEqual([
      "COLD START",
      "EMERGENCY",
      "ROUGH POWER",
      "CLEAN POWER",
      "DIVERSION"
    ]);
  });

  it("starts the engineering room in genuine darkness", () => {
    expect(LEVEL1_STAGE_DARKNESS_DEFAULTS[1]).toBeGreaterThanOrEqual(0.85);
    expect(LEVEL1_STAGE_DARKNESS_DEFAULTS[4]).toBeLessThan(LEVEL1_STAGE_DARKNESS_DEFAULTS[1]);
  });

  it("keeps authored tube lights inside the scene grid", () => {
    for (const light of LEVEL1_TUBE_LIGHT_DEFAULTS) {
      expect(light.x).toBeGreaterThanOrEqual(0);
      expect(light.x).toBeLessThanOrEqual(LEVEL1_SCENE_WIDTH);
      expect(light.y).toBeGreaterThanOrEqual(0);
      expect(light.y).toBeLessThanOrEqual(LEVEL1_SCENE_HEIGHT);
      expect(light.length).toBeGreaterThan(0);
      expect(light.reach).toBeGreaterThan(0);
      expect(light.intensity).toBeGreaterThanOrEqual(0);
    }
  });

  it("only references authored lights from stage presets", () => {
    const authoredIds = new Set(LEVEL1_TUBE_LIGHT_DEFAULTS.map((light) => light.id));
    for (const stageIds of Object.values(LEVEL1_STAGE_LIGHTS)) {
      expect(stageIds.every((id) => authoredIds.has(id))).toBe(true);
    }
  });
});
