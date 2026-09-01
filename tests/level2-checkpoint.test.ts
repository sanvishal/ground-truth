import { describe, expect, it } from "vitest";
import { clearLevel2Checkpoint, readLevel2Checkpoint, writeLevel2Checkpoint } from "../src/runtime/level2-checkpoint";
import { applyLevel2Action, createInitialLevel2State } from "../src/sim/level2";

const storage = (): Storage => {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; }, clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null, key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); }, setItem: (key, value) => { values.set(key, value); }
  };
};

describe("Level 2 checkpoints", () => {
  it("round-trips seeded puzzle state and closes open overlays", () => {
    const target = storage();
    let state = createInitialLevel2State(73);
    state = applyLevel2Action(state, { type: "DEV_READY_TRANSFER" }).state;
    state = applyLevel2Action(state, { type: "SET_OVERLAY", open: true }).state;
    writeLevel2Checkpoint(target, state);
    const restored = readLevel2Checkpoint(target);
    expect(restored?.water.solved).toBe(true);
    expect(restored?.ignition.solved).toBe(true);
    expect(restored?.ignition.keys).toEqual(state.ignition.keys);
    expect(restored?.water.digits).toBe(state.water.digits);
    expect(restored?.overlayOpen).toBe(false);
  });

  it("clears a stored greenhouse run", () => {
    const target = storage();
    writeLevel2Checkpoint(target, createInitialLevel2State());
    clearLevel2Checkpoint(target);
    expect(readLevel2Checkpoint(target)).toBeNull();
  });
});
