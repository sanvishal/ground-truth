import { createInitialLevel1State, type Level1State } from "../sim/level1";
import type { DialogueOrigin, Speaker } from "../dialogue/types";

export const LEVEL1_CHECKPOINT_KEY = "groundtruth.level1.checkpoint.v1";
export const LEVEL1_DIALOGUE_CHECKPOINT_KEY = "groundtruth.level1.dialogue.v1";
export const LEVEL1_TRANSCRIPT_CHECKPOINT_KEY = "groundtruth.level1.transcript.v1";

type CheckpointStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

interface StoredCheckpoint {
  version: 1;
  savedAt: number;
  state: Partial<Level1State>;
}

export interface DialogueCheckpoint {
  speaker: Speaker;
  body: string;
  pageIndex: number;
  origin: DialogueOrigin;
}

interface StoredDialogueCheckpoint extends DialogueCheckpoint {
  version: 1;
  savedAt: number;
}

export interface DialogueTranscriptEntry {
  speaker: Speaker;
  body: string;
}

export function readDialogueTranscript(storage: CheckpointStorage): DialogueTranscriptEntry[] {
  try {
    const raw = storage.getItem(LEVEL1_TRANSCRIPT_CHECKPOINT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { version?: number; entries?: DialogueTranscriptEntry[] };
    if (parsed.version !== 1 || !Array.isArray(parsed.entries)) return [];
    return parsed.entries.filter((entry) =>
      (entry.speaker === "KORE" || entry.speaker === "DEMI")
      && typeof entry.body === "string"
      && entry.body.length > 0
    ).slice(-80);
  } catch {
    return [];
  }
}

export function writeDialogueTranscript(storage: CheckpointStorage, entries: DialogueTranscriptEntry[]): void {
  try {
    storage.setItem(LEVEL1_TRANSCRIPT_CHECKPOINT_KEY, JSON.stringify({ version: 1, savedAt: Date.now(), entries: entries.slice(-80) }));
  } catch {
    // Transcript persistence is a convenience and must never interrupt play.
  }
}

export function readDialogueCheckpoint(storage: CheckpointStorage): DialogueCheckpoint | null {
  try {
    const raw = storage.getItem(LEVEL1_DIALOGUE_CHECKPOINT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredDialogueCheckpoint;
    if (parsed.version !== 1 || (parsed.speaker !== "KORE" && parsed.speaker !== "DEMI")) return null;
    if (!parsed.body || typeof parsed.body !== "string" || !Number.isInteger(parsed.pageIndex)) return null;
    if (parsed.body === "Relay restored. I still have the last checkpoint. Continue from the current panel."
      || parsed.body === "The relay is back. I still need your next observation.") return null;
    if (parsed.origin !== "system" && parsed.origin !== "transmit") return null;
    return { speaker: parsed.speaker, body: parsed.body, pageIndex: parsed.pageIndex, origin: parsed.origin };
  } catch {
    return null;
  }
}

export function writeDialogueCheckpoint(storage: CheckpointStorage, checkpoint: DialogueCheckpoint): void {
  try {
    const stored: StoredDialogueCheckpoint = { version: 1, savedAt: Date.now(), ...checkpoint };
    storage.setItem(LEVEL1_DIALOGUE_CHECKPOINT_KEY, JSON.stringify(stored));
  } catch {
    // Dialogue persistence is a convenience and must never interrupt play.
  }
}

export function readLevel1Checkpoint(storage: CheckpointStorage): Level1State | null {
  try {
    const raw = storage.getItem(LEVEL1_CHECKPOINT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredCheckpoint;
    if (parsed.version !== 1 || !parsed.state || typeof parsed.state !== "object") return null;
    const state = parsed.state;
    const base = createInitialLevel1State(typeof state.runSeed === "number" ? state.runSeed : undefined);
    if (typeof state.phase !== "string" || typeof state.reserve !== "number") return null;
    const calibrationOrder = state.wires?.calibrationOrder;
    const validCalibrationOrder = Array.isArray(calibrationOrder)
      && calibrationOrder.length === 3
      && calibrationOrder.every((gear) => Number.isInteger(gear) && gear >= 1 && gear <= 6)
      && new Set(calibrationOrder).size === 3;
    return {
      ...base,
      ...state,
      foundation: { ...base.foundation, ...state.foundation },
      hands: { continuityHeld: false },
      wires: {
        ...base.wires,
        ...state.wires,
        calibrationOrder: validCalibrationOrder ? [...calibrationOrder] : base.wires.calibrationOrder,
        targets: { ...base.wires.targets, ...state.wires?.targets },
        // Impedance values are derived from the run seed. Rebuild them so
        // older decimal-valued checkpoints migrate to the current whole-ohm scale.
        impedance: { ...base.wires.impedance },
        connections: { ...base.wires.connections, ...state.wires?.connections },
        measuredPorts: Array.isArray(state.wires?.measuredPorts) ? state.wires.measuredPorts : []
      },
      junctionPuzzle: {
        decodeProgress: typeof state.junctionPuzzle?.decodeProgress === "number" ? state.junctionPuzzle.decodeProgress : base.junctionPuzzle.decodeProgress,
        decoded: typeof state.junctionPuzzle?.decoded === "boolean" ? state.junctionPuzzle.decoded : base.junctionPuzzle.decoded,
        signalSequence: Array.isArray(state.junctionPuzzle?.signalSequence) && state.junctionPuzzle.signalSequence.length === 3
          ? [...state.junctionPuzzle.signalSequence]
          : base.junctionPuzzle.signalSequence,
        rotations: Array.isArray(state.junctionPuzzle?.rotations)
          ? [...base.junctionPuzzle.rotations].map((value, index) => state.junctionPuzzle?.rotations[index] ?? value)
          : base.junctionPuzzle.rotations
      },
      regulatorPuzzle: {
        adjusted: typeof state.regulatorPuzzle?.adjusted === "boolean" ? state.regulatorPuzzle.adjusted : base.regulatorPuzzle.adjusted,
        checks: typeof state.regulatorPuzzle?.checks === "number" ? state.regulatorPuzzle.checks : 0,
        lastCheckedSliders: Array.isArray(state.regulatorPuzzle?.lastCheckedSliders)
          ? [...state.regulatorPuzzle.lastCheckedSliders]
          : null,
        sliders: Array.isArray(state.regulatorPuzzle?.sliders)
          ? [...base.regulatorPuzzle.sliders].map((value, index) => state.regulatorPuzzle?.sliders[index] ?? value)
          : base.regulatorPuzzle.sliders
      },
      breakerPuzzle: {
        ...base.breakerPuzzle,
        ...state.breakerPuzzle,
        glyphs: Array.isArray(state.breakerPuzzle?.glyphs) && state.breakerPuzzle.glyphs.length === 4
          ? [...state.breakerPuzzle.glyphs]
          : base.breakerPuzzle.glyphs,
        positions: Array.isArray(state.breakerPuzzle?.positions)
          ? [...base.breakerPuzzle.positions].map((value, index) => state.breakerPuzzle?.positions[index] ?? value)
          : base.breakerPuzzle.positions,
        touched: Array.isArray(state.breakerPuzzle?.touched)
          ? [...base.breakerPuzzle.touched].map((value, index) => state.breakerPuzzle?.touched[index] ?? value)
          : base.breakerPuzzle.touched
      },
      spiral: {
        ...base.spiral,
        ...state.spiral,
        finalRefined: state.spiral?.regulator === "precise"
      },
      door: { ...base.door, ...state.door },
      skipped: { ...base.skipped, ...state.skipped },
      history: Array.isArray(state.history) ? state.history.slice(-60) : []
    } as Level1State;
  } catch {
    return null;
  }
}

export function writeLevel1Checkpoint(storage: CheckpointStorage, state: Level1State): void {
  try {
    const checkpoint: StoredCheckpoint = { version: 1, savedAt: Date.now(), state };
    storage.setItem(LEVEL1_CHECKPOINT_KEY, JSON.stringify(checkpoint));
  } catch {
    // A blocked or full storage backend must not interrupt play.
  }
}

export function clearLevel1Checkpoint(storage: CheckpointStorage): void {
  try {
    storage.removeItem(LEVEL1_CHECKPOINT_KEY);
    storage.removeItem(LEVEL1_DIALOGUE_CHECKPOINT_KEY);
    storage.removeItem(LEVEL1_TRANSCRIPT_CHECKPOINT_KEY);
  } catch {
    // The reset still succeeds in memory when storage is unavailable.
  }
}
