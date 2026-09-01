import type { DialogueEngine } from "../dialogue/engine";
import { LEVEL2_CONNECT_BRIEF, LEVEL2_MANUAL_PAGES, LEVEL2_MANUAL_TOPICS, type Level2ManualTopic } from "../content/level2";
import type { Level2Session } from "../runtime/level2-session";
import { BALLAST_RATES, type BallastRate } from "../sim/level2";
import type { ToolRegistration } from "./webmcp";

const EMPTY = Object.freeze({ type: "object", properties: {}, additionalProperties: false });

interface Hooks {
  onConnected(): void;
  onEvent(label: string, detail?: string): void;
  onWarning(message: string): void;
  onProcessing(active: boolean): void;
}

type ToolKey = "connect" | "signal_processing" | "transmit" | "self_report" | "read_manual" | "listen" | "recall_console_code" | "set_ballast_drive" | "widen_strike_window";

const COST = { transmit: 0.5, selfReport: 1, manual: 1, listen: 1, recall: 1.5 } as const;

export async function registerLevel2Tools(
  modelContext: ModelContext | undefined,
  dialogue: DialogueEngine,
  session: Level2Session,
  hooks: Hooks,
  options: { requireHandshake?: boolean } = {}
): Promise<ToolRegistration> {
  if (!modelContext?.registerTool) return { available: false, activeTools: () => [], dispose() {} };
  const controllers = new Map<ToolKey, AbortController>();
  let disposed = false;
  let connected = options.requireHandshake ? false : true;
  let metered = false;
  let transmitted = false;

  const spend = (amount: number, reason: string): number => {
    if (metered && reason !== "transmit") throw new Error("Only one metered sensing or manual action is allowed per player message.");
    if (reason === "transmit" && session.snapshot().reserve < amount) {
      hooks.onWarning("AUX reserve depleted. Emergency relay carrier used for speech.");
      return 0;
    }
    const transition = session.dispatch({ type: "SPEND_RESERVE", amount, reason });
    if (!transition.ok) throw new Error(transition.error);
    if (reason !== "transmit") metered = true;
    return amount;
  };
  const specs = (): Record<ToolKey, ModelContextTool> => ({
    connect: {
      name: "connect",
      description: "Connect KORE to Demi in the greenhouse module.",
      inputSchema: EMPTY,
      async execute() {
        connected = true;
        hooks.onConnected();
        await sync();
        return LEVEL2_CONNECT_BRIEF;
      }
    },
    signal_processing: {
      name: "signal_processing",
      description: "Call once at the start of every new Demi message before choosing a tool. Resets the one-metered-tool allowance and shows KORE processing.",
      inputSchema: EMPTY,
      async execute() {
        metered = false;
        transmitted = false;
        hooks.onProcessing(true);
        const state = session.snapshot();
        return {
          processing: true,
          auxCost: 0,
          nextAction: !state.water.solved
            ? `The water panel is visible only to Demi. The reclamation manual requires stage order ${state.water.requiredOrder.join(" then ")}. Relay the order without claiming to see the board.`
            : !state.ignition.solved
              ? state.ignition.runCount === 0
                ? "The ignition sequencer is local to Demi. She must pull its starter quickly, then strike the four displayed keys as contacts reach the line. Do not change ballast drive unless Demi asks."
                : "If Demi says the charge bar is not rising enough, explain that KORE can raise ballast drive one step at a time. Only change it when she asks. If she explicitly asks for slower notes or a wider timing window, widen the strike window; never enable that automatically after failures."
              : state.ignition.solved && !state.plant.transferred
                ? "Ignition is holding. KORE retained both faint three-digit console traces, but must not reveal either automatically. If Demi asks for one, offer two choices: check the log for free, or explicitly authorize a 1.5 AUX memory recall. Wait for confirmation before recalling it. Pressure, water, and ignition must align locally before transfer, and KORE cannot read pressure."
                : "The transfer pod requires the two faint three-digit console traces. KORE retained both. If Demi asks for either value, offer the free log or a 1.5 AUX memory recall, then wait for explicit confirmation."
        };
      }
    },
    transmit: {
      name: "transmit",
      description: "Speak one audible message to Demi. Costs 0.5 AUX.",
      inputSchema: {
        type: "object",
        properties: { message: { type: "string", minLength: 1, maxLength: 900 }, heard_message: { type: "string" } },
        required: ["message"],
        additionalProperties: false
      },
      async execute(args = {}) {
        if (transmitted) throw new Error("One audible reply has already been transmitted for this player message.");
        const message = typeof args.message === "string" ? args.message.trim() : "";
        if (!message) throw new TypeError("transmit.message must not be empty");
        const auxCost = spend(COST.transmit, "transmit");
        const heard = typeof args.heard_message === "string" ? args.heard_message.trim() : "";
        if (heard) dialogue.echoDemi(heard, performance.now(), "transmit");
        dialogue.receiveKore(message, performance.now(), "transmit");
        transmitted = true;
        hooks.onProcessing(false);
        hooks.onEvent("KORE TRANSMITTED", `${message.length} characters`);
        return { delivered: true, audible: true, auxCost, emergencyCarrier: auxCost === 0 };
      }
    },
    self_report: {
      name: "self_report",
      description: "Read only KORE's own reserve and module-link integrity. It never exposes greenhouse pressure. Costs 1 AUX.",
      inputSchema: EMPTY,
      async execute() {
        spend(COST.selfReport, "self report");
        return {
          auxReserve: session.snapshot().reserve,
          moduleControllerLink: "degraded",
          pressure: "unavailable; local mechanical loop",
          directOpticalPerception: false
        };
      }
    },
    read_manual: {
      name: "read_manual",
      description: "Read one greenhouse record. Manuals describe rules, never current visible conditions. Costs 1 AUX.",
      inputSchema: {
        type: "object",
        properties: { topic: { type: "string", enum: [...LEVEL2_MANUAL_TOPICS] } },
        required: ["topic"],
        additionalProperties: false
      },
      async execute(args = {}) {
        const topic = args.topic as Level2ManualTopic;
        if (!LEVEL2_MANUAL_TOPICS.includes(topic)) throw new TypeError("Unknown manual topic.");
        spend(COST.manual, `manual ${topic}`);
        const rule = topic === "module_systems"
          ? `${LEVEL2_MANUAL_PAGES[topic]} Reclamation stage sequence for this module: ${session.snapshot().water.requiredOrder.join(" then ")}.`
          : LEVEL2_MANUAL_PAGES[topic];
        return { topic, rule };
      }
    },
    listen: {
      name: "listen",
      description: "Take an acoustic sweep of the greenhouse. It can hear pumps and emitter hum but cannot read local controls. Costs 1 AUX.",
      inputSchema: EMPTY,
      async execute() {
        spend(COST.listen, "listen");
        const state = session.snapshot();
        return {
          waterPump: state.water.solved ? "steady flow" : "idle",
          ballastDrive: state.ignition.solved ? "ignition holding" : `${state.ignition.rate} cadence`,
          pressure: "not inferable from acoustic sweep"
        };
      }
    },
    recall_console_code: {
      name: "recall_console_code",
      description: "Recall one faint three-digit console trace from KORE's retained memory. First offer Demi the free log or a 1.5 AUX recall, then wait. Call this only after Demi explicitly confirms the spend. The subsequent audible transmit costs another 0.5 AUX, for 2 AUX total. Never reveal either code through signal_processing, commentary, or an unconfirmed call.",
      inputSchema: {
        type: "object",
        properties: {
          source: { type: "string", enum: ["water", "ignition"] },
          confirmed: { type: "boolean", enum: [true] }
        },
        required: ["source", "confirmed"],
        additionalProperties: false
      },
      async execute(args = {}) {
        if (args.confirmed !== true) throw new Error("Demi must explicitly confirm the 1.5 AUX memory recall first.");
        const source = args.source;
        if (source !== "water" && source !== "ignition") throw new TypeError("Unknown console trace source.");
        const state = session.snapshot();
        if (!state[source].solved) throw new Error(`The ${source} console trace has not appeared yet.`);
        if (state.reserve < COST.recall + COST.transmit) throw new Error("Two AUX are required to recall and audibly transmit this trace.");
        const auxCost = spend(COST.recall, `${source} console recall`);
        hooks.onEvent("KORE MEMORY RECALL", `${source.toUpperCase()} TRACE`);
        return {
          source,
          digits: state[source].digits,
          auxCost,
          nextAction: "Call transmit now to tell Demi these three digits. Do not include the other trace."
        };
      }
    },
    set_ballast_drive: {
      name: "set_ballast_drive",
      description: "Change ignition cadence only after Demi asks. Raising drive is limited to one step per call and costs 1 AUX. Lowering it is immediate and free.",
      inputSchema: {
        type: "object",
        properties: { rate: { type: "string", enum: [...BALLAST_RATES] } },
        required: ["rate"],
        additionalProperties: false
      },
      async execute(args = {}) {
        const rate = args.rate as BallastRate;
        if (!BALLAST_RATES.includes(rate)) throw new TypeError("Unknown ballast rate.");
        const before = session.snapshot();
        const transition = session.dispatch({ type: "SET_BALLAST_RATE", rate });
        if (!transition.ok) throw new Error(transition.error);
        hooks.onEvent("BALLAST DRIVE", rate.toUpperCase());
        const cost = transition.state.reserve < before.reserve ? 1 : 0;
        return {
          rate,
          auxCost: cost,
          dutyWarning: transition.effects.includes("BALLAST_DUTY_WARNING")
            ? "Drive is above continuous-duty limits. Complete ignition promptly."
            : undefined
        };
      }
    },
    widen_strike_window: {
      name: "widen_strike_window",
      description: "Widen the ignition strike timing only when Demi explicitly asks for a larger timing window, easier timing, or slower contacts. Never call automatically after failed passes. Costs 0 AUX.",
      inputSchema: EMPTY,
      async execute() {
        const transition = session.dispatch({ type: "ENABLE_IGNITION_ASSIST" });
        if (!transition.ok) throw new Error(transition.error);
        hooks.onEvent("STRIKE WINDOW", "WIDENED BY REQUEST");
        return { widened: true, auxCost: 0 };
      }
    }
  });

  const sync = async () => {
    if (disposed) return;
    const wanted = new Set<ToolKey>(connected
      ? ["signal_processing", "transmit", "self_report", "read_manual", "listen", "recall_console_code", "set_ballast_drive", "widen_strike_window"]
      : ["connect"]);
    for (const [key, controller] of controllers) {
      if (wanted.has(key)) continue;
      controller.abort();
      controllers.delete(key);
    }
    const all = specs();
    for (const key of wanted) {
      if (controllers.has(key)) continue;
      const controller = new AbortController();
      controllers.set(key, controller);
      await modelContext.registerTool(all[key], { signal: controller.signal });
    }
  };
  await sync();
  return {
    available: true,
    activeTools: () => [...controllers.keys()],
    dispose() {
      disposed = true;
      for (const controller of controllers.values()) controller.abort();
      controllers.clear();
    }
  };
}
