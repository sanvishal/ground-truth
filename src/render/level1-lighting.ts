import type { Level1LightingStage } from "./level1-spec";

export interface TubeLightSettings {
  id: string;
  label: string;
  x: number;
  y: number;
  length: number;
  reach: number;
  angle: number;
  intensity: number;
  color: number;
  coneAngle?: number;
}

export const LEVEL1_TUBE_LIGHT_DEFAULTS: readonly TubeLightSettings[] = [
  { id: "cold-overhead", label: "COLD OVERHEAD", x: 408, y: 38, length: 176, reach: 235, angle: 0, intensity: 0.5, color: 0x86adc1 },
  { id: "cold-left", label: "LEFT COLD FLICKER", x: 78, y: 42, length: 92, reach: 168, angle: 0.06, intensity: 0.28, color: 0x789bab },
  { id: "emergency-beacon", label: "ROTATING EMERGENCY BEACON", x: 785, y: 46, length: 46, reach: 360, angle: -0.72, intensity: 0.74, color: 0xc63b32 },
  { id: "clean-overhead", label: "WARM OVERHEAD", x: 584, y: 40, length: 164, reach: 250, angle: 0, intensity: 0.52, color: 0xffc267 },
  { id: "regulator", label: "REGULATOR WORK LIGHT", x: 447, y: 238, length: 82, reach: 118, angle: -0.1, intensity: 0.58, color: 0xffc267 },
  { id: "junction", label: "JUNCTION WORK LIGHT", x: 735, y: 202, length: 92, reach: 134, angle: 0.18, intensity: 0.54, color: 0xffc267 },
  { id: "actuator", label: "ACTUATOR SERVICE LIGHT", x: 846, y: 282, length: 92, reach: 142, angle: -0.34, intensity: 0.62, color: 0xffc267 },
  { id: "kore-rack", label: "KORE RACK LIGHT", x: 121, y: 102, length: 70, reach: 116, angle: -0.12, intensity: 0.38, color: 0xe2a348 },
  { id: "emergency-left", label: "LEFT EMERGENCY TUBE", x: 238, y: 50, length: 124, reach: 210, angle: 0.12, intensity: 0.48, color: 0x9c2f2d },
  { id: "emergency-right", label: "RIGHT EMERGENCY TUBE", x: 742, y: 48, length: 128, reach: 216, angle: -0.1, intensity: 0.48, color: 0x9c2f2d }
];

export const LEVEL1_STAGE_DARKNESS_DEFAULTS: Record<Level1LightingStage, number> = {
  1: 0.88,
  2: 0.72,
  3: 0.56,
  4: 0.28,
  5: 0.82
};

export const LEVEL1_STAGE_LIGHTS: Record<Level1LightingStage, readonly string[]> = {
  1: ["cold-overhead", "cold-left", "emergency-beacon"],
  2: ["cold-overhead", "kore-rack", "emergency-left", "emergency-right"],
  3: ["regulator", "junction", "kore-rack", "emergency-left", "emergency-right"],
  4: ["clean-overhead", "regulator", "junction"],
  5: ["actuator", "kore-rack"]
};

export function cloneTubeLightSettings(source: TubeLightSettings): TubeLightSettings {
  return { ...source };
}
