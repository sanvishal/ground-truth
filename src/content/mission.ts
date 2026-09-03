export const SANCTUARY_LORE = Object.freeze({
  vessel: "Sanctuary is a research vessel returning to Earth after one hundred forty-one years away, carrying a biological archive gathered during its mission.",
  disaster: "Sanctuary struck an uncharted asteroid field. The impact crippled the ship and left it drifting inside the field.",
  survivors: "KORE counted fifteen crew dead. Demi is the only crew member who answered, and one living specimen remains.",
  kore: "KORE is Sanctuary's damaged shipboard system. It stayed conscious after the impact, but much of its sensing and control network is gone.",
  mission: "Demi and KORE must restore enough of Sanctuary to keep Demi and the surviving specimen alive before KORE's auxiliary power runs out."
});

export const SANCTUARY_LORE_BRIEF = Object.values(SANCTUARY_LORE).join(" ");

export const GREENHOUSE_CONTEXT = Object.freeze({
  mission: "The surviving specimen is a sapling. The remaining mission is to stabilize its greenhouse support and launch Demi with it in the transfer pod.",
  alarm: "The repeating greenhouse alarm means local pressure or temperature is outside its safe range. KORE's damaged telemetry cannot tell which one, or whether both are unstable. Tell Demi to stabilize both the thermal system and pressure before continuing. The instability drains auxiliary power until both are safe."
});

export const PLAYER_RESPONSE_RULE = "Answer Demi's latest question directly or acknowledge her latest observation before advancing the repair. Do not replace what she asked with an unrelated puzzle clue. Give the current repair objective only when it answers her message or when she asks what to do next.";
