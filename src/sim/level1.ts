export const LEVEL1_MAX_RESERVE = 16;
export const LEVEL1_BUS_RESTORE_GAIN = 6;

export type Level1Phase =
  | "disconnected"
  | "foundation"
  | "wire_restore"
  | "spiral_repair"
  | "door_diversion"
  | "complete"
  | "failure";

export type Level1LightingStage = 1 | 2 | 3 | 4 | 5;
export type WireId = "blue_heavy" | "green_light" | "cloth_mid" | "ridged_heavy" | "smooth_light";
export type WirePort = "P1" | "P2" | "P3" | "P4" | "P5";
export type ContinuityGear = 1 | 2 | 3 | 4 | 5 | 6;
export type ContinuitySequence = [ContinuityGear, ContinuityGear, ContinuityGear];
export const SIGNAL_GLYPHS = ["RING", "BAR", "HEX", "FORK"] as const;
export type SignalGlyph = typeof SIGNAL_GLYPHS[number];
export type SignalSequence = [SignalGlyph, SignalGlyph, SignalGlyph];
export const JUNCTION_FINGERPRINTS = ["duplicate", "delayed", "dropped"] as const;
export type JunctionFingerprint = typeof JUNCTION_FINGERPRINTS[number];
export type JunctionRoute = "none" | "rough" | "clean";
export type RegulatorTune = "none" | "rough" | "precise";
export type RegulatorFrequencyReading = "high" | "low" | "aligned";
export type RegulatorBalanceReading = "leading" | "trailing" | "aligned";
export type BreakerPosition = "down" | "up" | "tripped" | "pulled";

export const JUNCTION_VISIBLE_NODES = [0, 1, 2] as const;
export const JUNCTION_HIDDEN_NODES = [] as const;
export const JUNCTION_ROUGH_TARGET = [0, 1, 2] as const;
export const JUNCTION_CLEAN_TARGET = JUNCTION_ROUGH_TARGET;
export const REGULATOR_ROUGH_TARGET = [2, 1, 3] as const;
export const REGULATOR_PRECISE_TARGET = [2, 2, 3.2] as const;
export const REGULATOR_ALIGNMENT_TOLERANCE = 0.24;
export const REGULATOR_TARGET_FREQUENCY = 64.9;
export const BREAKER_LOAD_ORDER = [0, 1, 2] as const;

export const LEVEL1_WIRES: ReadonlyArray<{ id: WireId; label: string; target: WirePort }> = [
  { id: "blue_heavy", label: "heavy blue conductor", target: "P5" },
  { id: "ridged_heavy", label: "ridged dark conductor", target: "P4" },
  { id: "cloth_mid", label: "cloth-wrapped medium conductor", target: "P3" },
  { id: "smooth_light", label: "smooth light conductor", target: "P2" },
  { id: "green_light", label: "thin green conductor", target: "P1" }
];

export const LEVEL1_PORT_IMPEDANCE: Readonly<Record<WirePort, number>> = {
  P1: 12,
  P2: 21,
  P3: 34,
  P4: 46,
  P5: 58
};

export interface Level1HistoryItem {
  sequence: number;
  code: string;
  label: string;
}

export interface Level1State {
  revision: number;
  runSeed: number;
  phase: Level1Phase;
  reserve: number;
  lightingStage: Level1LightingStage;
  foundation: {
    connected: boolean;
    wakeResponseHeard: boolean;
    openingResponseRelayed: boolean;
    diagnosticsRun: boolean;
    lastHeardMessage: string;
  };
  hands: {
    continuityHeld: boolean;
  };
  wires: {
    calibrationOrder: ContinuitySequence;
    targets: Record<WireId, WirePort>;
    impedance: Record<WirePort, number>;
    connections: Record<WireId, WirePort | null>;
    measuredPorts: WirePort[];
    mistakes: number;
    solved: boolean;
  };
  junctionPuzzle: {
    rotations: number[];
    signalSequence: SignalSequence;
    decodeProgress: number;
    decoded: boolean;
  };
  regulatorPuzzle: {
    sliders: number[];
    adjusted: boolean;
    checks: number;
    lastCheckedSliders: number[] | null;
  };
  breakerPuzzle: {
    positions: BreakerPosition[];
    touched: boolean[];
    glyphs: SignalGlyph[];
    faultIndex: number;
    orderProgress: number;
    arcFlashes: number;
  };
  spiral: {
    micReseated: boolean;
    listened: boolean;
    refined: boolean;
    finalRefined: boolean;
    junction: JunctionRoute;
    regulator: RegulatorTune;
    busRead: boolean;
    breaker4Pulled: boolean;
  };
  door: {
    diverted: boolean;
    opened: boolean;
  };
  skipped: {
    trustBeat: true;
  };
  failureReason: string | null;
  history: Level1HistoryItem[];
}

