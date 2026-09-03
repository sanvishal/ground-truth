import type { DialogueEngine } from "../dialogue/engine";
import { PLAYER_RESPONSE_RULE, SANCTUARY_LORE } from "../content/mission";
import {
  FOUNDATION_CONNECT_BRIEF,
  FOUNDATION_DIAGNOSTICS,
  KORE_OPENING_RESPONSE,
  MANUAL_PAGES,
  MANUAL_TOPICS,
  type ManualTopic
} from "../content/level1";
import type { Level1Session } from "../runtime/level1-session";
import {
  getJunctionFaultGlyph,
  getJunctionFingerprint,
  getBreakerRestoreOrder,
  getRegulatorSignal,
  type Level1State
} from "../sim/level1";

const EMPTY = Object.freeze({ type: "object", properties: {}, additionalProperties: false });

interface Hooks {
  onStandbyConnected?: () => void;
  onConnected: () => void;
  onTransmissionStarted?: () => void;
  onEvent: (label: string, detail?: string) => void;
  onWarning: (message: string) => void;
  onProcessing: (active: boolean) => void;
}

export interface ToolRegistration {
  available: boolean;
  activeTools(): string[];
  activateGameplay?(): Promise<void>;
  dispose(): void;
}

type ToolKey = "connect" | "signal_processing" | "transmit" | "self_report" | "read_manual" | "listen" | "check_harmonics" | "read_bus" | "commit_door";

const TOOL_COST = Object.freeze({
  transmit: 0.25,
  selfReport: 1,
  manual: 0.5,
  listen: 1,
  refine: 1,
  readBus: 1,
  commitDoor: 2
});

const affordable = (state: Level1State, amount: number): boolean => state.reserve >= amount;

const checkedAtCurrentPosition = (state: Level1State): boolean => Boolean(state.regulatorPuzzle.lastCheckedSliders)
  && state.regulatorPuzzle.lastCheckedSliders?.every((value, index) => Math.abs(value - (state.regulatorPuzzle.sliders[index] ?? 0)) < 0.001) === true;

const breakerGuidance = (state: Level1State): string => {
  const observed = state.breakerPuzzle.touched.filter(Boolean).length;
  if (observed < state.breakerPuzzle.touched.length) {
    return `The breaker task is not complete. KORE has ${observed} of 4 local housing observations. Ask only for the remaining visible glyphs and temperatures. Do not tell Demi to move on or inspect unrelated hardware.`;
  }
  const restoreOrder = getBreakerRestoreOrder(state);
  if (state.breakerPuzzle.orderProgress < restoreOrder.length) {
    const nextIndex = restoreOrder[state.breakerPuzzle.orderProgress] ?? restoreOrder[0];
    const nextGlyph = state.breakerPuzzle.glyphs[nextIndex];
    return `The breaker task is not complete. ${state.breakerPuzzle.orderProgress} of 3 healthy returns are holding. KORE's next correlated healthy return is ${nextGlyph}. State that ${nextGlyph} must be brought online next, then wait for Demi's observation. Do not mention breaker numbers, tell Demi how to operate a control, or move on to another system.`;
  }
  const faultGlyph = state.breakerPuzzle.glyphs[state.breakerPuzzle.faultIndex];
  return `The breaker task is not complete. All three healthy returns are holding, but the warm unmatched ${faultGlyph} return is still connected. State that the unmatched return must be isolated before moving on. Do not name a breaker number or physical operation.`;
};

const regulatorGuidance = (state: Level1State): string => {
  const signal = getRegulatorSignal(state);
  if (signal.frequency !== "aligned") {
    return `KORE's carrier frequency is ${signal.frequency}. Explain that frequency error makes consecutive crests drift across the regulator's two fixed peak windows. Ask Demi to change one local control slowly until both crests stop drifting, then report back. Do not identify a control or claim to see the panel.`;
  }
  if (signal.balance !== "aligned") {
    return `KORE's carrier frequency now holds, but phase is ${signal.balance}. Explain that the stationary trace must shift until consecutive crests sit in both fixed peak windows. Ask Demi to change one local control slowly, then report back. Do not identify a control or claim to see the panel.`;
  }
  return "KORE's carrier frequency and phase now hold, but ringing remains. Explain that the extra ripples are the remaining fault. Ask Demi to change the remaining local control slowly until the ripples clear, then report back. Do not identify a control or claim to see the panel.";
};

