export const UI_FONT = "ImpactfulBits";
export const DIALOGUE_FONT = "PixelSans";
export const PANEL_FONT = "Notepen";
const ACTIVE_FONTS = [UI_FONT, DIALOGUE_FONT, PANEL_FONT] as const;

export async function loadDialogueFonts(): Promise<void> {
  await Promise.all(ACTIVE_FONTS.map(async (name) => {
    const face = new FontFace(name, `url(/assets/fonts/${name}.ttf)`, { style: "normal", weight: "400" });
    await face.load();
    document.fonts.add(face);
  }));
}