export type Level1Action =
  | { type: "CONNECT" }
  | { type: "DEMI_WAKE_RESPONSE"; message: string }
  | { type: "RELAY_OPENING_RESPONSE"; heardMessage?: string }
  | { type: "RELAY_MESSAGE"; heardMessage?: string }
  | { type: "RUN_DIAGNOSTICS" }
  | { type: "SPEND_RESERVE"; amount: number; reason: string }
  | { type: "PENALIZE_PUZZLE_MISTAKE"; puzzle: string }
  | { type: "COMPLETE_CONTINUITY_SEQUENCE" }
  | { type: "SET_CONTINUITY_HELD"; held: boolean }
  | { type: "RECORD_CONTINUITY"; port: WirePort }
  | { type: "CONNECT_WIRE"; wire: WireId; port: WirePort }
  | { type: "DISCONNECT_WIRE"; wire: WireId }
  | { type: "RESEAT_MIC" }
  | { type: "LISTEN" }
  | { type: "REFINE" }
  | { type: "SET_JUNCTION"; route: Exclude<JunctionRoute, "none"> }
  | { type: "ROTATE_JUNCTION_NODE"; index: number }
  | { type: "SELECT_JUNCTION_GLYPH"; glyph: SignalGlyph }
  | { type: "SET_REGULATOR"; tune: Exclude<RegulatorTune, "none"> }
  | { type: "SET_REGULATOR_SLIDER"; index: number; value: number }
  | { type: "CHECK_HARMONICS" }
  | { type: "READ_BUS" }
  | { type: "TOUCH_BREAKER"; index: number }
  | { type: "TOGGLE_BREAKER"; index: number }
  | { type: "PULL_BREAKER"; index: number }
  | { type: "PULL_BREAKER_4" }
  | { type: "RESET_BREAKER_4" }
  | { type: "DIVERT_DOOR" }
  | { type: "COMMIT_DOOR" }
  | { type: "RESET_RUN" };

export interface Level1Effect {
  type: "event" | "reaction" | "warning" | "failure";
  code: string;
  text: string;
}

export interface Level1Transition {
  state: Level1State;
  ok: boolean;
  effects: Level1Effect[];
  error?: string;
}

const emptyConnections = (): Record<WireId, WirePort | null> => ({
  blue_heavy: null,
  green_light: null,
  cloth_mid: null,
  ridged_heavy: null,
  smooth_light: null
});

const randomRunSeed = (): number => (Date.now() ^ Math.floor(Math.random() * 0x1_0000_0000)) >>> 0;

const seededShuffle = <T>(values: readonly T[], seed: number): T[] => {
  let value = seed >>> 0;
  const random = () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 0x1_0000_0000;
  };
  const shuffled = [...values];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
};

export function createContinuitySequence(seed: number): ContinuitySequence {
  const gears = seededShuffle<ContinuityGear>([1, 2, 3, 4, 5, 6], seed);
  return [gears[0], gears[1], gears[2]];
}

const WIRE_PORTS: WirePort[] = ["P1", "P2", "P3", "P4", "P5"];

const createWireImpedance = (seed: number): Record<WirePort, number> => {
  const shuffled = seededShuffle(Object.values(LEVEL1_PORT_IMPEDANCE), seed ^ 0x10_0f_ee);
  return Object.fromEntries(WIRE_PORTS.map((port, index) => [port, shuffled[index]])) as Record<WirePort, number>;
};

const createWireTargets = (impedance: Record<WirePort, number>): Record<WireId, WirePort> => {
  const descendingPorts = [...WIRE_PORTS].sort((a, b) => impedance[b] - impedance[a]);
  return Object.fromEntries(LEVEL1_WIRES.map((wire, index) => [wire.id, descendingPorts[index]])) as Record<WireId, WirePort>;
};

export const getSignalRotation = (glyph: SignalGlyph): number => ({ RING: 0, BAR: 1, HEX: 2, FORK: 3 })[glyph];

export function getJunctionTarget(state: Level1State): readonly number[] {
  return state.junctionPuzzle.signalSequence.map(getSignalRotation);
}

export function getJunctionFaultGlyph(state: Level1State): SignalGlyph {
  return SIGNAL_GLYPHS.find((glyph) => !state.junctionPuzzle.signalSequence.includes(glyph)) ?? "FORK";
}

export function getJunctionFingerprint(state: Level1State): JunctionFingerprint {
  return JUNCTION_FINGERPRINTS[state.runSeed % JUNCTION_FINGERPRINTS.length] ?? "duplicate";
}

export function getBreakerRestoreOrder(state: Level1State): number[] {
  return state.junctionPuzzle.signalSequence.map((glyph) => state.breakerPuzzle.glyphs.indexOf(glyph));
}

export function createInitialLevel1State(runSeed = randomRunSeed()): Level1State {
  const normalizedSeed = runSeed >>> 0;
  const signalGlyphs = seededShuffle(SIGNAL_GLYPHS, normalizedSeed ^ 0xa11ce);
  const signalSequence: SignalSequence = [signalGlyphs[0], signalGlyphs[1], signalGlyphs[2]];
  const breakerGlyphs = seededShuffle(SIGNAL_GLYPHS, normalizedSeed ^ 0xb4ea);
  const faultIndex = breakerGlyphs.indexOf(signalGlyphs[3]);
  const wireImpedance = createWireImpedance(normalizedSeed);
  return {
    revision: 0,
    runSeed: normalizedSeed,
    phase: "disconnected",
    reserve: LEVEL1_MAX_RESERVE,
    lightingStage: 1,
    foundation: {
      connected: false,
      wakeResponseHeard: false,
      openingResponseRelayed: false,
      diagnosticsRun: false,
      lastHeardMessage: ""
    },
    hands: { continuityHeld: false },
    wires: {
      calibrationOrder: createContinuitySequence(normalizedSeed),
      targets: createWireTargets(wireImpedance),
      impedance: wireImpedance,
      connections: emptyConnections(),
      measuredPorts: [],
      mistakes: 0,
      solved: false
    },
    junctionPuzzle: { rotations: Array(3).fill(0), signalSequence, decodeProgress: 0, decoded: false },
    regulatorPuzzle: { sliders: [0, 0, 0], adjusted: false, checks: 0, lastCheckedSliders: null },
    breakerPuzzle: {
      positions: breakerGlyphs.map((_, index) => index === faultIndex ? "tripped" : "down"),
      touched: Array(4).fill(false),
      glyphs: breakerGlyphs,
      faultIndex,
      orderProgress: 0,
      arcFlashes: 0
    },
    spiral: {
      micReseated: false,
      listened: false,
      refined: false,
      finalRefined: false,
      junction: "none",
      regulator: "none",
      busRead: false,
      breaker4Pulled: false
    },
    door: { diverted: false, opened: false },
    skipped: { trustBeat: true },
    failureReason: null,
    history: []
  };
}

