export const THERMAL_FEED_IDS = ["red", "blue", "green", "amber"] as const;
export type ThermalFeedId = typeof THERMAL_FEED_IDS[number];
export const THERMAL_PORT_IDS = ["port_0", "port_1", "port_2", "port_3"] as const;
export type ThermalSocketId = typeof THERMAL_PORT_IDS[number];
export type Level2Phase = "arrival" | "stabilize" | "water" | "ignition" | "transfer" | "pod" | "complete";
export const PRESSURE_SAFE_BAND = { min: 44, max: 72 } as const;
export const TEMPERATURE_SAFE_BAND = { min: 0, max: 32 } as const;
export const BALLAST_RATES = ["nominal", "elevated", "high", "maximum"] as const;
export type BallastRate = typeof BALLAST_RATES[number];
export const IGNITION_PATTERN_LENGTH = 16;
export const IGNITION_STRIKE_THRESHOLD = 100;
export const IGNITION_TIMING_WINDOW_MS = 190;
export const IGNITION_ASSIST_WINDOW_MS = 280;
const PRESSURE_DRIFT_MIN = 0.165;
const PRESSURE_DRIFT_RANGE = 0.11;
export const IGNITION_RATE_SPACING_MS: Readonly<Record<BallastRate, number>> = {
  nominal: 1_100, elevated: 820, high: 620, maximum: 470
};

export type WaterSide = 0 | 1 | 2 | 3;
export type WaterTileKind = "straight" | "elbow" | "stage" | "empty" | "blocked";
export interface WaterTile { kind: WaterTileKind; shape?: "straight" | "elbow"; stage?: "A" | "B" | "C" | "D" }
export const WATER_INLET_INDEX = 4;
export const WATER_OUTLET_INDEX = 15;
export const WATER_STAGE_INDICES = [4, 6, 9, 10] as const;
export const WATER_CLEAN_SOLUTION = [0, 0, 1, 0, 2, 0, 3, 1, 0, 0, 0, 1, 0, 0, 0, 3] as const;
export const WATER_SOLUTION = WATER_CLEAN_SOLUTION;

export interface Level2ThermalControl {
  panelOpen: boolean;
  portAssignments: [ThermalFeedId, ThermalFeedId, ThermalFeedId, ThermalFeedId];
  connections: Record<ThermalFeedId, ThermalSocketId | null>;
  held: ThermalFeedId | null;
  cycle: number;
  swapCountdownMs: number;
  waitingForGreen: boolean;
  hasRemapped: boolean;
  lastSwap: [number, number] | null;
}
export interface Level2PressureControl {
  band: { min: number; max: number };
  drift: number;
  cycle: number;
  nextShiftMs: number;
}
export interface Level2State {
  seed: number; phase: Level2Phase; elapsedMs: number; reserve: number; overlayOpen: boolean;
  pressure: number; pressureControl: Level2PressureControl;
  temperature: number; thermal: Level2ThermalControl; environmentAlarmMs: number;
  water: {
    tiles: WaterTile[]; rotations: number[]; requiredOrder: ["A" | "B" | "C" | "D", "A" | "B" | "C" | "D"];
    connected: boolean; solved: boolean; invalidOrder: boolean;
    flowingIndices: number[]; digits: string;
  };
  ignition: {
    rate: BallastRate;
    panelOpen: boolean;
    assist: boolean;
    dutyWarningIssued: boolean;
    running: boolean;
    runElapsedMs: number;
    runCount: number;
    charge: number;
    pattern: number[];
    keys: [string, string, string, string];
    results: Array<"hit" | "miss" | null>;
    solved: boolean;
    digits: string;
  };
  plant: { health: 0 | 1 | 2 | 3 | 4; stress: number; transferred: boolean };
  pod: { input: string; opened: boolean };
  history: string[];
}

