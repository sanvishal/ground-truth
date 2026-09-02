import { describe, expect, it } from "vitest";
import {
  BREAKER_LOAD_ORDER,
  JUNCTION_CLEAN_TARGET,
  JUNCTION_ROUGH_TARGET,
  JUNCTION_VISIBLE_NODES,
  LEVEL1_WIRES,
  LEVEL1_BUS_RESTORE_GAIN,
  LEVEL1_MAX_RESERVE,
  applyLevel1Action,
  createInitialLevel1State,
  getReserveBand,
  REGULATOR_PRECISE_TARGET,
  REGULATOR_ROUGH_TARGET,
  type Level1Action,
  type Level1State
} from "../src/sim/level1";

const run = (state: Level1State, action: Level1Action): Level1State => {
  const transition = applyLevel1Action(state, action);
  expect(transition.ok, transition.error).toBe(true);
  return transition.state;
};

const reachSpiral = (): Level1State => {
  let state = createInitialLevel1State();
  state = run(state, { type: "CONNECT" });
  state = run(state, { type: "DEMI_WAKE_RESPONSE", message: "KORE... stop. I hear you." });
  state = run(state, { type: "RELAY_OPENING_RESPONSE" });
  state = run(state, { type: "RUN_DIAGNOSTICS" });
  state = run(state, { type: "COMPLETE_CONTINUITY_SEQUENCE" });
  for (const wire of LEVEL1_WIRES) state = run(state, { type: "CONNECT_WIRE", wire: wire.id, port: wire.target });
  return state;
};

const setJunction = (state: Level1State, target: readonly number[]): Level1State => {
  for (let visible = 0; visible < JUNCTION_VISIBLE_NODES.length; visible += 1) {
    const node = JUNCTION_VISIBLE_NODES[visible];
    const turns = (target[visible] - state.junctionPuzzle.rotations[node] + 4) % 4;
    for (let turn = 0; turn < turns; turn += 1) state = run(state, { type: "ROTATE_JUNCTION_NODE", index: node });
  }
  return state;
};

const setRegulator = (state: Level1State, target: readonly number[]): Level1State => {
  target.forEach((value, index) => { state = run(state, { type: "SET_REGULATOR_SLIDER", index, value }); });
  return state;
};

