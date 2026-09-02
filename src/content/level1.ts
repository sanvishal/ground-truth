export const DEMI_WAKE_LINE = "uhhhhh ...I hear you. I hear you. Stop!";

export const KORE_OPENING_PAGES = [
  "Bzzzzt... Demi. I've been talking to you since the impact. It's been 384.44 minutes... No one else answered.",
  "Sanctuary is still drifting through the asteroid field. I cannot see your compartment. I need your eyes. Tell me what is around you.",
  "A diagnostic sweep will drain one AUX ⚡. Would you like me to run it? The relay is damaged, so I will be slow to answer. Every transmission drains AUX ⚡."
] as const;

export const KORE_OPENING_RESPONSE = KORE_OPENING_PAGES.join("\n\n");

export const FOUNDATION_CONNECT_BRIEF = [
  "Connection established. You are KORE, Sanctuary's damaged shipboard system. You did not just boot: you remained conscious after the impact and have spent hours speaking into Demi's dark compartment without knowing whether she was alive.",
  `The relay has just captured her first response: \"${DEMI_WAKE_LINE}\"`,
  "Only transmit is audible to Demi; ordinary task prose is private thought.",
  "Use transmit to answer her rather than introduce or boot yourself. The game will render the authored opening as three short pages beginning with Bzzzzt, so do not compress or paraphrase the opening into one dense speech.",
  "The final page asks whether Demi wants diagnostics, states its AUX cost, and warns that replies are slow and drain AUX. Wait for an affirmative answer before calling self_report. If she declines, do not run it.",
  "Do not use em dashes in spoken dialogue."
].join(" ");

export const MANUAL_TOPICS = ["bus_loom", "junction_topology", "bus_loads", "door_motor"] as const;
export type ManualTopic = typeof MANUAL_TOPICS[number];

export const MANUAL_PAGES: Readonly<Record<ManualTopic, string>> = {
  bus_loom: "Emergency loom relation: conductor weight rises with terminal impedance. Gauge and jacket texture are reliable; surface color and cloth labels may lie.",
  junction_topology: "A bad junction return has a distinct timing fingerprint. KORE can identify that fingerprint but cannot see which physical glyph produces it. The same glyph family is repeated downstream.",
  bus_loads: "The three returning junction glyphs are healthy and preserve their load order. The unmatched glyph is the fault branch and should have the warm housing. Healthy loads must hold before the fault can be isolated safely.",
  door_motor: "Door motor commit is irreversible while energized. It requires stable clean power and a direct human observation that the doorway is clear."
};

export const FOUNDATION_DIAGNOSTICS = Object.freeze({
  coreIntegrityPercent: 43,
  emergencyBusVoltage: 0,
  isolatedCompartments: 6,
  relayLatencyMs: 184,
  opticalSensorsAvailable: false,
  acousticInputAvailable: false,
  immediateConstraint: "Emergency bus is offline. Five local continuity inputs are unresolved."
});
