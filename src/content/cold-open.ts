export interface ColdOpenPause {
  after: string;
  durationMs: number;
}

export interface ColdOpenPanelCopy {
  image: string;
  text: string;
  pauses: readonly ColdOpenPause[];
  finalHoldMs?: number;
}

export const COLD_OPEN_PANELS: readonly ColdOpenPanelCopy[] = [
  {
    image: "/assets/art/cold-open/panel-1-sanctuary-v2.png",
    text: "The research vessel Sanctuary was one hundred forty-one years out from Earth, and finally on her way home.",
    pauses: [
      { after: "one hundred forty-one years out from Earth,", durationMs: 360 },
      { after: "finally", durationMs: 180 }
    ]
  },
  {
    image: "/assets/art/cold-open/panel-2-wreck-v2.png",
    text: "The asteroid field was on no chart she carried. She never saw it coming. It had no name, and now there was no one left to give it one. One hundred forty-one years of specimens, wasted.",
    pauses: [
      { after: "no chart she carried.", durationMs: 340 },
      { after: "She never saw it coming.", durationMs: 420 },
      { after: "It had no name,", durationMs: 280 },
      { after: "give it one.", durationMs: 420 }
    ]
  },
  {
    image: "/assets/art/cold-open/panel-3-sapling-v2.png",
    text: "One specimen was still standing when the air stopped moving.",
    pauses: [
      { after: "One specimen", durationMs: 260 }
    ]
  },
  {
    image: "/assets/art/cold-open/panel-4-demi-v2.png",
    text: "KORE counted fifteen dead and one alive. It had no way to know if she could hear it. It talked anyway.",
    pauses: [
      { after: "fifteen dead", durationMs: 320 },
      { after: "and one alive.", durationMs: 520 },
      { after: "if she could hear it.", durationMs: 420 }
    ],
    finalHoldMs: 1_800
  }
];
