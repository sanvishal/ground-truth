import { BitmapText, BlurFilter, Container, Graphics, NineSliceSprite, Sprite, Texture } from "pixi.js";
import { UI_FONT } from "../fonts";

export interface PanelFrameTextures {
  standard: Texture;
  reinforced: Texture;
  sealed: Texture;
}

export interface PanelNameplateTextures {
  emergencyBusLoom: Texture;
  continuitySequencer: Texture;
  junctionRouter: Texture;
  harmonicRegulator: Texture;
  emergencyBreakerBank: Texture;
}

export interface PanelHardwareTextures {
  busConnectorHeads: {
    blue_heavy: Texture;
    ridged_heavy: Texture;
    cloth_mid: Texture;
    smooth_light: Texture;
    green_light: Texture;
  };
  busConnectorSeated: {
    blue_heavy: Texture;
    ridged_heavy: Texture;
    cloth_mid: Texture;
    smooth_light: Texture;
    green_light: Texture;
  };
  busRopeTextures: {
    blue_heavy: Texture;
    ridged_heavy: Texture;
    cloth_mid: Texture;
    smooth_light: Texture;
    green_light: Texture;
  };
  busSocketOpen: Texture;
  continuityPath: Texture;
  continuitySelector: Texture;
  continuityLedOff: Texture;
  continuityLedGreen: Texture;
  continuityLedRed: Texture;
  regulatorBezel: Texture;
  regulatorTrack: Texture;
  regulatorHandle: Texture;
  junctionRelayTrack: Texture;
  junctionLampBezel: Texture;
  junctionSwitchReady: Texture;
  junctionSwitchIsolated: Texture;
  junctionLampOff: Texture;
  junctionLampAmber: Texture;
  junctionLampRed: Texture;
  breakerHousing: Texture;
  breakerHandle: Texture;
  breakerGlyphs: {
    RING: Texture;
    BAR: Texture;
    HEX: Texture;
    FORK: Texture;
    HOOK: Texture;
    CROSS: Texture;
    PRONGS: Texture;
    CHEVRONS: Texture;
  };
}

export type InteractionCue = Container & { readonly pulseBorder: Graphics };

export function createHardwareSprite(
  texture: Texture,
  width: number,
  shadowX = 2,
  shadowY = 3,
  shadowAlpha = 0.5,
  shadowBlur = 0
): Container {
  const root = new Container();
  root.eventMode = "none";
  const scale = width / texture.width;
  const shadow = new Sprite(texture);
  shadow.anchor.set(0.5);
  shadow.position.set(shadowX, shadowY);
  shadow.scale.set(scale);
  shadow.tint = 0x000000;
  shadow.alpha = shadowAlpha;
  if (shadowBlur > 0) shadow.filters = [new BlurFilter({ strength: shadowBlur, quality: 1 })];
  shadow.roundPixels = true;
  const sprite = new Sprite(texture);
  sprite.anchor.set(0.5);
  sprite.scale.set(scale);
  sprite.roundPixels = true;
  root.addChild(shadow, sprite);
  return root;
}

/** Passive instruction label matching the scene-interactable tooltip style. */
export function createInteractionCue(text = "DRAG ME"): InteractionCue {
  const root = new Container();
  root.eventMode = "none";
  const caption = new BitmapText({
    text,
    style: { fontFamily: UI_FONT, fontSize: 11, fill: 0xe2a348 }
  });
  caption.position.set(7, 4);
  const width = Math.ceil(caption.width) + 14;
  const back = new Graphics()
    .roundRect(0, 0, width, 21, 2)
    .fill({ color: 0x050708, alpha: 0.94 });
  const border = new Graphics()
    .roundRect(0, 0, width, 21, 2)
    .stroke({ color: 0x6b5735, width: 1 });
  const pulseBorder = new Graphics()
    .roundRect(0, 0, width, 21, 2)
    .stroke({ color: 0xe2a348, width: 1 });
  pulseBorder.pivot.set(width / 2, 10.5);
  pulseBorder.position.set(width / 2, 10.5);
  pulseBorder.blendMode = "add";
  root.pivot.set(width / 2, 21);
  root.addChild(back, border, pulseBorder, caption);
  return Object.assign(root, { pulseBorder });
}

export function createPanelNameplate(
  texture: Texture,
  x: number,
  y: number,
  width: number,
  rotation: number
): Container {
  const root = new Container();
  root.position.set(x, y);
  root.rotation = rotation;
  root.eventMode = "none";

  const scale = width / texture.width;
  const displayedHeight = texture.height * scale;
  const shadow = new Graphics()
    .roundRect(
      -width * 0.41,
      displayedHeight * 0.38,
      width * 0.82,
      Math.max(5, displayedHeight * 0.14),
      3
    )
    .fill({ color: 0x000000, alpha: 0.34 });
  shadow.filters = [new BlurFilter({ strength: 3, quality: 1 })];

  const plate = new Sprite(texture);
  plate.anchor.set(0.5);
  plate.scale.set(scale);
  plate.tint = 0xb8b8b8;
  plate.roundPixels = true;
  plate.eventMode = "none";

  root.addChild(shadow, plate);
  return root;
}

export function createPanelSurface(
  texture: Texture,
  width: number,
  height: number
): Container {
  const root = new Container();
  const frame = new NineSliceSprite({
    texture,
    leftWidth: 24,
    topHeight: 24,
    rightWidth: 24,
    bottomHeight: 24,
    width,
    height
  });
  frame.roundPixels = true;

  root.addChild(frame);
  return root;
}