export type Level2Action =
  | { type: "TICK"; deltaMs: number } | { type: "SPEND_RESERVE"; amount: number; reason: string }
  | { type: "SET_OVERLAY"; open: boolean } | { type: "CRANK_PRESSURE"; amount: number }
  | { type: "SET_IGNITION_PANEL"; open: boolean }
  | { type: "SET_THERMAL_PANEL"; open: boolean }
  | { type: "PICK_UP_THERMAL_PLUG"; feed: ThermalFeedId }
  | { type: "SEAT_THERMAL_PLUG"; socket: ThermalSocketId }
  | { type: "DROP_THERMAL_PLUG" }
  | { type: "ROTATE_PIPE"; index: number }
  | { type: "START_IGNITION"; pullSpeed: number }
  | { type: "STRIKE_CONTACT"; key: string }
  | { type: "SET_BALLAST_RATE"; rate: BallastRate }
  | { type: "ENABLE_IGNITION_ASSIST" }
  | { type: "TRANSFER_SAPLING" } | { type: "POD_DIGIT"; digit: string }
  | { type: "POD_BACKSPACE" } | { type: "SUBMIT_POD_CODE" }
  | { type: "DEV_STABILIZE" } | { type: "DEV_SOLVE_WATER" }
  | { type: "DEV_REMAP_THERMAL" } | { type: "DEV_MATCH_THERMAL" }
  | { type: "DEV_SOLVE_IGNITION" } | { type: "DEV_READY_TRANSFER" } | { type: "DEV_OPEN_POD" }
  | { type: "RESET_RUN" };
export interface Level2Transition { ok: boolean; state: Level2State; error?: string; effects: string[] }

const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));
const safe = (value: number, band: { min: number; max: number }) => value >= band.min && value <= band.max;
function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => { value = (value * 1664525 + 1013904223) >>> 0; return value / 0x100000000; };
}
function shuffle<T>(values: readonly T[], random: () => number): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [result[index], result[swap]] = [result[swap]!, result[index]!];
  }
  return result;
}
const digits = (random: () => number) => Array.from({ length: 3 }, () => Math.floor(random() * 10)).join("");
const appendHistory = (state: Level2State, event: string): Level2State => ({ ...state, history: [...state.history.slice(-31), event] });
function phaseFor(state: Level2State): Level2Phase {
  if (state.pod.opened) return "complete";
  if (state.water.solved && state.ignition.solved) return "pod";
  if (state.water.solved) return "ignition";
  return safe(state.pressure, state.pressureControl.band) && safe(state.temperature, TEMPERATURE_SAFE_BAND) ? "water" : "stabilize";
}
export const getBallastRateIndex = (rate: BallastRate) => BALLAST_RATES.indexOf(rate);
export const getIgnitionTimingWindow = (state: Level2State) => state.ignition.assist ? IGNITION_ASSIST_WINDOW_MS : IGNITION_TIMING_WINDOW_MS;
export const getIgnitionContactTime = (state: Level2State, index: number) => 1_400 + index * IGNITION_RATE_SPACING_MS[state.ignition.rate];
export const getLaunchCode = (state: Level2State) => `${state.water.digits}${state.ignition.digits}`;
export const getPressureBand = (state: Level2State) => state.pressureControl.band;
export const isPressureAbnormal = (state: Pick<Level2State, "pressure" | "pressureControl">) =>
  !safe(state.pressure, state.pressureControl.band);
export const isTemperatureAbnormal = (state: Pick<Level2State, "temperature" | "thermal">) =>
  state.temperature > TEMPERATURE_SAFE_BAND.max && getThermalMismatchCount(state) > 0;
export const isEnvironmentAbnormal = (state: Pick<Level2State, "pressure" | "pressureControl" | "temperature" | "thermal">) =>
  isPressureAbnormal(state) || isTemperatureAbnormal(state);
export const canTransferSapling = (state: Level2State) => state.water.solved && state.ignition.solved
  && safe(state.pressure, state.pressureControl.band) && safe(state.temperature, TEMPERATURE_SAFE_BAND);
export function getThermalMismatchCount(state: Pick<Level2State, "thermal">): number {
  return THERMAL_PORT_IDS.reduce((count, port, index) => {
    const occupant = THERMAL_FEED_IDS.find((feed) => state.thermal.connections[feed] === port);
    return count + (occupant === state.thermal.portAssignments[index] ? 0 : 1);
  }, 0);
}

