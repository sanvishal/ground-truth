import { describe, expect, it } from "vitest";
import {
  applyLevel2Action, canTransferSapling, createInitialLevel2State, getIgnitionContactTime,
  getLaunchCode, getThermalMismatchCount, isEnvironmentAbnormal, isTemperatureAbnormal,
  TEMPERATURE_SAFE_BAND, THERMAL_FEED_IDS, WATER_SOLUTION,
  type BallastRate, type Level2State, type ThermalSocketId
} from "../src/sim/level2";

const apply = (state: Level2State, action: Parameters<typeof applyLevel2Action>[1]) => applyLevel2Action(state, action).state;

function runPerfectPass(state: Level2State, rate: BallastRate): Level2State {
  while (state.ignition.rate !== rate) {
    const order: BallastRate[] = ["nominal", "elevated", "high", "maximum"];
    state = apply(state, { type: "SET_BALLAST_RATE", rate: order[order.indexOf(state.ignition.rate) + 1]! });
  }
  state = apply(state, { type: "SET_IGNITION_PANEL", open: true });
  state = apply(state, { type: "START_IGNITION", pullSpeed: 900 });
  for (let index = 0; index < state.ignition.pattern.length && !state.ignition.solved; index += 1) {
    state = apply(state, { type: "TICK", deltaMs: getIgnitionContactTime(state, index) - state.ignition.runElapsedMs });
    state = apply(state, { type: "STRIKE_CONTACT", key: state.ignition.keys[state.ignition.pattern[index]!]! });
  }
  return state;
}

