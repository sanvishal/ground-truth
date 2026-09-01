import { describe, expect, it } from "vitest";
import { clearLevel1Checkpoint, readLevel1Checkpoint, writeLevel1Checkpoint } from "../src/runtime/level1-checkpoint";
import { applyLevel1Action, createInitialLevel1State } from "../src/sim/level1";

const memoryStorage = (): Storage => {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); }
  };
};

describe("Level 1 checkpoints", () => {
  it("round-trips progression while releasing momentary controls", () => {
    const storage = memoryStorage();
    let state = applyLevel1Action(createInitialLevel1State(), { type: "CONNECT" }).state;
    state = { ...state, reserve: 9.5, hands: { continuityHeld: true } };
    writeLevel1Checkpoint(storage, state);

    const restored = readLevel1Checkpoint(storage);
    expect(restored?.phase).toBe("foundation");
    expect(restored?.reserve).toBe(9.5);
    expect(restored?.hands.continuityHeld).toBe(false);
    expect(restored?.runSeed).toBe(state.runSeed);
    expect(restored?.wires.calibrationOrder).toEqual(state.wires.calibrationOrder);
  });

  it("clears a stored run", () => {
    const storage = memoryStorage();
    writeLevel1Checkpoint(storage, createInitialLevel1State());
    clearLevel1Checkpoint(storage);
    expect(readLevel1Checkpoint(storage)).toBeNull();
  });

  it("round-trips code-drawn puzzle state", () => {
    const storage = memoryStorage();
    const state = createInitialLevel1State();
    state.wires.measuredPorts = ["P1", "P5"];
    state.junctionPuzzle.rotations[4] = 3;
    state.regulatorPuzzle.sliders = [2, 1, 3];
    state.breakerPuzzle.positions[4] = "up";
    state.breakerPuzzle.touched[3] = true;
    state.breakerPuzzle.orderProgress = 1;
    writeLevel1Checkpoint(storage, state);

    const restored = readLevel1Checkpoint(storage);
    expect(restored?.wires.measuredPorts).toEqual(["P1", "P5"]);
    expect(restored?.junctionPuzzle.rotations[4]).toBe(3);
    expect(restored?.regulatorPuzzle.sliders).toEqual([2, 1, 3]);
    expect(restored?.breakerPuzzle.positions[4]).toBe("up");
    expect(restored?.breakerPuzzle.touched[3]).toBe(true);
    expect(restored?.breakerPuzzle.orderProgress).toBe(1);
  });
});
