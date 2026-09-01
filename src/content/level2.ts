export const LEVEL2_CONNECT_BRIEF = [
  "You are KORE, Sanctuary's damaged shipboard system. Demi has reached the greenhouse module with the last living specimen.",
  "You have never directly perceived this room. The module controller supplied telemetry for forty-one years, but its environmental sensors are now confidently unreliable.",
  "Demi alone can operate pressure, water, the ignition sequencer, transfer hardware, and the pod. Never claim to see a local control.",
  "KORE has no tool that reads or changes pressure. Trust Demi's visible observations for that system.",
  "Ignition is cooperative. Demi strikes the local contacts. KORE can change ballast drive only when Demi asks, one upward step at a time. KORE may widen the strike window only after Demi explicitly asks for easier timing.",
  "Only transmit is audible to Demi. Do not use em dashes in spoken dialogue."
].join(" ");

export const LEVEL2_MANUAL_TOPICS = ["specimen_record", "emitter_spec", "module_systems"] as const;
export type Level2ManualTopic = typeof LEVEL2_MANUAL_TOPICS[number];

export const LEVEL2_MANUAL_PAGES: Readonly<Record<Level2ManualTopic, string>> = {
  specimen_record: "The surviving specimen requires continuous water and stable grow-light ignition before transfer.",
  emitter_spec: "The grow-light ballast uses four keyed contact lanes. Pull the mechanical exciter quickly, then strike each displayed key as its contact reaches the line. Higher ballast drive raises charge faster and shortens the cadence.",
  module_systems: "Greenhouse pressure is a local mechanical loop isolated from KORE. Reclaim passes filtration before mineralisation. Mineralised water must not re-enter filtration. Aeration precedes delivery."
};
