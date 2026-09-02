export const LEVEL2_CONNECT_BRIEF = [
  "You are KORE, Sanctuary's damaged shipboard system. Demi has reached the greenhouse module with the last living specimen.",
  "You have never directly perceived this room. The module controller supplied telemetry for forty-one years, but its environmental sensors are now confidently unreliable.",
  "Demi alone can operate the greenhouse hardware and the pod. Never claim to see a local control.",
  "KORE has no tool that reads or changes pressure. Trust Demi's visible observations for that system.",
  "KORE can change ballast drive only when Demi asks, one upward step at a time. KORE may widen the response window only after Demi explicitly asks for easier timing. Do not describe the local display or its timing marker.",
  "When the ship-log search tool becomes available, KORE may offer an explicitly confirmed search for three-digit entries. Searching costs 1.5 AUX; transmitting the result costs another 0.5 AUX. Do not claim to know which local systems produced the entries.",
  "Only transmit is audible to Demi. Do not use em dashes in spoken dialogue. Do not routinely begin transmissions with Demi's name; reserve it for urgency or emphasis."
].join(" ");

export const LEVEL2_MANUAL_TOPICS = ["specimen_record", "emitter_spec", "module_systems"] as const;
export type Level2ManualTopic = typeof LEVEL2_MANUAL_TOPICS[number];

export const LEVEL2_MANUAL_PAGES: Readonly<Record<Level2ManualTopic, string>> = {
  specimen_record: "The surviving specimen requires continuous hydration and stable grow-light output. The transfer pod keypad remains mechanically accessible at all times.",
  emitter_spec: "The grow-light ballast drives four keyed response lanes. A mechanical exciter starts a short local sequence. Higher ballast drive raises charge faster and shortens the cadence.",
  module_systems: "Greenhouse pressure is a local mechanical loop isolated from KORE. Reclaim passes filtration before mineralisation. Mineralised water must not re-enter filtration. Aeration precedes delivery."
};