describe("Level 1 simulation", () => {
  it("derives one stable continuity order from each run seed", () => {
    const first = createInitialLevel1State(12345);
    const replay = createInitialLevel1State(12345);
    const otherRun = createInitialLevel1State(54321);

    expect(replay.wires.calibrationOrder).toEqual(first.wires.calibrationOrder);
    expect(otherRun.wires.calibrationOrder).not.toEqual(first.wires.calibrationOrder);
    expect(new Set(first.wires.calibrationOrder).size).toBe(3);
    expect(first.wires.calibrationOrder.every((gear) => gear >= 1 && gear <= 6)).toBe(true);
  });

  it("requires the Foundation handshake before wire restoration", () => {
    let state = createInitialLevel1State();
    const early = applyLevel1Action(state, { type: "RUN_DIAGNOSTICS" });
    expect(early.ok).toBe(false);

    state = run(state, { type: "CONNECT" });
    const answeredTooSoon = applyLevel1Action(state, { type: "RELAY_OPENING_RESPONSE" });
    expect(answeredTooSoon.ok).toBe(false);
    expect(answeredTooSoon.error).toContain("Demi's first response");
    state = run(state, { type: "DEMI_WAKE_RESPONSE", message: "KORE... stop. I hear you." });
    state = run(state, { type: "RELAY_OPENING_RESPONSE" });
    state = run(state, { type: "RUN_DIAGNOSTICS" });
    expect(state.phase).toBe("wire_restore");
    expect(state.lightingStage).toBe(1);
  });

  it("runs wires, spiral repair, and door diversion without a trust beat", () => {
    let state = reachSpiral();
    expect(state.phase).toBe("spiral_repair");
    expect(state.lightingStage).toBe(2);
    expect(state.skipped.trustBeat).toBe(true);

    state = run(state, { type: "RESEAT_MIC" });
    state = setJunction(state, JUNCTION_ROUGH_TARGET);
    expect(state.lightingStage).toBe(2);
    state = setRegulator(state, REGULATOR_ROUGH_TARGET);
    expect(state.lightingStage).toBe(3);
    state = run(state, { type: "LISTEN" });
    state = run(state, { type: "REFINE" });
    state = run(state, { type: "READ_BUS" });
    for (let index = 0; index < 6; index += 1) state = run(state, { type: "TOUCH_BREAKER", index });
    for (const index of BREAKER_LOAD_ORDER) state = run(state, { type: "TOGGLE_BREAKER", index });
    state = run(state, { type: "PULL_BREAKER", index: 3 });
    state = setJunction(state, JUNCTION_CLEAN_TARGET);
    state = setRegulator(state, REGULATOR_PRECISE_TARGET);
    expect(state.lightingStage).toBe(4);

    state = run(state, { type: "DIVERT_DOOR" });
    expect(state.phase).toBe("door_diversion");
    expect(state.lightingStage).toBe(5);
    state = run(state, { type: "COMMIT_DOOR" });
    expect(state.phase).toBe("complete");
    expect(state.door.opened).toBe(true);
  });

  it("rejects a clean route until breaker four is isolated", () => {
    const state = reachSpiral();
    const transition = applyLevel1Action(state, { type: "SET_JUNCTION", route: "clean" });
    expect(transition.ok).toBe(false);
    expect(transition.error).toContain("faulted branch");
  });

  it("fails visibly when breaker four is reset into the short", () => {
    const state = reachSpiral();
    const transition = applyLevel1Action(state, { type: "RESET_BREAKER_4" });
    expect(transition.ok).toBe(true);
    expect(transition.state.phase).toBe("failure");
    expect(transition.effects.some((effect) => effect.type === "failure")).toBe(true);
  });

  it("degrades reserve through warning bands without silently ending the run", () => {
    let state = createInitialLevel1State();
    state = run(state, { type: "SPEND_RESERVE", amount: 11, reason: "test" });
    expect(getReserveBand(state)).toBe("low");
    state = run(state, { type: "SPEND_RESERVE", amount: 3, reason: "test" });
    expect(getReserveBand(state)).toBe("critical");
    expect(state.phase).toBe("disconnected");
  });

  it("replenishes AUX when the physical emergency bus is restored", () => {
    let state = createInitialLevel1State();
    state = run(state, { type: "CONNECT" });
    state = run(state, { type: "DEMI_WAKE_RESPONSE", message: "I hear you." });
    state = run(state, { type: "RELAY_OPENING_RESPONSE" });
    state = run(state, { type: "RUN_DIAGNOSTICS" });
    state = run(state, { type: "SPEND_RESERVE", amount: 8, reason: "test" });
    const before = state.reserve;
    state = run(state, { type: "COMPLETE_CONTINUITY_SEQUENCE" });
    for (const wire of LEVEL1_WIRES) state = run(state, { type: "CONNECT_WIRE", wire: wire.id, port: wire.target });

    expect(state.reserve).toBe(before + LEVEL1_BUS_RESTORE_GAIN);
    expect(state.history.at(-1)?.code).toBe("AUX_RECOVERED");
    expect(state.history.at(-1)?.label).toBe(`AUX RESERVE RECOVERED +${LEVEL1_BUS_RESTORE_GAIN}`);
  });

  it("reports physical control changes and explains lighting transitions", () => {
    let state = reachSpiral();
    let transition = applyLevel1Action(state, { type: "SET_JUNCTION", route: "rough" });
    expect(transition.effects.at(-1)?.text).toBe("The junction clicks. The rough route is on.");
    state = transition.state;

    transition = applyLevel1Action(state, { type: "SET_REGULATOR", tune: "rough" });
    expect(transition.state.lightingStage).toBe(3);
    expect(transition.effects.at(-1)?.text).toContain("work lights flicker on");
    state = transition.state;

    state = run(state, { type: "READ_BUS" });
    transition = applyLevel1Action(state, { type: "PULL_BREAKER_4" });
    expect(transition.effects.at(-1)?.text).toBe("Thud... Breaker 4 is pulled.");
  });

  it("ties the work-light change to the regulator rather than the junction", () => {
    let state = reachSpiral();
    state = run(state, { type: "SET_REGULATOR", tune: "rough" });
    expect(state.lightingStage).toBe(3);
    state = run(state, { type: "SET_JUNCTION", route: "rough" });
    expect(state.lightingStage).toBe(3);
  });

  it("logs the actual capped AUX recovery rather than the nominal gain", () => {
    let state = reachSpiral();
    expect(state.reserve).toBe(LEVEL1_MAX_RESERVE);
    expect(state.history.at(-1)?.label).toBe("AUX RESERVE RECOVERED +0");
  });

  it("requires a continuity measurement before a terminal accepts a conductor", () => {
    let state = createInitialLevel1State();
    state = run(state, { type: "CONNECT" });
    state = run(state, { type: "DEMI_WAKE_RESPONSE", message: "I hear you." });
    state = run(state, { type: "RELAY_OPENING_RESPONSE" });
    state = run(state, { type: "RUN_DIAGNOSTICS" });
    const rejected = applyLevel1Action(state, { type: "CONNECT_WIRE", wire: "blue_heavy", port: "P5" });
    expect(rejected.ok).toBe(false);
    expect(rejected.error).toContain("is untested");
    expect(rejected.error).not.toContain("KORE");
  });

  it("does not allow two conductors to occupy one terminal", () => {
    let state = createInitialLevel1State();
    state = run(state, { type: "CONNECT" });
    state = run(state, { type: "DEMI_WAKE_RESPONSE", message: "KORE... stop. I hear you." });
    state = run(state, { type: "RELAY_OPENING_RESPONSE" });
    state = run(state, { type: "RUN_DIAGNOSTICS" });
    state = run(state, { type: "COMPLETE_CONTINUITY_SEQUENCE" });
    const occupiedPort = state.wires.targets.blue_heavy;
    state = run(state, { type: "CONNECT_WIRE", wire: "blue_heavy", port: occupiedPort });

    const collision = applyLevel1Action(state, { type: "CONNECT_WIRE", wire: "ridged_heavy", port: occupiedPort });
    expect(collision.ok).toBe(false);
    expect(collision.error).toBe(`${occupiedPort} is already occupied.`);
    expect(collision.state.wires.connections.ridged_heavy).toBeNull();
    expect(collision.state.wires.connections.blue_heavy).toBe(occupiedPort);
  });

  it("lets devtools adjust AUX within the level reserve bounds", () => {
    let state = createInitialLevel1State();
    state = run(state, { type: "DEV_ADJUST_RESERVE", amount: -0.5 });
    expect(state.reserve).toBe(LEVEL1_MAX_RESERVE - 0.5);
    state = run(state, { type: "DEV_ADJUST_RESERVE", amount: -100 });
    expect(state.reserve).toBe(0);
    state = run(state, { type: "DEV_ADJUST_RESERVE", amount: 100 });
    expect(state.reserve).toBe(LEVEL1_MAX_RESERVE);
  });

  it("trips recoverably on the wrong breaker order and arc-flashes on breaker four", () => {
    let state = reachSpiral();
    state = run(state, { type: "SET_JUNCTION", route: "rough" });
    state = run(state, { type: "SET_REGULATOR", tune: "rough" });
    state = run(state, { type: "READ_BUS" });
    state = run(state, { type: "TOUCH_BREAKER", index: 0 });
    state = run(state, { type: "TOGGLE_BREAKER", index: 0 });
    expect(state.breakerPuzzle.orderProgress).toBe(0);
    expect(state.phase).toBe("spiral_repair");
    state = run(state, { type: "TOUCH_BREAKER", index: 3 });
    const flash = applyLevel1Action(state, { type: "TOGGLE_BREAKER", index: 3 });
    expect(flash.state.phase).toBe("failure");
    expect(flash.effects.some((effect) => effect.code === "ARC_FLASH")).toBe(true);
  });
});