function baseConnections(tile: WaterTile): WaterSide[] {
  const shape = tile.kind === "stage" ? tile.shape : tile.kind;
  return shape === "straight" ? [1, 3] : shape === "elbow" ? [1, 2] : [];
}
export const getWaterConnections = (tile: WaterTile, rotation: number): WaterSide[] =>
  baseConnections(tile).map((side) => ((side + rotation) % 4) as WaterSide);
const OPPOSITE: Record<WaterSide, WaterSide> = { 0: 2, 1: 3, 2: 0, 3: 1 };
const STEP: Record<WaterSide, readonly [number, number]> = { 0: [0, -1], 1: [1, 0], 2: [0, 1], 3: [-1, 0] };

export function traceWaterRoute(state: Pick<Level2State, "water">) {
  const indices: number[] = [];
  const order: Array<"A" | "B" | "C" | "D"> = [];
  let index = WATER_INLET_INDEX;
  let enteredFrom: WaterSide = 3;
  const visited = new Set<string>();
  for (let step = 0; step < 32; step += 1) {
    const tile = state.water.tiles[index];
    if (!tile || tile.kind === "blocked" || tile.kind === "empty") break;
    const key = `${index}:${enteredFrom}`;
    if (visited.has(key)) break;
    visited.add(key);
    const connections = getWaterConnections(tile, state.water.rotations[index] ?? 0);
    if (!connections.includes(enteredFrom)) break;
    indices.push(index);
    if (tile.stage) order.push(tile.stage);
    const exit = connections.find((side) => side !== enteredFrom);
    if (exit === undefined) break;
    if (index === WATER_OUTLET_INDEX && exit === 1) return {
      connected: true, order, indices
    };
    const [dx, dy] = STEP[exit];
    const x = index % 4 + dx;
    const y = Math.floor(index / 4) + dy;
    if (x < 0 || x >= 4 || y < 0 || y >= 4) break;
    index = y * 4 + x;
    enteredFrom = OPPOSITE[exit];
  }
  return { connected: false, order, indices };
}

function makeWaterTiles(random: () => number) {
  const stageLetters = shuffle(["A", "B", "C", "D"] as const, random);
  const tiles: WaterTile[] = [
    { kind: "elbow" }, { kind: "straight" }, { kind: "elbow" }, { kind: "blocked" },
    { kind: "stage", shape: "elbow" }, { kind: "empty" }, { kind: "stage", shape: "elbow" }, { kind: "elbow" },
    { kind: "elbow" }, { kind: "stage", shape: "straight" }, { kind: "stage", shape: "elbow" }, { kind: "straight" },
    { kind: "empty" }, { kind: "blocked" }, { kind: "empty" }, { kind: "elbow" }
  ];
  WATER_STAGE_INDICES.forEach((index, stageIndex) => { tiles[index] = { ...tiles[index], stage: stageLetters[stageIndex] }; });
  return { tiles, requiredOrder: [stageLetters[0]!, stageLetters[1]!] as Level2State["water"]["requiredOrder"] };
}

function makePressureCycle(seed: number, cycle: number): Level2PressureControl {
  const random = seededRandom((seed ^ Math.imul(cycle + 1, 0x9e3779b1)) >>> 0);
  const width = 24 + random() * 14;
  const center = 20 + width / 2 + random() * (60 - width);
  const initialSign = (seed & 1) === 0 ? 1 : -1;
  const direction = cycle % 2 === 0 ? initialSign : -initialSign;
  return {
    band: { min: center - width / 2, max: center + width / 2 },
    drift: direction * (PRESSURE_DRIFT_MIN + random() * PRESSURE_DRIFT_RANGE),
    cycle,
    nextShiftMs: Number.MAX_SAFE_INTEGER
  };
}

