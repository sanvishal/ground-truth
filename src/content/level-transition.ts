import type { ColdOpenPanelCopy } from "./cold-open";

export const LEVEL_TRANSITION_SHEET = "/assets/art/interstitials/engineering-to-greenhouse-v2.png";
export const LEVEL_TRANSITION_PANEL_WIDTH = 736;
export const LEVEL_TRANSITION_PANEL_HEIGHT = 414;

export const LEVEL_TRANSITION_PANELS: readonly ColdOpenPanelCopy[] = [
  {
    image: LEVEL_TRANSITION_SHEET,
    text: "KORE had said the greenhouse still had power. It had not said anything else about it.",
    pauses: [
      { after: "still had power.", durationMs: 360 }
    ]
  },
  {
    image: LEVEL_TRANSITION_SHEET,
    text: "The Sanctuary had been carrying thousands of specimens. She walked through what was left of them.",
    pauses: [
      { after: "thousands of specimens.", durationMs: 420 }
    ]
  },
  {
    image: LEVEL_TRANSITION_SHEET,
    text: "One of them was still alive. She had not expected it to still be green in there.",
    pauses: [
      { after: "still alive.", durationMs: 520 }
    ],
    finalHoldMs: 2_400
  }
];