describe("level 2 simulation", () => {
  it("starts thermally and pneumatically stable while both timers are already running", () => {
    const state = createInitialLevel2State(42);
    expect(isEnvironmentAbnormal(state)).toBe(false);
    expect(state.pressure).toBeGreaterThanOrEqual(state.pressureControl.band.min);
    expect(state.pressure).toBeLessThanOrEqual(state.pressureControl.band.max);
    expect(state.pressureControl.band.max - state.pressureControl.band.min).toBeGreaterThanOrEqual(24);
    expect(state.pressureControl.band.max - state.pressureControl.band.min).toBeLessThanOrEqual(38);
    expect(state.temperature).toBeGreaterThanOrEqual(TEMPERATURE_SAFE_BAND.min);
    expect(state.temperature).toBeLessThanOrEqual(TEMPERATURE_SAFE_BAND.max);
    expect(Math.abs(state.pressureControl.drift)).toBeGreaterThan(0);
    expect(state.pressureControl.nextShiftMs).toBeGreaterThanOrEqual(60_000);
    expect(state.pressureControl.nextShiftMs).toBeLessThanOrEqual(90_000);
    expect(state.thermal.swapCountdownMs).toBe(60_000);

    const advanced = apply(state, { type: "TICK", deltaMs: 1_000 });
    expect(advanced.pressure).not.toBe(state.pressure);
    expect(advanced.thermal.swapCountdownMs).toBe(59_000);
    expect(isEnvironmentAbnormal(advanced)).toBe(false);
  });

  it("starts with four correctly coupled feeds and no parking sockets", () => {
    const state = createInitialLevel2State(42);
    expect(getThermalMismatchCount(state)).toBe(0);
    expect(new Set(Object.values(state.thermal.connections)).size).toBe(4);
    expect(Object.values(state.thermal.connections).every((socket) => socket?.startsWith("port_"))).toBe(true);
  });

  it("keeps pressure and temperature live with the thermal panel open or closed", () => {
    let state = createInitialLevel2State(42);
    const passive = apply(state, { type: "TICK", deltaMs: 10_000 });
    expect(passive.temperature).toBeGreaterThan(state.temperature);
    state = passive;
    state = apply(state, { type: "DEV_REMAP_THERMAL" });
    const closed = apply(state, { type: "TICK", deltaMs: 5_000 });
    expect(Math.abs(closed.pressure - state.pressure)).toBeGreaterThan(0.5);
    expect(closed.temperature).toBeGreaterThan(state.temperature + 8);
    state = apply(closed, { type: "SET_OVERLAY", open: true });
    const countdown = state.thermal.swapCountdownMs;
    const open = apply(state, { type: "TICK", deltaMs: 2000 });
    expect(Math.abs(open.pressure - state.pressure)).toBeGreaterThan(0.2);
    expect(open.temperature).toBeGreaterThan(state.temperature);
    expect(open.thermal.swapCountdownMs).toBe(countdown);
    expect(open.thermal.waitingForGreen).toBe(true);
  });

  it("periodically moves the pressure band and reverses passive drift", () => {
    let state = createInitialLevel2State(42);
    const initialBand = { ...state.pressureControl.band };
    const initialDrift = state.pressureControl.drift;
    state = apply(state, { type: "TICK", deltaMs: state.pressureControl.nextShiftMs + 1 });
    expect(state.pressureControl.band).not.toEqual(initialBand);
    expect(Math.sign(state.pressureControl.drift)).toBe(-Math.sign(initialDrift));
  });

  it("drains 0.5 AUX for every five continuous seconds of abnormal pressure", () => {
    let state = createInitialLevel2State(42);
    state = apply(state, { type: "CRANK_PRESSURE", amount: 100 });
    expect(isEnvironmentAbnormal(state)).toBe(true);
    const reserve = state.reserve;
    state = apply(state, { type: "TICK", deltaMs: 4_999 });
    expect(state.reserve).toBe(reserve);
    expect(state.environmentAlarmMs).toBe(4_999);
    state = apply(state, { type: "TICK", deltaMs: 1 });
    expect(state.reserve).toBe(reserve - 0.5);
    expect(state.environmentAlarmMs).toBe(0);
    state = apply(state, { type: "TICK", deltaMs: 5_000 });
    expect(state.reserve).toBe(reserve - 1);
  });

  it("treats an above-band temperature as good while correct couplings cool it", () => {
    let state = createInitialLevel2State(42);
    state = { ...state, temperature: 70 };
    expect(isTemperatureAbnormal(state)).toBe(false);
    const reserve = state.reserve;
    state = apply(state, { type: "TICK", deltaMs: 5_000 });
    expect(state.temperature).toBeLessThan(70);
    expect(state.reserve).toBe(reserve);
    expect(state.environmentAlarmMs).toBe(0);
  });

  it("remaps exactly two indicators after a 60 second green hold", () => {
    let state = createInitialLevel2State(42);
    expect(state.thermal.swapCountdownMs).toBe(60_000);
    const before = [...state.thermal.portAssignments];
    state = apply(state, { type: "SET_OVERLAY", open: true });
    state = apply(state, { type: "SET_THERMAL_PANEL", open: true });
    state = apply(state, { type: "TICK", deltaMs: state.thermal.swapCountdownMs + 1 });
    expect(state.thermal.portAssignments.filter((feed, index) => feed !== before[index])).toHaveLength(2);
    expect(getThermalMismatchCount(state)).toBe(2);
    expect(state.temperature).toBeGreaterThan(20);
  });

  it("allows only one held plug and rejects occupied sockets", () => {
    let state = createInitialLevel2State(42);
    const first = THERMAL_FEED_IDS[0];
    const second = THERMAL_FEED_IDS[1];
    state = apply(state, { type: "PICK_UP_THERMAL_PLUG", feed: first });
    expect(state.thermal.held).toBe(first);
    const blockedPickup = applyLevel2Action(state, { type: "PICK_UP_THERMAL_PLUG", feed: second });
    expect(blockedPickup.ok).toBe(false);
    const occupied = state.thermal.connections[second]!;
    const blockedSeat = applyLevel2Action(state, { type: "SEAT_THERMAL_PLUG", socket: occupied });
    expect(blockedSeat.ok).toBe(false);
    const loose = apply(state, { type: "TICK", deltaMs: 3000 });
    expect(getThermalMismatchCount(loose)).toBe(1);
    expect(loose.temperature).toBeGreaterThan(state.temperature + 10);
  });

  it("resolves a two-port remap by temporarily leaving both plugs loose", () => {
    let state = apply(createInitialLevel2State(42), { type: "DEV_REMAP_THERMAL" });
    state = apply(state, { type: "TICK", deltaMs: 5_000 });
    const misplaced = THERMAL_FEED_IDS.filter((feed) => {
      const portIndex = state.thermal.portAssignments.indexOf(feed);
      return state.thermal.connections[feed] !== `port_${portIndex}`;
    });
    expect(misplaced).toHaveLength(2);
    const [first, second] = misplaced;
    const firstTarget = `port_${state.thermal.portAssignments.indexOf(first)}` as ThermalSocketId;
    const secondTarget = `port_${state.thermal.portAssignments.indexOf(second)}` as ThermalSocketId;
    state = apply(state, { type: "PICK_UP_THERMAL_PLUG", feed: first });
    state = apply(state, { type: "DROP_THERMAL_PLUG" });
    state = apply(state, { type: "PICK_UP_THERMAL_PLUG", feed: second });
    state = apply(state, { type: "SEAT_THERMAL_PLUG", socket: secondTarget });
    state = apply(state, { type: "PICK_UP_THERMAL_PLUG", feed: first });
    state = apply(state, { type: "SEAT_THERMAL_PLUG", socket: firstTarget });
    expect(getThermalMismatchCount(state)).toBe(0);
    expect(state.thermal.waitingForGreen).toBe(true);
    const heldCountdown = state.thermal.swapCountdownMs;
    state = apply(state, { type: "TICK", deltaMs: 2_000 });
    expect(state.temperature).toBeGreaterThan(TEMPERATURE_SAFE_BAND.max);
    expect(state.thermal.swapCountdownMs).toBe(heldCountdown);
    state = apply(state, { type: "TICK", deltaMs: 4_000 });
    expect(state.temperature).toBeLessThanOrEqual(TEMPERATURE_SAFE_BAND.max);
    expect(state.thermal.waitingForGreen).toBe(false);
    expect(state.thermal.swapCountdownMs).toBe(60_000);
  });

  it("solves the water route and preserves its hidden code", () => {
    let state = createInitialLevel2State();
    const digits = state.water.digits;
    state = apply(state, { type: "DEV_SOLVE_WATER" });
    expect(state.water.rotations).toEqual([...WATER_SOLUTION]);
    expect(state.water.solved).toBe(true);
    expect(state.water.digits).toBe(digits);
  });

  it("uses the four arrow keys and keeps the seeded note pattern across rate changes", () => {
    const first = createInitialLevel2State(7);
    const second = createInitialLevel2State(8);
    expect(first.ignition.keys).toEqual(["ArrowLeft", "ArrowUp", "ArrowDown", "ArrowRight"]);
    expect(second.ignition.keys).toEqual(first.ignition.keys);
    const pattern = [...first.ignition.pattern];
    expect(apply(first, { type: "SET_BALLAST_RATE", rate: "elevated" }).ignition.pattern).toEqual(pattern);
  });

  it("makes nominal unwinnable while a perfect high-rate pass ignites", () => {
    expect(runPerfectPass(createInitialLevel2State(22), "nominal").ignition.solved).toBe(false);
    const high = runPerfectPass(createInitialLevel2State(22), "high");
    expect(high.ignition.solved).toBe(true);
    expect(high.ignition.charge).toBeGreaterThanOrEqual(100);
  });

  it("raises ballast one paid step at a time and lowers it freely", () => {
    let state = createInitialLevel2State();
    expect(applyLevel2Action(state, { type: "SET_BALLAST_RATE", rate: "high" }).ok).toBe(false);
    state = apply(state, { type: "SET_BALLAST_RATE", rate: "elevated" });
    expect(state.reserve).toBe(9.5);
    state = apply(state, { type: "SET_BALLAST_RATE", rate: "high" });
    expect(state.reserve).toBe(8.5);
    state = apply(state, { type: "SET_BALLAST_RATE", rate: "nominal" });
    expect(state.reserve).toBe(8.5);
  });

  it("widens timing only after the explicit KORE action", () => {
    let state = runPerfectPass(createInitialLevel2State(), "nominal");
    expect(state.ignition.assist).toBe(false);
    state = apply(state, { type: "ENABLE_IGNITION_ASSIST" });
    expect(state.ignition.assist).toBe(true);
  });

  it("pauses an ignition pass while its panel is closed and resumes in place", () => {
    let state = createInitialLevel2State(31);
    state = apply(state, { type: "SET_IGNITION_PANEL", open: true });
    state = apply(state, { type: "START_IGNITION", pullSpeed: 900 });
    state = apply(state, { type: "TICK", deltaMs: 700 });
    const elapsed = state.ignition.runElapsedMs;
    const charge = state.ignition.charge;
    state = apply(state, { type: "SET_IGNITION_PANEL", open: false });
    state = apply(state, { type: "TICK", deltaMs: 3000 });
    expect(state.ignition.runElapsedMs).toBe(elapsed);
    expect(state.ignition.charge).toBe(charge);
    state = apply(state, { type: "SET_IGNITION_PANEL", open: true });
    state = apply(state, { type: "TICK", deltaMs: 100 });
    expect(state.ignition.runElapsedMs).toBe(elapsed + 100);
  });

  it("requires all four stable conditions for transfer and opens the pod with both yields", () => {
    let state = apply(createInitialLevel2State(), { type: "DEV_READY_TRANSFER" });
    expect(canTransferSapling(state)).toBe(true);
    state = apply(state, { type: "TRANSFER_SAPLING" });
    for (const digit of getLaunchCode(state)) state = apply(state, { type: "POD_DIGIT", digit });
    state = apply(state, { type: "SUBMIT_POD_CODE" });
    expect(state.pod.opened).toBe(true);
    expect(state.phase).toBe("complete");
  });
});