function advancePressure(state: Level2State, deltaMs: number): { pressure: number; pressureControl: Level2PressureControl } {
  const control = state.pressureControl;
  const bandCenter = (control.band.min + control.band.max) / 2;
  const direction = state.pressure < bandCenter ? -1 : state.pressure > bandCenter ? 1 : Math.sign(control.drift) || 1;
  const drift = direction * Math.abs(control.drift);
  const pressure = clamp(state.pressure + Math.max(0, deltaMs) / 1000 * drift);
  return { pressure, pressureControl: { ...control, drift } };
}

const nextThermalSwapDelay = (_seed: number, cycle: number) => cycle === 0 ? 120_000 : 60_000;

function remapThermalPorts(state: Level2State, thermal: Level2ThermalControl): Level2ThermalControl {
  const random = seededRandom((state.seed ^ Math.imul(thermal.cycle + 31, 0x9e3779b1)) >>> 0);
  const first = Math.floor(random() * 4);
  let second = Math.floor(random() * 3);
  if (second >= first) second += 1;
  const portAssignments = [...thermal.portAssignments] as Level2ThermalControl["portAssignments"];
  [portAssignments[first], portAssignments[second]] = [portAssignments[second]!, portAssignments[first]!];
  return {
    ...thermal,
    portAssignments,
    cycle: thermal.cycle + 1,
    swapCountdownMs: nextThermalSwapDelay(state.seed, thermal.cycle + 1),
    waitingForGreen: true,
    hasRemapped: true,
    lastSwap: [first, second]
  };
}

function advanceThermal(state: Level2State, deltaMs: number): { thermal: Level2ThermalControl; temperature: number; effect?: string } {
  let thermal = state.thermal;
  const duration = Math.max(0, deltaMs);
  const evolve = (temperature: number, mismatchCount: number, durationMs: number) => {
    if (mismatchCount > 0) {
      return clamp(100 + (temperature - 100) * Math.exp(-0.052 * durationMs / 1000));
    }
    const target = 22;
    const slowResponse = 0.20;
    if (temperature <= TEMPERATURE_SAFE_BAND.max) {
      return clamp(target + (temperature - target) * Math.exp(-slowResponse * durationMs / 1000));
    }
    const fastResponse = 0.22;
    const timeToGreenMs = Math.log((temperature - target) / (TEMPERATURE_SAFE_BAND.max - target)) / fastResponse * 1000;
    if (durationMs <= timeToGreenMs) {
      return clamp(target + (temperature - target) * Math.exp(-fastResponse * durationMs / 1000));
    }
    const remainingMs = durationMs - timeToGreenMs;
    return clamp(target + (TEMPERATURE_SAFE_BAND.max - target) * Math.exp(-slowResponse * remainingMs / 1000));
  };
  const mismatchCount = getThermalMismatchCount({ thermal });

  if (thermal.waitingForGreen || mismatchCount > 0) {
    const temperature = evolve(state.temperature, mismatchCount, duration);
    if (mismatchCount === 0 && safe(temperature, TEMPERATURE_SAFE_BAND)) {
      thermal = { ...thermal, waitingForGreen: false, swapCountdownMs: nextThermalSwapDelay(state.seed, thermal.cycle) };
    } else if (!thermal.waitingForGreen) {
      thermal = { ...thermal, waitingForGreen: true };
    }
    return { thermal, temperature };
  }

  if (duration < thermal.swapCountdownMs) {
    return {
      thermal: { ...thermal, swapCountdownMs: thermal.swapCountdownMs - duration },
      temperature: evolve(state.temperature, 0, duration)
    };
  }

  const firstRemap = !thermal.hasRemapped;
  const untilRemap = thermal.swapCountdownMs;
  const temperatureAtRemap = evolve(state.temperature, 0, untilRemap);
  thermal = remapThermalPorts(state, thermal);
  return {
    thermal,
    temperature: evolve(temperatureAtRemap, getThermalMismatchCount({ thermal }), duration - untilRemap),
    effect: firstRemap ? "THERMAL_PORTS_REMAPPED_FIRST" : "THERMAL_PORTS_REMAPPED"
  };
}