const reserveBand = (reserve: number): "nominal" | "low" | "critical" | "empty" => {
  if (reserve <= 0) return "empty";
  if (reserve <= 2) return "critical";
  if (reserve <= 5) return "low";
  return "nominal";
};

export function getReserveBand(state: Level1State): ReturnType<typeof reserveBand> {
  return reserveBand(state.reserve);
}

const deriveStage = (state: Level1State): Level1LightingStage => {
  if (state.door.diverted || state.door.opened) return 5;
  if (state.spiral.breaker4Pulled && state.spiral.junction === "clean" && state.spiral.regulator === "precise") return 4;
  if (state.spiral.regulator !== "none") return 3;
  if (state.wires.solved) return 2;
  return 1;
};

const appendHistory = (state: Level1State, effects: Level1Effect[]): Level1State => {
  const events = effects.filter((effect) => effect.type === "event" || effect.type === "failure");
  if (!events.length) return state;
  const lastSequence = state.history.at(-1)?.sequence ?? 0;
  const additions = events.map((effect, index) => ({
    sequence: lastSequence + index + 1,
    code: effect.code,
    label: effect.text
  }));
  return { ...state, history: [...state.history, ...additions].slice(-60) };
};

const finish = (previous: Level1State, next: Level1State, effects: Level1Effect[]): Level1Transition => {
  const withDerived = { ...next, revision: previous.revision + 1 };
  withDerived.lightingStage = deriveStage(withDerived);
  return { state: appendHistory(withDerived, effects), ok: true, effects };
};

const reject = (state: Level1State, error: string, effect?: Level1Effect): Level1Transition => ({
  state,
  ok: false,
  effects: effect ? [effect] : [],
  error
});

const requireActive = (state: Level1State): string | null => {
  if (state.phase === "failure") return "The run has failed. Reset the run before continuing.";
  if (state.phase === "complete") return "The blast door is already open.";
  return null;
};

const matchesVisibleJunctionTarget = (rotations: readonly number[], target: readonly number[]): boolean =>
  JUNCTION_VISIBLE_NODES.every((node, index) => rotations[node] === target[index]);

const regulatorFrequencyForSliders = (sliders: readonly number[]): number => {
  const [coarse = 0, trim = 0] = sliders;
  return Math.round((91.4 - coarse * 7.4 - trim * 2.15) * 100) / 100;
};

const matchesRegulatorTarget = (sliders: readonly number[], _target: readonly number[]): boolean =>
  Math.abs((sliders[0] ?? 0) - REGULATOR_PRECISE_TARGET[0]) <= REGULATOR_ALIGNMENT_TOLERANCE
  && Math.abs((sliders[1] ?? 0) - REGULATOR_PRECISE_TARGET[1]) <= REGULATOR_ALIGNMENT_TOLERANCE
  && (sliders[2] ?? 0) >= REGULATOR_PRECISE_TARGET[2];

const puzzleMistakeEffects = (puzzle: string): Level1Effect[] => [
    { type: "event", code: "PUZZLE_MISTAKE", text: `${puzzle.toUpperCase()} FAULT` },
    { type: "warning", code: "PUZZLE_MISTAKE", text: "AUX reserve drained 0.5." }
  ];

export function getRegulatorFrequency(state: Level1State): number {
  return regulatorFrequencyForSliders(state.regulatorPuzzle.sliders);
}

export function getRegulatorSignal(state: Level1State): {
  frequency: RegulatorFrequencyReading;
  balance: RegulatorBalanceReading;
  ringing: "present" | "clear";
  candidate: boolean;
} {
  const [balance = 0, frequency = 0, damping = 0] = state.regulatorPuzzle.sliders;
  return {
    frequency: frequency < 2 - REGULATOR_ALIGNMENT_TOLERANCE ? "high" : frequency > 2 + REGULATOR_ALIGNMENT_TOLERANCE ? "low" : "aligned",
    balance: balance < 2 - REGULATOR_ALIGNMENT_TOLERANCE ? "leading" : balance > 2 + REGULATOR_ALIGNMENT_TOLERANCE ? "trailing" : "aligned",
    ringing: damping >= REGULATOR_PRECISE_TARGET[2] ? "clear" : "present",
    candidate: matchesRegulatorTarget(state.regulatorPuzzle.sliders, REGULATOR_PRECISE_TARGET)
  };
}

