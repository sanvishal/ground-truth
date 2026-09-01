import type { ColdOpenPanelCopy } from "./cold-open";

export const GAME_OVER_PANELS: readonly ColdOpenPanelCopy[] = [
  {
    image: "/assets/art/endings/game-over-sanctuary.png",
    text: "KORE's auxiliary power reserve ran out. It had kept her alive for as long as possible. What was left of the Sanctuary drifted apart in the field... lifeless",
    pauses: [
      { after: "ran out.", durationMs: 420 },
      { after: "as long as possible.", durationMs: 520 },
      { after: "in the field...", durationMs: 620 }
    ]
  }
];

export const WIN_ENDING_PANELS: readonly ColdOpenPanelCopy[] = [
  {
    image: "/assets/art/endings/win-01-demi-pod.png",
    text: "Demi sealed herself into the emergency pod with the sapling, and told KORE she was ready.",
    pauses: [
      { after: "with the sapling,", durationMs: 360 }
    ]
  },
  {
    image: "/assets/art/endings/win-02-kore-reserve.png",
    text: "KORE routed the last of its auxiliary power reserve into the launch. All of it.",
    pauses: [
      { after: "into the launch.", durationMs: 520 }
    ]
  },
  {
    image: "/assets/art/endings/win-03-pod-departure.png",
    text: "The Sanctuary went dark behind her, and stayed that way.",
    pauses: [
      { after: "behind her,", durationMs: 420 }
    ]
  }
];