function makeIgnitionPattern(random: () => number): number[] {
  const pattern: number[] = [0, 1, 2, 3];
  while (pattern.length < IGNITION_PATTERN_LENGTH) {
    const next = Math.floor(random() * 4);
    if (next === pattern.at(-1)) continue;
    pattern.push(next);
  }
  return shuffle(pattern, random);
}

const IGNITION_ARROW_KEYS = ["ArrowLeft", "ArrowUp", "ArrowDown", "ArrowRight"] as const;
const normalizeIgnitionKey = (key: string) => key.startsWith("Arrow") ? key : key.toUpperCase();
const ignitionGain = (rate: BallastRate) => [6.5, 7.2, 8, 8.6][getBallastRateIndex(rate)]!;
const IGNITION_BLEED_PER_SECOND = 2.5;
const IGNITION_MISS_PENALTY = 5;

function advanceIgnition(state: Level2State, deltaMs: number): { ignition: Level2State["ignition"]; missCount: number; effect?: string } {
  if (!state.ignition.panelOpen || !state.ignition.running || state.ignition.solved) return { ignition: state.ignition, missCount: 0 };
  const elapsed = state.ignition.runElapsedMs + deltaMs;
  const window = getIgnitionTimingWindow(state);
  const results = [...state.ignition.results];
  let charge = clamp(state.ignition.charge - deltaMs / 1000 * IGNITION_BLEED_PER_SECOND, 0, IGNITION_STRIKE_THRESHOLD);
  let missCount = 0;
  for (let index = 0; index < results.length; index += 1) {
    if (results[index] !== null || elapsed <= getIgnitionContactTime(state, index) + window) continue;
    results[index] = "miss";
    charge = clamp(charge - IGNITION_MISS_PENALTY, 0, IGNITION_STRIKE_THRESHOLD);
    missCount += 1;
  }
  const finalTime = getIgnitionContactTime(state, results.length - 1) + window + 450;
  const running = elapsed < finalTime;
  return {
    ignition: { ...state.ignition, runElapsedMs: elapsed, charge, results, running },
    missCount,
    effect: missCount > 0 ? "IGNITION_MISS" : !running ? "IGNITION_PASS_COMPLETE" : undefined
  };
}

export function createInitialLevel2State(seed = 0x47543232): Level2State {
  const random = seededRandom(seed);
  const waterBoard = makeWaterTiles(random);
  const rotations = waterBoard.tiles.map((tile, index) => tile.kind === "blocked" || tile.kind === "empty" ? 0 : (WATER_CLEAN_SOLUTION[index]! + 1 + Math.floor(random() * 3)) % 4);
  const pressureControl = makePressureCycle(seed, 0);
  const portAssignments = shuffle(THERMAL_FEED_IDS, random) as Level2ThermalControl["portAssignments"];
  const thermal: Level2ThermalControl = {
    panelOpen: false,
    portAssignments,
    connections: Object.fromEntries(THERMAL_FEED_IDS.map((feed) => [feed, `port_${portAssignments.indexOf(feed)}`])) as Level2ThermalControl["connections"],
    held: null,
    cycle: 0,
    swapCountdownMs: nextThermalSwapDelay(seed, 0),
    waitingForGreen: false,
    hasRemapped: false,
    lastSwap: null
  };
  const keys = [...IGNITION_ARROW_KEYS] as [string, string, string, string];
  const pattern = makeIgnitionPattern(random);
  return {
    seed, phase: "arrival", elapsedMs: 0, reserve: 10.5, overlayOpen: false,
    pressure: (pressureControl.band.min + pressureControl.band.max) / 2, pressureControl, temperature: 20, thermal, environmentAlarmMs: 0,
    water: { ...waterBoard, rotations, connected: false, solved: false, invalidOrder: false, flowingIndices: [], digits: digits(random) },
    ignition: {
      rate: "nominal", panelOpen: false, assist: false, dutyWarningIssued: false,
      running: false, runElapsedMs: 0, runCount: 0, charge: 0,
      pattern, keys, results: pattern.map(() => null), solved: false, digits: digits(random)
    },
    plant: { health: 2, stress: 2, transferred: false }, pod: { input: "", opened: false }, history: ["LEVEL2_ARRIVAL"]
  };
}