export function applyLevel1Action(state: Level1State, action: Level1Action): Level1Transition {
  if (action.type === "RESET_RUN") {
    return { state: createInitialLevel1State(), ok: true, effects: [{ type: "event", code: "RUN_RESET", text: "RUN RESET" }] };
  }

  const inactive = requireActive(state);
  if (inactive && action.type !== "RELAY_MESSAGE") return reject(state, inactive);

  switch (action.type) {
    case "CONNECT": {
      if (state.foundation.connected) return reject(state, "KORE is already connected.");
      const effects: Level1Effect[] = [{ type: "event", code: "AGENT_CONNECTED", text: "AGENT CONNECTION ESTABLISHED" }];
      return finish(state, {
        ...state,
        phase: "foundation",
        foundation: { ...state.foundation, connected: true }
      }, effects);
    }
    case "DEMI_WAKE_RESPONSE": {
      if (!state.foundation.connected) return reject(state, "Connect before receiving Demi's response.");
      if (state.foundation.wakeResponseHeard) return reject(state, "Demi's wake response has already been received.");
      const message = action.message.trim();
      if (!message) return reject(state, "Demi's wake response cannot be empty.");
      return finish(state, {
        ...state,
        foundation: {
          ...state.foundation,
          wakeResponseHeard: true,
          lastHeardMessage: message
        }
      }, [{ type: "event", code: "CREW_RESPONSE_DETECTED", text: "CREW RESPONSE DETECTED" }]);
    }
    case "RELAY_OPENING_RESPONSE": {
      if (!state.foundation.connected) return reject(state, "Connect before transmitting.");
      if (!state.foundation.wakeResponseHeard) return reject(state, "Wait for Demi's first response before answering her.");
      const effects: Level1Effect[] = [{ type: "event", code: "OPENING_RESPONSE_RELAYED", text: "KORE RESPONSE RELAYED" }];
      return finish(state, {
        ...state,
        foundation: {
          ...state.foundation,
          openingResponseRelayed: true,
          lastHeardMessage: action.heardMessage?.trim() || state.foundation.lastHeardMessage
        }
      }, effects);
    }
    case "RELAY_MESSAGE": {
      if (!state.foundation.connected) return reject(state, "Connect before transmitting.");
      return finish(state, {
        ...state,
        foundation: {
          ...state.foundation,
          lastHeardMessage: action.heardMessage?.trim() || state.foundation.lastHeardMessage
        }
      }, [{ type: "event", code: "MESSAGE_RELAYED", text: "MESSAGE RELAYED" }]);
    }
    case "RUN_DIAGNOSTICS": {
      if (!state.foundation.openingResponseRelayed) return reject(state, "Answer Demi and establish that you need her eyes before diagnostics.");
      if (state.foundation.diagnosticsRun) return reject(state, "Initial diagnostics are already complete.");
      return finish(state, {
        ...state,
        phase: "wire_restore",
        foundation: { ...state.foundation, diagnosticsRun: true }
      }, [
        { type: "event", code: "DIAGNOSTICS_COMPLETE", text: "DIAGNOSTIC HANDSHAKE COMPLETE" },
        { type: "reaction", code: "DEMI_DIAGNOSTICS", text: "The room stays dark. The diagnostic sweep is complete." }
      ]);
    }
    case "SPEND_RESERVE": {
      if (!Number.isFinite(action.amount) || action.amount <= 0) return reject(state, "Reserve cost must be positive.");
      if (state.reserve < action.amount) return reject(state, `Insufficient AUX reserve for ${action.reason}.`);
      const nextReserve = Math.max(0, state.reserve - action.amount);
      const previousBand = reserveBand(state.reserve);
      const nextBand = reserveBand(nextReserve);
      const effects: Level1Effect[] = [{ type: "event", code: "AUX_SPENT", text: `AUX DRAW: ${action.reason.toUpperCase()}` }];
      if (previousBand !== nextBand && nextBand !== "nominal") {
        effects.push({
          type: "warning",
          code: `AUX_${nextBand.toUpperCase()}`,
          text: nextBand === "empty" ? "AUX reserve exhausted. High-resolution sensing is offline." : `AUX reserve ${nextBand}. Conserve high-resolution sensing.`
        });
      }
      return finish(state, { ...state, reserve: nextReserve }, effects);
    }
    case "PENALIZE_PUZZLE_MISTAKE":
      return finish(state, { ...state, reserve: Math.max(0, state.reserve - 0.5) }, puzzleMistakeEffects(action.puzzle));
    case "COMPLETE_CONTINUITY_SEQUENCE": {
      if (state.phase !== "wire_restore") return reject(state, "The continuity sequencer is not active.");
      if (state.wires.measuredPorts.length === 5) return reject(state, "All terminals have already been measured.");
      return finish(state, {
        ...state,
        hands: { continuityHeld: false },
        wires: { ...state.wires, measuredPorts: ["P1", "P2", "P3", "P4", "P5"] }
      }, [{
        type: "event",
        code: "CONTINUITY_SEQUENCE_COMPLETE",
        text: "CONTINUITY SEQUENCER COMPLETE"
      }]);
    }
    case "SET_CONTINUITY_HELD": {
      if (state.phase !== "wire_restore") return reject(state, "The continuity switch is not useful in the current phase.");
      if (state.hands.continuityHeld === action.held) return reject(state, action.held ? "Continuity switch is already held." : "Continuity switch is already released.");
      return finish(state, { ...state, hands: { continuityHeld: action.held } }, [{
        type: "event",
        code: action.held ? "CONTINUITY_HELD" : "CONTINUITY_RELEASED",
        text: action.held ? "CONTINUITY SWITCH HELD" : "CONTINUITY SWITCH RELEASED"
      }]);
    }
    case "RECORD_CONTINUITY": {
      if (state.phase !== "wire_restore" || !state.hands.continuityHeld) return reject(state, "Hold the continuity switch while measuring a terminal.");
      if (state.wires.measuredPorts.includes(action.port)) return reject(state, `${action.port} has already been measured.`);
      return finish(state, {
        ...state,
        wires: { ...state.wires, measuredPorts: [...state.wires.measuredPorts, action.port] }
      }, [{ type: "event", code: `CONTINUITY_${action.port}`, text: `${action.port} CONTINUITY MEASURED` }]);
    }
    case "CONNECT_WIRE": {
      if (state.phase !== "wire_restore") return reject(state, "Wire restoration is not active.");
      if (!state.wires.measuredPorts.includes(action.port)) {
        return reject(state, `${action.port} is untested. Run the continuity sequencer before seating conductors.`);
      }
      const occupyingWire = LEVEL1_WIRES.find((wire) =>
        wire.id !== action.wire && state.wires.connections[wire.id] === action.port
      );
      if (occupyingWire) return reject(state, `${action.port} is already occupied.`);
      const connections = { ...state.wires.connections, [action.wire]: action.port };
      const solved = LEVEL1_WIRES.every((wire) => connections[wire.id] === state.wires.targets[wire.id]);
      const correct = state.wires.targets[action.wire] === action.port;
      const penalizedReserve = correct ? state.reserve : Math.max(0, state.reserve - 0.5);
      const restoredReserve = solved ? Math.min(LEVEL1_MAX_RESERVE, penalizedReserve + LEVEL1_BUS_RESTORE_GAIN) : penalizedReserve;
      const recoveredReserve = restoredReserve - state.reserve;
      const effects: Level1Effect[] = [{
        type: "event",
        code: correct ? "WIRE_SEATED" : "WIRE_REJECTED",
        text: correct ? "CONDUCTOR SEATED" : "CONDUCTOR REJECTED"
      }];
      if (!correct) effects.push(
        { type: "warning", code: "PUZZLE_MISTAKE", text: "AUX reserve drained 0.5." },
        { type: "reaction", code: "DEMI_WIRE_SPARK", text: "Sparks snap from the wrong terminal." }
      );
      if (solved) {
        effects.push(
          { type: "event", code: "EMERGENCY_BUS_LIVE", text: "EMERGENCY BUS RESTORED" },
          { type: "event", code: "AUX_RECOVERED", text: `AUX RESERVE RECOVERED +${recoveredReserve}` },
          { type: "reaction", code: "DEMI_BUS_LIVE", text: "The emergency bus catches. Dim, but alive. The KORE relay glows on the center console." }
        );
      }
      return finish(state, {
        ...state,
        phase: solved ? "spiral_repair" : state.phase,
        reserve: restoredReserve,
        wires: { ...state.wires, connections, mistakes: state.wires.mistakes + (correct ? 0 : 1), solved }
      }, effects);
    }
    case "DISCONNECT_WIRE": {
      if (state.phase !== "wire_restore") return reject(state, "Wire restoration is not active.");
      if (!state.wires.connections[action.wire]) return finish(state, state, []);
      return finish(state, {
        ...state,
        wires: {
          ...state.wires,
          connections: { ...state.wires.connections, [action.wire]: null }
        }
      }, [{ type: "event", code: "WIRE_RELEASED", text: "CONDUCTOR RELEASED" }]);
    }
    case "RESEAT_MIC": {
      if (state.phase !== "spiral_repair") return reject(state, "Reach the spiral repair before reseating the microphone.");
      if (state.spiral.micReseated) return reject(state, "KORE's microphone head is already seated.");
      return finish(state, { ...state, spiral: { ...state.spiral, micReseated: true } }, [
        { type: "event", code: "MIC_RESEATED", text: "KORE MICROPHONE RESEATED" },
        { type: "reaction", code: "DEMI_MIC", text: "The mic head clicked back into place." }
      ]);
    }
    case "LISTEN": {
      if (!state.spiral.micReseated) return reject(state, "The microphone head is not seated.");
      if (state.spiral.listened) return reject(state, "The relay carrier is already being monitored.");
      return finish(state, {
        ...state,
        spiral: { ...state.spiral, listened: true, junction: "rough" }
      }, [
        { type: "event", code: "RELAY_CARRIER_LIVE", text: "RELAY CARRIER RESTORED" },
        { type: "event", code: "JUNCTION_SIGNAL_LIVE", text: "THREE-GLYPH JUNCTION SIGNAL ACTIVE" },
        { type: "reaction", code: "DEMI_JUNCTION_SIGNAL", text: "A glyph stream begins cycling across the junction display." }
      ]);
    }
    case "REFINE": {
      if (!state.spiral.listened) return reject(state, "Capture a coarse acoustic sample before refining it.");
      if (!state.spiral.breaker4Pulled || state.spiral.junction !== "clean") return reject(state, "Isolate the fault branch before sampling the regulator.");
      if (state.spiral.finalRefined) return reject(state, "The post-isolation sample has already been resolved.");
      const precise = matchesRegulatorTarget(state.regulatorPuzzle.sliders, REGULATOR_PRECISE_TARGET);
      const lastChecked = state.regulatorPuzzle.lastCheckedSliders;
      const checkedCurrentPosition = Boolean(lastChecked)
        && lastChecked?.every((value, index) => Math.abs(value - (state.regulatorPuzzle.sliders[index] ?? 0)) < 0.001);
      if (!precise || !checkedCurrentPosition) return reject(state, "The coarse harmonic check has not produced a stable confirmation candidate.");
      return finish(state, {
        ...state,
        spiral: { ...state.spiral, finalRefined: true, regulator: "precise" }
      }, [
        { type: "event", code: "FINAL_REFINE_COMPLETE", text: "POST-ISOLATION REGULATOR SAMPLE RESOLVED" },
        { type: "event", code: "REGULATOR_PRECISE", text: "REGULATOR PRECISE TUNE" },
        { type: "reaction", code: "DEMI_REGULATOR", text: "Clack... the three levers lock. The carrier hum steadies." }
      ]);
    }
    case "SET_JUNCTION": {
      if (state.phase !== "spiral_repair") return reject(state, "Junction routing is not active.");
      if (action.route === "clean" && !state.spiral.breaker4Pulled) return reject(state, "The faulted branch must be isolated before a clean route will hold.");
      return finish(state, { ...state, spiral: { ...state.spiral, junction: action.route } }, [
        { type: "event", code: `JUNCTION_${action.route.toUpperCase()}`, text: `${action.route.toUpperCase()} JUNCTION ROUTE SET` },
        { type: "reaction", code: "DEMI_JUNCTION", text: action.route === "rough" ? "The third relay clicks. A path lights across the board." : "The relay path clears." }
      ]);
    }
    case "ROTATE_JUNCTION_NODE": {
      if (state.phase !== "spiral_repair") return reject(state, "Junction routing is not active.");
      if (!JUNCTION_VISIBLE_NODES.includes(action.index as typeof JUNCTION_VISIBLE_NODES[number])) return reject(state, "That is not a player-controlled junction tile.");
      const rotations = [...state.junctionPuzzle.rotations];
      rotations[action.index] = ((rotations[action.index] ?? 0) + 1) % 4;
      const rough = matchesVisibleJunctionTarget(rotations, getJunctionTarget(state));
      const clean = rough && state.spiral.breaker4Pulled;
      const route: JunctionRoute = clean ? "clean" : rough ? "rough" : "none";
      const effects: Level1Effect[] = [{ type: "event", code: `JUNCTION_NODE_${action.index + 1}`, text: `JUNCTION NODE ${action.index + 1} ROTATED` }];
      if (rough) effects.push(
        { type: "event", code: "JUNCTION_ROUGH", text: "ROUGH JUNCTION ROUTE SET" },
        { type: "reaction", code: "DEMI_JUNCTION", text: "The third relay clicks. A path lights across the board." }
      );
      if (clean) effects.push(
        { type: "event", code: "JUNCTION_CLEAN", text: "CLEAN JUNCTION ROUTE SET" },
        { type: "reaction", code: "DEMI_JUNCTION", text: "The relay path clears." }
      );
      return finish(state, {
        ...state,
        junctionPuzzle: { ...state.junctionPuzzle, rotations },
        spiral: { ...state.spiral, junction: route }
      }, effects);
    }
    case "SELECT_JUNCTION_GLYPH": {
      if (!state.spiral.listened) return reject(state, "The junction carrier is not active.");
      if (state.junctionPuzzle.decoded) return reject(state, "The faulted junction branch is already isolated.");
      const faultGlyph = getJunctionFaultGlyph(state);
      if (action.glyph !== faultGlyph) {
        return finish(state, {
          ...state,
          reserve: Math.max(0, state.reserve - 0.5),
          junctionPuzzle: { ...state.junctionPuzzle, decodeProgress: 0 }
        }, [
          { type: "event", code: "JUNCTION_ISOLATION_REJECTED", text: `${action.glyph} JUNCTION BRANCH HELD` },
          { type: "reaction", code: "DEMI_JUNCTION_RESET", text: `Clack... ${action.glyph} holds. The irregular return continues.` },
          ...puzzleMistakeEffects("junction isolation")
        ]);
      }
      return finish(state, {
        ...state,
        junctionPuzzle: { ...state.junctionPuzzle, decodeProgress: 1, decoded: true }
      }, [
        { type: "event", code: "JUNCTION_FAULT_ISOLATED", text: `${faultGlyph} JUNCTION BRANCH ISOLATED` },
        { type: "reaction", code: "DEMI_JUNCTION_DECODED", text: `Clack... ${faultGlyph} drops out. The remaining returns synchronize.` }
      ]);
    }
    case "SET_REGULATOR": {
      if (state.phase !== "spiral_repair") return reject(state, "Regulator tuning is not active.");
      if (action.tune === "precise" && (!state.spiral.breaker4Pulled || state.spiral.junction !== "clean")) {
        return reject(state, "Precise tuning will not settle until the fault is isolated and the route is clean.");
      }
      return finish(state, { ...state, spiral: { ...state.spiral, regulator: action.tune } }, [
        { type: "event", code: `REGULATOR_${action.tune.toUpperCase()}`, text: `REGULATOR ${action.tune.toUpperCase()} TUNE` },
        { type: "reaction", code: "DEMI_REGULATOR", text: action.tune === "rough" ? "The regulator catches. The work lights flicker on. A rough hum continues." : "The regulator settles. The compartment lights hold steady." }
      ]);
    }
    case "SET_REGULATOR_SLIDER": {
      if (state.phase !== "spiral_repair") return reject(state, "Regulator tuning is not active.");
      if (!state.spiral.breaker4Pulled || state.spiral.junction !== "clean") return reject(state, "The fault branch must be isolated before the regulator can be adjusted.");
      if (!Number.isInteger(action.index) || action.index < 0 || action.index > 2) return reject(state, "Unknown regulator slider.");
      if (!Number.isFinite(action.value) || action.value < 0 || action.value > 4) return reject(state, "Regulator lever is outside its physical travel.");
      const sliders = [...state.regulatorPuzzle.sliders];
      sliders[action.index] = Math.round(action.value * 100) / 100;
      return finish(state, {
        ...state,
        regulatorPuzzle: { ...state.regulatorPuzzle, sliders, adjusted: true },
        spiral: { ...state.spiral, regulator: "rough" }
      }, []);
    }
    case "CHECK_HARMONICS": {
      if (!state.spiral.breaker4Pulled || state.spiral.junction !== "clean") return reject(state, "The regulator is not under a clean load.");
      if (!state.regulatorPuzzle.adjusted) return reject(state, "No local regulator adjustment has been detected.");
      if (state.spiral.regulator === "precise") return reject(state, "The regulator is already locked.");
      const previous = state.regulatorPuzzle.lastCheckedSliders;
      const unchanged = Boolean(previous)
        && previous?.every((value, index) => Math.abs(value - (state.regulatorPuzzle.sliders[index] ?? 0)) < 0.001);
      if (unchanged) return reject(state, "The regulator has not moved since KORE's last harmonic check.");
      return finish(state, {
        ...state,
        regulatorPuzzle: {
          ...state.regulatorPuzzle,
          checks: state.regulatorPuzzle.checks + 1,
          lastCheckedSliders: [...state.regulatorPuzzle.sliders]
        }
      }, [{ type: "event", code: "HARMONICS_CHECKED", text: "HARMONIC CARRIER CHECKED" }]);
    }
    case "READ_BUS": {
      if (!state.spiral.listened || state.spiral.junction === "none") return reject(state, "Restore the relay carrier before reading the branch signatures.");
      if (!state.junctionPuzzle.decoded) return reject(state, "Resolve the noisy junction carrier before reading its branch signature.");
      if (state.spiral.busRead) return reject(state, "The branch signature has already been captured.");
      return finish(state, { ...state, spiral: { ...state.spiral, busRead: true } }, [{ type: "event", code: "BUS_READ", text: "BUS LOAD SAMPLE CAPTURED" }]);
    }
    case "TOUCH_BREAKER": {
      if (!state.spiral.busRead) return reject(state, "Read the energized bus before checking breaker housings.");
      if (!Number.isInteger(action.index) || action.index < 0 || action.index >= state.breakerPuzzle.positions.length) return reject(state, "Unknown breaker.");
      const touched = [...state.breakerPuzzle.touched];
      touched[action.index] = true;
      const warm = action.index === state.breakerPuzzle.faultIndex;
      return finish(state, { ...state, breakerPuzzle: { ...state.breakerPuzzle, touched } }, [
        { type: "event", code: `BREAKER_${action.index + 1}_TOUCHED`, text: `BREAKER ${action.index + 1} HOUSING CHECKED` },
        { type: "reaction", code: "DEMI_BREAKER_TOUCH", text: warm ? `Breaker ${action.index + 1}'s housing is warm.` : `Breaker ${action.index + 1}'s housing is cool.` }
      ]);
    }
    case "TOGGLE_BREAKER": {
      if (!state.spiral.busRead) return reject(state, "Read the energized bus before operating the breaker bank.");
      if (!Number.isInteger(action.index) || action.index < 0 || action.index >= state.breakerPuzzle.positions.length) return reject(state, "Unknown breaker.");
      if (!state.breakerPuzzle.touched[action.index]) return reject(state, "Check this breaker housing before moving its lever.");
      if (state.breakerPuzzle.positions[action.index] === "up") return reject(state, "That healthy branch is already closed.");
      if (action.index === state.breakerPuzzle.faultIndex) {
        const reason = "A warm, twice-tripped breaker was thrown into a live fault.";
        return finish(state, {
          ...state,
          phase: "failure",
          failureReason: reason,
          breakerPuzzle: { ...state.breakerPuzzle, arcFlashes: state.breakerPuzzle.arcFlashes + 1 }
        }, [
          { type: "failure", code: "ARC_FLASH", text: "ARC FLASH — LIVE HOUSING" },
          { type: "reaction", code: "DEMI_FAILURE", text: "Crack! The bank flashes white." }
        ]);
      }
      const expected = getBreakerRestoreOrder(state)[state.breakerPuzzle.orderProgress];
      if (action.index !== expected) {
        return finish(state, {
          ...state,
          reserve: Math.max(0, state.reserve - 0.5),
          breakerPuzzle: {
            ...state.breakerPuzzle,
            positions: state.breakerPuzzle.positions.map((position, index) => index === state.breakerPuzzle.faultIndex ? position : "down"),
            orderProgress: 0
          }
        }, [
          { type: "event", code: "BREAKER_BANK_TRIPPED", text: "BREAKER BANK TRIPPED" },
          { type: "reaction", code: "DEMI_BREAKER_TRIP", text: "Clack... The bank trips and every restored breaker drops." },
          ...puzzleMistakeEffects("breaker bank")
        ]);
      }
      const positions = [...state.breakerPuzzle.positions];
      positions[action.index] = "up";
      return finish(state, {
        ...state,
        breakerPuzzle: { ...state.breakerPuzzle, positions, orderProgress: state.breakerPuzzle.orderProgress + 1 }
      }, [
        { type: "event", code: `BREAKER_${action.index + 1}_UP`, text: `BREAKER ${action.index + 1} UP` },
        { type: "reaction", code: "DEMI_BREAKER_UP", text: `Clack... Breaker ${action.index + 1} is up.` }
      ]);
    }
    case "PULL_BREAKER": {
      if (!state.spiral.busRead) return reject(state, "The branch fault has not been identified yet.");
      if (action.index !== state.breakerPuzzle.faultIndex) return reject(state, "This breaker does not carry the unmatched branch signature.");
      if (!state.breakerPuzzle.touched[action.index]) return reject(state, "Check the fault breaker's housing before pulling it.");
      if (state.breakerPuzzle.orderProgress < getBreakerRestoreOrder(state).length) {
        return finish(state, {
          ...state,
          reserve: Math.max(0, state.reserve - 0.5),
          breakerPuzzle: {
            ...state.breakerPuzzle,
            positions: state.breakerPuzzle.positions.map((position, index) => index === state.breakerPuzzle.faultIndex ? position : "down"),
            orderProgress: 0
          }
        }, [
          { type: "event", code: "BREAKER_BANK_TRIPPED", text: "BREAKER BANK TRIPPED" },
          { type: "reaction", code: "DEMI_BREAKER_TRIP", text: "Clack... The bank trips and every restored breaker drops." },
          ...puzzleMistakeEffects("breaker bank")
        ]);
      }
      if (state.spiral.breaker4Pulled) return reject(state, "The fault breaker is already isolated.");
      const positions = [...state.breakerPuzzle.positions];
      positions[action.index] = "pulled";
      return finish(state, {
        ...state,
        breakerPuzzle: { ...state.breakerPuzzle, positions },
        spiral: { ...state.spiral, breaker4Pulled: true, junction: "clean" }
      }, [
        { type: "event", code: "FAULT_BRANCH_ISOLATED", text: "FAULT BRANCH ISOLATED" },
        { type: "reaction", code: "DEMI_BREAKER", text: `Thud... Breaker ${action.index + 1} pulls free. The fault indicator goes dark.` }
      ]);
    }
    case "PULL_BREAKER_4": {
      if (!state.spiral.busRead) return reject(state, "The branch fault has not been identified yet.");
      if (state.spiral.breaker4Pulled) return reject(state, "The fault breaker is already isolated.");
      const positions = [...state.breakerPuzzle.positions];
      positions[state.breakerPuzzle.faultIndex] = "pulled";
      return finish(state, {
        ...state,
        breakerPuzzle: { ...state.breakerPuzzle, positions, orderProgress: 3 },
        spiral: { ...state.spiral, breaker4Pulled: true, junction: "clean" }
      }, [
        { type: "event", code: "FAULT_BRANCH_ISOLATED", text: "FAULT BRANCH ISOLATED" },
        { type: "reaction", code: "DEMI_BREAKER", text: `Thud... Breaker ${state.breakerPuzzle.faultIndex + 1} pulls free. The fault indicator goes dark.` }
      ]);
    }
    case "RESET_BREAKER_4": {
      const reason = "Breaker four was reset into a shorted branch; the emergency bus cascaded open.";
      return finish(state, { ...state, phase: "failure", failureReason: reason }, [
        { type: "failure", code: "BREAKER_CASCADE", text: "EMERGENCY BUS CASCADE" },
        { type: "reaction", code: "DEMI_FAILURE", text: "A relay cracks. Everything goes dark." }
      ]);
    }
    case "DIVERT_DOOR": {
      const ready = state.spiral.breaker4Pulled && state.spiral.junction === "clean" && state.spiral.regulator === "precise";
      if (!ready) return reject(state, "Clean and stabilize the bus before diverting power to the door motor.");
      return finish(state, { ...state, phase: "door_diversion", door: { ...state.door, diverted: true } }, [
        { type: "event", code: "DOOR_FEED_LIVE", text: "DOOR MOTOR FEED LIVE" },
        { type: "reaction", code: "DEMI_DOOR_FEED", text: "The door relay clunks. Compartment power drops as the door motor feed turns on." }
      ]);
    }
    case "COMMIT_DOOR": {
      if (!state.door.diverted) return reject(state, "Divert clean power to the door motor first.");
      return finish(state, { ...state, phase: "complete", door: { ...state.door, opened: true } }, [
        { type: "event", code: "BLAST_DOOR_OPEN", text: "BLAST DOOR OPEN" },
        { type: "reaction", code: "DEMI_COMPLETE", text: "Metal creaks... The blast door opens." }
      ]);
    }
  }
}
