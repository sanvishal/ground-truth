import { createInitialLevel2State, THERMAL_FEED_IDS, type Level2State } from "../sim/level2";

export const LEVEL2_CHECKPOINT_KEY = "groundtruth.level2.checkpoint.v13";
type CheckpointStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function readLevel2Checkpoint(storage: CheckpointStorage): Level2State | null {
  try {
    const raw = storage.getItem(LEVEL2_CHECKPOINT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { version?: number; state?: Partial<Level2State> };
    if (parsed.version !== 13 || !parsed.state || typeof parsed.state.seed !== "number") return null;
    const state = parsed.state;
    const base = createInitialLevel2State(state.seed);
    return {
      ...base,
      ...state,
      overlayOpen: false,
      pressureControl: { ...base.pressureControl, ...state.pressureControl, band: { ...base.pressureControl.band, ...state.pressureControl?.band } },
      thermal: {
        ...base.thermal,
        ...state.thermal,
        panelOpen: false,
        held: null,
        portAssignments: Array.isArray(state.thermal?.portAssignments) && state.thermal.portAssignments.length === 4 ? [...state.thermal.portAssignments] as Level2State["thermal"]["portAssignments"] : base.thermal.portAssignments,
        connections: Object.fromEntries(THERMAL_FEED_IDS.map((feed) => [feed, state.thermal?.connections?.[feed] ?? base.thermal.connections[feed]])) as Level2State["thermal"]["connections"]
      },
      water: {
        ...base.water,
        ...state.water,
        rotations: Array.isArray(state.water?.rotations) && state.water.rotations.length === 16 ? [...state.water.rotations] : base.water.rotations,
        tiles: Array.isArray(state.water?.tiles) && state.water.tiles.length === 16 ? state.water.tiles.map((tile) => ({ ...tile })) : base.water.tiles,
        requiredOrder: Array.isArray(state.water?.requiredOrder) && state.water.requiredOrder.length === 2 ? [...state.water.requiredOrder] as Level2State["water"]["requiredOrder"] : base.water.requiredOrder,
        flowingIndices: Array.isArray(state.water?.flowingIndices) ? [...state.water.flowingIndices] : base.water.flowingIndices
      },
      ignition: {
        ...base.ignition,
        ...state.ignition,
        panelOpen: false,
        keys: Array.isArray(state.ignition?.keys) && state.ignition.keys.length === 4 ? [...state.ignition.keys] as Level2State["ignition"]["keys"] : base.ignition.keys,
        pattern: Array.isArray(state.ignition?.pattern) ? [...state.ignition.pattern] : base.ignition.pattern,
        results: Array.isArray(state.ignition?.results) ? [...state.ignition.results] : base.ignition.results
      },
      plant: { ...base.plant, ...state.plant },
      pod: { ...base.pod, ...state.pod },
      history: Array.isArray(state.history) ? state.history.slice(-32) : base.history
    };
  } catch {
    return null;
  }
}

export function writeLevel2Checkpoint(storage: CheckpointStorage, state: Level2State): void {
  try {
    storage.setItem(LEVEL2_CHECKPOINT_KEY, JSON.stringify({ version: 13, savedAt: Date.now(), state }));
  } catch {
    // Persistence must never interrupt play.
  }
}

export function clearLevel2Checkpoint(storage: CheckpointStorage): void {
  try { storage.removeItem(LEVEL2_CHECKPOINT_KEY); } catch { /* In-memory reset still succeeds. */ }
}