const succeedEffects = (state: Level2State, effects: string[]): Level2Transition => {
  let next = { ...state, phase: phaseFor(state) };
  for (const effect of effects) next = appendHistory(next, effect);
  return { ok: true, state: next, effects };
};
const succeed = (state: Level2State, effect?: string): Level2Transition => succeedEffects(state, effect ? [effect] : []);
const fail = (state: Level2State, error: string): Level2Transition => ({ ok: false, state, error, effects: [] });
function applyWaterRotations(state: Level2State, rotations: number[]): Level2State {
  const candidate = { ...state, water: { ...state.water, rotations } };
  const trace = traceWaterRoute(candidate);
  const correctOrder = trace.connected && trace.order.join("") === state.water.requiredOrder.join("");
  return {
    ...candidate,
    water: { ...candidate.water, connected: trace.connected, solved: correctOrder, invalidOrder: trace.connected && !correctOrder, flowingIndices: trace.indices }
  };
}

export function applyLevel2Action(state: Level2State, action: Level2Action): Level2Transition {
  if (action.type === "RESET_RUN") return succeed(createInitialLevel2State(state.seed), "LEVEL2_RESET");
  if (state.phase === "complete" && action.type !== "TICK") return fail(state, "The greenhouse transfer is complete.");
  switch (action.type) {
    case "TICK": {
      if (state.phase === "complete") return succeed(state);
      const seconds = Math.min(60, Math.max(0, action.deltaMs / 1000));
      const { pressure, pressureControl } = advancePressure(state, action.deltaMs);
      const thermalAdvance = advanceThermal(state, action.deltaMs);
      const { thermal, temperature } = thermalAdvance;
      const { ignition, missCount: ignitionMissCount, effect: ignitionEffect } = advanceIgnition(state, action.deltaMs);
      const abnormal = isEnvironmentAbnormal({ pressure, pressureControl, temperature, thermal });
      const alarmTotalMs = abnormal ? state.environmentAlarmMs + Math.max(0, action.deltaMs) : 0;
      const alarmCharges = Math.floor(alarmTotalMs / 5_000);
      const environmentAlarmMs = abnormal ? alarmTotalMs % 5_000 : 0;
      const stable = safe(pressure, pressureControl.band) && safe(temperature, TEMPERATURE_SAFE_BAND);
      const stress = clamp(state.plant.stress + seconds * (stable ? -0.006 : 0.018), 0, 4);
      return succeedEffects({
        ...state,
        elapsedMs: state.elapsedMs + action.deltaMs,
        pressure,
        pressureControl,
        temperature,
        thermal,
        environmentAlarmMs,
        reserve: Math.max(0, Math.round((state.reserve - alarmCharges * 0.5 - ignitionMissCount * 0.1) * 100) / 100),
        ignition,
        plant: { ...state.plant, stress, health: Math.round(stress) as 0 | 1 | 2 | 3 | 4 }
      }, [thermalAdvance.effect, ignitionEffect, alarmCharges > 0 ? "AUX_ENVIRONMENT_DRAIN" : undefined].filter((effect): effect is string => Boolean(effect)));
    }
    case "SPEND_RESERVE":
      if (action.amount < 0) return fail(state, "Reserve spend cannot be negative.");
      if (state.reserve < action.amount) return fail(state, "AUX reserve unavailable.");
      return succeed({ ...state, reserve: Math.round((state.reserve - action.amount) * 100) / 100 }, `AUX_${action.reason.toUpperCase().replaceAll(" ", "_")}`);
    case "SET_OVERLAY": return succeed({ ...state, overlayOpen: action.open });
    case "SET_IGNITION_PANEL": return succeed({ ...state, ignition: { ...state.ignition, panelOpen: action.open } });
    case "SET_THERMAL_PANEL": return succeed({
      ...state,
      thermal: { ...state.thermal, panelOpen: action.open, held: action.open ? state.thermal.held : null }
    });
    case "CRANK_PRESSURE": return succeed({ ...state, pressure: clamp(state.pressure + action.amount) });
    case "PICK_UP_THERMAL_PLUG":
      if (state.thermal.held) return fail(state, "Demi can hold only one thermal plug at a time.");
      return succeed({
        ...state,
        thermal: {
          ...state.thermal,
          held: action.feed,
          waitingForGreen: true,
          connections: { ...state.thermal.connections, [action.feed]: null }
        }
      }, "THERMAL_PLUG_LIFTED");
    case "SEAT_THERMAL_PLUG": {
      const held = state.thermal.held;
      if (!held) return fail(state, "No thermal plug is being held.");
      const occupied = THERMAL_FEED_IDS.some((feed) => state.thermal.connections[feed] === action.socket);
      if (occupied) return fail(state, "That socket is already occupied.");
      return succeed({
        ...state,
        thermal: {
          ...state.thermal,
          held: null,
          connections: { ...state.thermal.connections, [held]: action.socket }
        }
      }, "THERMAL_PLUG_SEATED");
    }
    case "DROP_THERMAL_PLUG":
      return succeed({ ...state, thermal: { ...state.thermal, held: null } }, "THERMAL_PLUG_DROPPED");
    case "ROTATE_PIPE": {
      const tile = state.water.tiles[action.index];
      if (!tile || tile.kind === "blocked" || tile.kind === "empty") return fail(state, "That section cannot rotate.");
      const rotations = [...state.water.rotations];
      rotations[action.index] = ((rotations[action.index] ?? 0) + 1) % 4;
      const next = applyWaterRotations(state, rotations);
      const effect = next.water.solved && !state.water.solved ? "WATER_FLOWING" : next.water.invalidOrder && !state.water.invalidOrder ? "WATER_ORDER_INVALID" : undefined;
      return succeed(next, effect);
    }
    case "START_IGNITION":
      if (action.pullSpeed < 460) return fail(state, "Pull the exciter handle faster.");
      return succeed({
        ...state,
        ignition: {
          ...state.ignition,
          running: true,
          runElapsedMs: -3_000,
          runCount: state.ignition.runCount + 1,
          charge: 0,
          results: state.ignition.pattern.map(() => null)
        }
      }, "IGNITION_STARTED");
    case "STRIKE_CONTACT": {
      if (!state.ignition.running) return fail(state, "The exciter is not turning.");
      if (state.ignition.runElapsedMs < 0) return fail(state, "The sequencer is counting down.");
      const key = normalizeIgnitionKey(action.key);
      const lane = state.ignition.keys.indexOf(key);
      if (lane < 0) return fail(state, "That key is not wired to the sequencer.");
      const window = getIgnitionTimingWindow(state);
      let bestIndex = -1;
      let bestDistance = Number.POSITIVE_INFINITY;
      state.ignition.pattern.forEach((noteLane, index) => {
        if (noteLane !== lane || state.ignition.results[index] !== null) return;
        const distance = Math.abs(getIgnitionContactTime(state, index) - state.ignition.runElapsedMs);
        if (distance <= window && distance < bestDistance) {
          bestDistance = distance;
          bestIndex = index;
        }
      });
      if (bestIndex < 0) {
        return succeed({
          ...state,
          reserve: Math.max(0, Math.round((state.reserve - 0.1) * 100) / 100),
          ignition: { ...state.ignition, charge: clamp(state.ignition.charge - IGNITION_MISS_PENALTY) }
        }, "IGNITION_MISS");
      }
      const results = [...state.ignition.results];
      results[bestIndex] = "hit";
      const charge = clamp(state.ignition.charge + ignitionGain(state.ignition.rate), 0, IGNITION_STRIKE_THRESHOLD);
      const solved = charge >= IGNITION_STRIKE_THRESHOLD;
      return succeed({
        ...state,
        ignition: { ...state.ignition, charge, results, solved, running: solved ? false : state.ignition.running }
      }, solved ? "IGNITION_COMPLETE" : "IGNITION_HIT");
    }
    case "SET_BALLAST_RATE": {
      const currentIndex = getBallastRateIndex(state.ignition.rate);
      const requestedIndex = getBallastRateIndex(action.rate);
      if (requestedIndex < 0) return fail(state, "Unknown ballast rate.");
      if (requestedIndex > currentIndex + 1) return fail(state, "Increase ballast drive one step at a time.");
      if (requestedIndex === currentIndex) return succeed(state);
      const cost = requestedIndex > currentIndex ? 1 : 0;
      if (state.reserve < cost) return fail(state, "AUX reserve unavailable.");
      const warning = requestedIndex >= 2 && !state.ignition.dutyWarningIssued;
      return succeed({
        ...state,
        reserve: Math.round((state.reserve - cost) * 100) / 100,
        ignition: {
          ...state.ignition,
          rate: action.rate,
          dutyWarningIssued: state.ignition.dutyWarningIssued || warning
        }
      }, warning ? "BALLAST_DUTY_WARNING" : "BALLAST_RATE_CHANGED");
    }
    case "ENABLE_IGNITION_ASSIST":
      return succeed({ ...state, ignition: { ...state.ignition, assist: true } }, "IGNITION_WINDOW_WIDENED");
    case "TRANSFER_SAPLING":
      if (!canTransferSapling(state)) return fail(state, "Water, light, pressure, and temperature must all be stable together.");
      return succeed({ ...state, plant: { ...state.plant, transferred: true } }, "SAPLING_TRANSFERRED");
    case "POD_DIGIT":
      if (!/^\d$/.test(action.digit) || state.pod.input.length >= 6) return fail(state, "The keypad accepts six digits.");
      return succeed({ ...state, pod: { ...state.pod, input: `${state.pod.input}${action.digit}` } });
    case "POD_BACKSPACE": return succeed({ ...state, pod: { ...state.pod, input: state.pod.input.slice(0, -1) } });
    case "SUBMIT_POD_CODE":
      if (state.pod.input !== getLaunchCode(state)) return fail({ ...state, pod: { ...state.pod, input: "" } }, "The pod rejects the sequence.");
      return succeed({ ...state, pod: { ...state.pod, opened: true } }, "POD_OPENED");
    case "DEV_STABILIZE": return succeed({ ...state, pressure: (state.pressureControl.band.min + state.pressureControl.band.max) / 2, temperature: 20 }, "DEV_STABILIZED");
    case "DEV_REMAP_THERMAL": {
      const first = !state.thermal.hasRemapped;
      return succeed({ ...state, thermal: remapThermalPorts(state, state.thermal) }, first ? "THERMAL_PORTS_REMAPPED_FIRST" : "THERMAL_PORTS_REMAPPED");
    }
    case "DEV_MATCH_THERMAL": {
      const connections = Object.fromEntries(THERMAL_FEED_IDS.map((feed) => [feed, `port_${state.thermal.portAssignments.indexOf(feed)}`])) as Level2ThermalControl["connections"];
      return succeed({
        ...state,
        temperature: 20,
        thermal: {
          ...state.thermal,
          connections,
          held: null,
          waitingForGreen: false,
          swapCountdownMs: nextThermalSwapDelay(state.seed, state.thermal.cycle)
        }
      }, "DEV_THERMAL_MATCHED");
    }
    case "DEV_SOLVE_WATER": return succeed(applyWaterRotations(state, [...WATER_CLEAN_SOLUTION]), "DEV_WATER_SOLVED");
    case "DEV_SOLVE_IGNITION": return succeed({ ...state, ignition: { ...state.ignition, solved: true, running: false, charge: 100 } }, "DEV_IGNITION_SOLVED");
    case "DEV_READY_TRANSFER": {
      const water = applyWaterRotations(state, [...WATER_CLEAN_SOLUTION]).water;
      return succeed({
        ...state,
        pressure: (state.pressureControl.band.min + state.pressureControl.band.max) / 2,
        temperature: 20,
        water,
        ignition: { ...state.ignition, solved: true, running: false, charge: 100 }
      }, "DEV_TRANSFER_READY");
    }
    case "DEV_OPEN_POD": return succeed({ ...state, pod: { input: getLaunchCode(state), opened: true } }, "DEV_POD_OPENED");
  }
}