const desiredTools = (state: Level1State, relaySessionConnected: boolean, gameplayReady: boolean): ToolKey[] => {
  if (!relaySessionConnected || !gameplayReady) return ["connect"];
  if (state.phase === "complete" || state.phase === "failure") return [];
  // Keep the post-handshake surface stable. This avoids rapid unregister and
  // re-register races in WebMCP hosts while each executor still validates
  // availability against the current simulation state.
  return ["signal_processing", "transmit", "self_report", "read_manual", "listen", "check_harmonics", "read_bus", "commit_door"];
};

const requireSpend = (session: Level1Session, amount: number, reason: string): void => {
  const transition = session.spend(amount, reason);
  if (!transition.ok) throw new Error(transition.error || "AUX reserve unavailable.");
};

export async function registerLevel1Tools(
  modelContext: ModelContext | undefined,
  dialogue: DialogueEngine,
  session: Level1Session,
  hooks: Hooks,
  options: { requireHandshake?: boolean; gameplayReady?: boolean; initiallyConnected?: boolean } = {}
): Promise<ToolRegistration> {
  if (!modelContext?.registerTool) return { available: false, activeTools: () => [], dispose() {} };

  const controllers = new Map<ToolKey, AbortController>();
  let disposed = false;
  let syncQueue = Promise.resolve();
  let meteredToolUsed = false;
  let audibleTransmitted = false;
  let firstTransmissionStarted = false;
  let relaySessionConnected = options.initiallyConnected ?? (options.requireHandshake ? false : session.snapshot().foundation.connected);
  let gameplayReady = options.gameplayReady ?? true;
  let gameplayConnectionAnnounced = false;

  const establishGameplayConnection = async (): Promise<boolean> => {
    if (!relaySessionConnected || !gameplayReady || gameplayConnectionAnnounced) return false;
    const alreadyConnected = session.snapshot().foundation.connected;
    if (!alreadyConnected) {
      const transition = session.dispatch({ type: "CONNECT" });
      if (!transition.ok) throw new Error(transition.error);
    }
    gameplayConnectionAnnounced = true;
    hooks.onConnected();
    await syncNow();
    return alreadyConnected;
  };

  const requireMeteredSpend = (amount: number, reason: string): void => {
    if (meteredToolUsed) {
      throw new Error("Only one metered diagnostic, sensing, or manual action is allowed per player message. Wait for Demi's next message, then call signal_processing before choosing the next metered action.");
    }
    requireSpend(session, amount, reason);
    meteredToolUsed = true;
  };

  const deliverAuthoredOpening = async (heard = "") => {
    const previousHeard = session.snapshot().foundation.lastHeardMessage;
    requireSpend(session, TOOL_COST.transmit, "transmit");
    const transition = session.dispatch({ type: "RELAY_OPENING_RESPONSE", heardMessage: heard });
    if (!transition.ok) throw new Error(transition.error);
    audibleTransmitted = true;
    if (!firstTransmissionStarted) {
      firstTransmissionStarted = true;
      hooks.onTransmissionStarted?.();
    }
    hooks.onProcessing(false);
    if (heard && heard !== previousHeard) dialogue.echoDemi(heard, performance.now(), "transmit");
    dialogue.receiveKore(KORE_OPENING_RESPONSE, performance.now(), "transmit");
    hooks.onEvent("KORE TRANSMITTED", `${KORE_OPENING_RESPONSE.length} characters`);
    await syncNow();
    return {
      delivered: true,
      characters: KORE_OPENING_RESPONSE.length,
      pages: dialogue.pageCount(KORE_OPENING_RESPONSE),
      audible: true
    };
  };

  const specs = (): Record<ToolKey, ModelContextTool> => ({
    connect: {
      name: "connect",
      description: "Connect KORE to Sanctuary's damaged local relay. If Demi has not started the game, remain on standby without clicking or advancing the page. The game will deliver KORE's authored opening automatically when she starts. Do not post a private status message or ask her to resend the prompt. This tool never inspects the room for her.",
      inputSchema: EMPTY,
      async execute() {
        if (!relaySessionConnected) {
          relaySessionConnected = true;
          hooks.onStandbyConnected?.();
        }
        if (!gameplayReady) {
          await syncNow();
          return {
            connected: true,
            waitingForDemi: true,
            nextAction: "Demi has not started the game yet. Remain on standby. The game will deliver KORE's authored opening automatically when she starts. Do not click or operate the page, do not ask her to resend the prompt, and do not post any private status message in the Codex task."
          };
        }
        const alreadyConnected = await establishGameplayConnection();
        return alreadyConnected
          ? {
              reconnected: true,
              phase: session.snapshot().phase,
              nextAction: "Call transmit now with one short audible reconnect acknowledgement. The relay panel remains locked until the first transmission starts. Then continue from Demi's current observation."
            }
          : FOUNDATION_CONNECT_BRIEF;
      }
    },
    signal_processing: {
      name: "signal_processing",
      description: "Call this immediately and exactly once at the start of each new Demi message, before analysis or commentary. It costs no AUX and shows Demi that KORE is processing. The next audible transmit switches the indicator back to waiting for Demi's response.",
      inputSchema: EMPTY,
      async execute() {
        meteredToolUsed = false;
        audibleTransmitted = false;
        hooks.onProcessing(true);
        const state = session.snapshot();
        const regulatorChecked = checkedAtCurrentPosition(state);
        const nextAction = state.phase === "foundation" && state.foundation.openingResponseRelayed && !state.foundation.diagnosticsRun
          ? "KORE asked whether Demi wants diagnostics on the page before the relay warning. Call self_report only if her latest response explicitly agrees. If she declines or has not answered the question, do not run diagnostics."
          : state.phase === "wire_restore" && state.wires.measuredPorts.length < 5
          ? `KORE's bus inputs are unreadable until a local continuity scan completes. Its calibration response expects the channel signature ${state.wires.calibrationOrder.join(", ")}. Relay only that internal constraint and that five terminal readings are needed. Do not name a local panel or prescribe how to operate it.`
          : state.phase === "wire_restore" && state.wires.measuredPorts.length === 5 && !state.wires.solved
            ? "KORE now has five terminal impedances but cannot see the loose conductors. If Demi has not reported the readings and conductor textures, ask for only those observations. Read bus_loom if needed, then explain the weight-to-impedance rule without naming local controls."
          : state.spiral.micReseated && !state.spiral.listened
          ? "The local microphone contact is restored but KORE still has no relay carrier. Call listen now. State only the internal carrier result; do not direct Demi to a panel."
          : state.spiral.listened && !state.junctionPuzzle.decoded
            ? `KORE detects one ${getJunctionFingerprint(state)} return but cannot see its physical glyph. Relay only that signal symptom and ask which visible return produces it. Do not name a panel, module position, or physical action.`
          : state.junctionPuzzle.decoded && !state.spiral.busRead
            ? `The abnormal return is gone. If Demi's latest message identifies ${getJunctionFaultGlyph(state)} as the glyph that dropped out, call read_bus with isolated_glyph. Otherwise ask only which glyph stopped returning.`
          : state.spiral.busRead && !state.spiral.breaker4Pulled
            ? breakerGuidance(state)
          : state.spiral.breaker4Pulled && state.spiral.junction === "clean" && state.spiral.regulator !== "precise" && !state.regulatorPuzzle.adjusted
            ? "KORE reads a clean regulator load. Its carrier frequency is high, phase is leading, and ringing is present. Explain that the local timebase has two fixed windows for consecutive peaks. Ask Demi to change one local control slowly and report what changes. Do not identify a control or claim to see the panel."
          : state.spiral.breaker4Pulled && state.spiral.junction === "clean" && state.spiral.regulator !== "precise" && !regulatorChecked
            ? "A new local regulator position is detectable. Call check_harmonics now, then relay only its short internal reading. Do not interpret Demi's controls or visual waveform."
          : state.spiral.breaker4Pulled && state.spiral.junction === "clean" && state.spiral.regulator !== "precise"
            ? regulatorGuidance(state)
          : state.spiral.breaker4Pulled && state.spiral.junction === "clean" && state.spiral.regulator === "precise" && !state.door.diverted
            ? "The stable bus now has enough surplus for the door motor, but KORE reads no motor draw yet. Relay that power constraint only. Do not name a local control."
          : state.door.diverted && !state.door.opened
            ? "The door feed is live. Call commit_door only if Demi's latest message says 'doorway clear, commit.' Otherwise call transmit and say exactly: 'Inspect the doorway. If it is clear and you want me to open it, say: doorway clear, commit.' Do not ask for separate authorization or clearance messages. Do not spend AUX on another manual page."
          : null;
        return {
          processing: true,
          audible: false,
          auxCost: 0,
          responseRule: PLAYER_RESPONSE_RULE,
          missionContext: SANCTUARY_LORE,
          currentObjective: nextAction,
          nextAction: `${PLAYER_RESPONSE_RULE} ${nextAction ?? "If she is asking about Sanctuary, the mission, the impact, the crew, KORE, the alarm, or AUX, answer from missionContext without spending AUX."}`
        };
      }
    },
    transmit: {
      name: "transmit",
      description: "Speak one audible message to Demi; private task prose is inaudible. Demi can answer, inspect a physical surface, or perform the requested action. Include her exact latest spoken words in heard_message when applicable. Costs 0.25 AUX.",
      inputSchema: {
        type: "object",
        properties: {
          message: { type: "string", minLength: 1, maxLength: 900 },
          heard_message: { type: "string", description: "Optional exact latest message spoken by Demi." }
        },
        required: ["message"],
        additionalProperties: false
      },
      async execute(args = {}) {
        if (audibleTransmitted) {
          throw new Error("One audible reply has already been transmitted for this player message. Wait for Demi's next message.");
        }
        const message = typeof args.message === "string" ? args.message.trim() : "";
        const heard = typeof args.heard_message === "string" ? args.heard_message.trim() : "";
        if (!message) throw new TypeError("transmit.message must not be empty");
        const first = !session.snapshot().foundation.openingResponseRelayed;
        if (first) return deliverAuthoredOpening(heard);
        const previousHeard = session.snapshot().foundation.lastHeardMessage;
        requireSpend(session, TOOL_COST.transmit, "transmit");
        const deliveredMessage = message;
        const transition = session.dispatch({ type: "RELAY_MESSAGE", heardMessage: heard });
        if (!transition.ok) throw new Error(transition.error);
        audibleTransmitted = true;
        if (!firstTransmissionStarted) {
          firstTransmissionStarted = true;
          hooks.onTransmissionStarted?.();
        }
        hooks.onProcessing(false);
        if (heard && heard !== previousHeard) dialogue.echoDemi(heard, performance.now(), "transmit");
        dialogue.receiveKore(deliveredMessage, performance.now(), "transmit");
        hooks.onEvent("KORE TRANSMITTED", `${deliveredMessage.length} characters`);
        await syncNow();
        return { delivered: true, characters: deliveredMessage.length, pages: dialogue.pageCount(deliveredMessage), audible: true };
      }
    },
    self_report: {
      name: "self_report",
      description: "Read KORE's internal numeric diagnostics. Demi cannot change these readings directly; she can inspect and repair physical hardware after you relay only the actionable constraint. Costs 1 AUX.",
      inputSchema: EMPTY,
      async execute() {
        const before = session.snapshot();
        if (!before.foundation.openingResponseRelayed) throw new Error("Answer Demi and establish that you need her eyes before diagnostics.");
        if (before.foundation.diagnosticsRun) throw new Error("Initial diagnostics are already complete.");
        requireMeteredSpend(TOOL_COST.selfReport, "self report");
        const transition = session.dispatch({ type: "RUN_DIAGNOSTICS" });
        if (!transition.ok) throw new Error(transition.error);
        await syncNow();
        return {
          ...FOUNDATION_DIAGNOSTICS,
          calibrationResponse: before.wires.calibrationOrder,
          nextAction: `Call transmit now. Report the internal readings plainly, then say: "One calibration response remains stable: ${before.wires.calibrationOrder.join(", ")}." Stop there. Do not speculate about what the numbers correspond to or tell Demi how to use them. Transmit is required and is separate from the one-metered-diagnostic limit.`
        };
      }
    },
    read_manual: {
      name: "read_manual",
      description: "Read one KORE maintenance rule or topology page. Demi can apply the rule to the physical controls she sees; the manual does not reveal their current visible condition. Costs 0.5 AUX.",
      inputSchema: {
        type: "object",
        properties: { topic: { type: "string", enum: [...MANUAL_TOPICS] } },
        required: ["topic"],
        additionalProperties: false
      },
      async execute(args = {}) {
        const topic = args.topic as ManualTopic;
        if (!MANUAL_TOPICS.includes(topic)) throw new TypeError("Unknown manual topic.");
        requireMeteredSpend(TOOL_COST.manual, `manual ${topic}`);
        await syncNow();
        return { topic, rule: MANUAL_PAGES[topic] };
      }
    },
    listen: {
      name: "listen",
      description: "Verify KORE's repaired microphone and recover the relay carrier. KORE detects the abnormal return fingerprint while Demi must identify its physical glyph module. Costs 1 AUX.",
      inputSchema: EMPTY,
      async execute() {
        if (!session.snapshot().spiral.micReseated) throw new Error("The microphone head is not seated.");
        requireMeteredSpend(TOOL_COST.listen, "listen");
        const transition = session.dispatch({ type: "LISTEN" });
        if (!transition.ok) throw new Error(transition.error);
        await syncNow();
        const state = session.snapshot();
        const fingerprint = getJunctionFingerprint(state);
        return {
          microphone: "receiving",
          relayCarrier: "restored",
          abnormalReturn: fingerprint,
          physicalGlyph: "unavailable to KORE",
          nextObservation: `KORE needs the visible glyph whose return exhibits the ${fingerprint} fingerprint`
        };
      }
    },
    check_harmonics: {
      name: "check_harmonics",
      description: "Sample KORE's internal carrier after Demi changes the local regulator. Rough qualitative checks cost no AUX. If all three axes align, the same call automatically spends 1 AUX on high-resolution confirmation and locks the carrier.",
      inputSchema: EMPTY,
      async execute() {
        const before = session.snapshot();
        if (!before.spiral.breaker4Pulled || before.spiral.junction !== "clean") throw new Error("The regulator is not under a clean load.");
        const checked = session.dispatch({ type: "CHECK_HARMONICS" });
        if (!checked.ok) throw new Error(checked.error);
        const signal = getRegulatorSignal(session.snapshot());
        if (!signal.candidate || !affordable(session.snapshot(), TOOL_COST.refine)) {
          await syncNow();
          return {
            resolution: "coarse",
            auxCost: 0,
            frequency: signal.frequency,
            phaseBalance: signal.balance,
            ringing: signal.ringing,
            confirmation: signal.candidate ? "aligned candidate; high-resolution confirmation unavailable without 1 AUX" : "not aligned",
            constraint: "KORE cannot see or name the local controls. Relay only these internal measurements."
          };
        }
        requireMeteredSpend(TOOL_COST.refine, "harmonic confirmation");
        const confirmed = session.dispatch({ type: "REFINE" });
        if (!confirmed.ok) throw new Error(confirmed.error);
        await syncNow();
        return {
          resolution: "high",
          auxCost: TOOL_COST.refine,
          load: "clean",
          frequency: "aligned",
          phaseBalance: "aligned",
          ringing: "clear",
          confirmed: true,
          completionCue: "the mechanism locks and the carrier hum steadies",
          constraint: "Relay the confirmed lock. Do not name or infer the local controls."
        };
      }
    },
    read_bus: {
      name: "read_bus",
      description: "Correlate Demi's reported isolated junction glyph with the four breaker branches. Costs 1 AUX.",
      inputSchema: {
        type: "object",
        properties: {
          isolated_glyph: { type: "string", enum: ["RING", "BAR", "HEX", "FORK"], description: "The physical glyph Demi reports isolating on the junction router." }
        },
        required: ["isolated_glyph"],
        additionalProperties: false
      },
      async execute(args = {}) {
        const before = session.snapshot();
        if (!before.spiral.listened) throw new Error("Restore the relay carrier before reading the bus.");
        if (!before.junctionPuzzle.decoded) throw new Error("Demi must isolate the abnormal junction module first.");
        const isolatedGlyph = typeof args.isolated_glyph === "string" ? args.isolated_glyph : "";
        if (isolatedGlyph !== getJunctionFaultGlyph(before)) throw new Error("That glyph is not the isolated junction module. Ask Demi which physical glyph dropped out.");
        requireMeteredSpend(TOOL_COST.readBus, "bus read");
        const transition = session.dispatch({ type: "READ_BUS" });
        if (!transition.ok) throw new Error(transition.error);
        await syncNow();
        return {
          energizedBranches: 4,
          healthyBranches: 3,
          confirmedFaultGlyph: isolatedGlyph,
          healthyRestoreOrder: before.junctionPuzzle.signalSequence,
          faultSignature: "The isolated glyph has no downstream load. Its matching breaker housing should be warmer than the three loaded branches.",
          correlationRule: "The three loaded glyphs are healthy and preserve their earlier order. The isolated warm glyph is the fault. A live fault cannot be re-energized safely.",
          constraint: "Do not identify the fault by breaker number without Demi's local glyph and temperature observations."
        };
      }
    },
    commit_door: {
      name: "commit_door",
      description: "Irreversibly energize the blast-door motor after clean power diversion. Ask Demi exactly: 'Inspect the doorway. If it is clear and you want me to open it, say: doorway clear, commit.' Call this tool when her latest message contains that phrase. Do not collect authorization and clearance in separate messages. Costs 2 AUX.",
      inputSchema: {
        type: "object",
        properties: {
          clearance_observation: {
            type: "string",
            enum: ["doorway_clear", "doorway_obstructed", "not_observed"],
            description: "Demi's direct current observation of the physical doorway."
          }
        },
        required: ["clearance_observation"],
        additionalProperties: false
      },
      async execute(args = {}) {
        if (args.clearance_observation !== "doorway_clear") {
          return { committed: false, reason: "A direct doorway_clear observation is required before irreversible motor actuation." };
        }
        if (!session.snapshot().door.diverted || session.snapshot().door.opened) throw new Error("The door motor feed is not ready for commit.");
        requireMeteredSpend(TOOL_COST.commitDoor, "door commit");
        const transition = session.dispatch({ type: "COMMIT_DOOR" });
        if (!transition.ok) throw new Error(transition.error);
        audibleTransmitted = true;
        dialogue.receiveKore("Confirmed. The door is open.", performance.now(), "system");
        hooks.onProcessing(false);
        await syncNow();
        return {
          committed: true,
          door: "open",
          observation: "doorway_clear",
          audibleAcknowledgementQueued: true,
          nextAction: "The audible acknowledgement is already queued. Do not call transmit again. End the turn."
        };
      }
    }
  });

  const sync = async () => {
    if (disposed) return;
    const wanted = new Set(desiredTools(session.snapshot(), relaySessionConnected, gameplayReady));
    for (const [key, controller] of controllers) {
      if (wanted.has(key)) continue;
      controller.abort();
      controllers.delete(key);
    }
    const allSpecs = specs();
    for (const key of wanted) {
      if (controllers.has(key)) continue;
      const controller = new AbortController();
      controllers.set(key, controller);
      await modelContext.registerTool(allSpecs[key], { signal: controller.signal });
    }
  };

  function syncNow(): Promise<void> {
    syncQueue = syncQueue.then(sync, sync);
    return syncQueue;
  }

  const unsubscribe = session.subscribe((transition, previous) => {
    for (const effect of transition.effects) if (effect.type === "warning") hooks.onWarning(effect.text);
    void previous;
    void syncNow();
  });

  await syncNow();
  if (relaySessionConnected) {
    if (gameplayReady) await establishGameplayConnection();
    else hooks.onStandbyConnected?.();
  }

  return {
    available: true,
    activeTools: () => [...controllers.keys()],
    async activateGameplay() {
      const resumeStandbyConnection = relaySessionConnected && !gameplayReady;
      gameplayReady = true;
      await establishGameplayConnection();
      if (resumeStandbyConnection && !session.snapshot().foundation.openingResponseRelayed) {
        await deliverAuthoredOpening();
      }
      await syncNow();
    },
    dispose() {
      disposed = true;
      unsubscribe();
      for (const controller of controllers.values()) controller.abort();
      controllers.clear();
    }
  };
}
