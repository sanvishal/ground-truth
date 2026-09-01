export const LEVEL1_SCENE_WIDTH = 960;
export const LEVEL1_SCENE_HEIGHT = 420;

export type Level1LightingStage = 1 | 2 | 3 | 4 | 5;

export const LEVEL1_LIGHTING_STAGES: ReadonlyArray<{ id: Level1LightingStage; label: string }> = [
  { id: 1, label: "COLD START" },
  { id: 2, label: "EMERGENCY" },
  { id: 3, label: "ROUGH POWER" },
  { id: 4, label: "CLEAN POWER" },
  { id: 5, label: "DIVERSION" }
];
