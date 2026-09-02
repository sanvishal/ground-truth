import { BlurFilter, Container, Graphics, Rectangle, Sprite } from "pixi.js";
import { getJunctionFaultGlyph, getJunctionFingerprint, getRegulatorControlError, getRegulatorScopeGeometry, regulatorPeaksInWindows, REGULATOR_PRECISE_TARGET, SIGNAL_GLYPHS, type Level1State, type SignalGlyph } from "../sim/level1";
import { PanelApertureTransition } from "./panel-aperture-transition";
import { createHardwareSprite, createInteractionCue, createPanelNameplate, createPanelSurface, type InteractionCue, type PanelFrameTextures, type PanelHardwareTextures, type PanelNameplateTextures } from "./panel-nine-slice";
import { createPanelMistakeSparks } from "./panel-mistake-sparks";
import { panelText, type PanelText } from "./panel-text";

export type Level1PuzzleId = "junction_board" | "regulator" | "breaker_bank";

export interface Level1PuzzleHandlers {
  panelOpened(): void;
  panelClosed(): void;
  snapshot(): Level1State;
  rotateJunction(index: number): void;
  selectJunctionGlyph(glyph: SignalGlyph): void;
  setRegulator(index: number, value: number): void;
  touchBreaker(index: number): void;
  toggleBreaker(index: number): void;
  pullBreaker(index: number): void;
}

export interface Level1PuzzleOverlays {
  readonly container: Container;
  open(id: Level1PuzzleId): void;
  close(): void;
  mistakeBurst(): boolean;
  refresh(): void;
  update(deltaMs: number): void;
  destroy(): void;
}

const label = (text: string, size = 12, fill = 0xc9c5ba): PanelText =>
  panelText(text, size, fill);

const makeShell = (
  nameplateTexture: PanelNameplateTextures[keyof PanelNameplateTextures],
  nameplatePlacement: { x: number; y: number; width: number; rotation: number },
  onClose: () => void,
  frameTexture: PanelFrameTextures[keyof PanelFrameTextures],
  shellWidth = 648
): { root: Container; body: Container } => {
  const root = new Container();
  root.visible = false;
  root.eventMode = "none";
  const shade = new Graphics().rect(0, 0, 960, 420).fill({ color: 0x020304, alpha: 0.82 });
  shade.eventMode = "static";
  shade.cursor = "pointer";
  shade.on("pointertap", onClose);
  const body = new Container();
  body.position.set((960 - shellWidth * 1.07) / 2, 28);
  body.scale.set(1.07);
  body.eventMode = "static";
  body.hitArea = new Rectangle(0, 0, shellWidth, 340);
  body.addChild(createPanelSurface(frameTexture, shellWidth, 340));
  body.on("pointertap", (event) => event.stopPropagation());
  const title = createPanelNameplate(
    nameplateTexture,
    nameplatePlacement.x,
    nameplatePlacement.y,
    nameplatePlacement.width,
    nameplatePlacement.rotation
  );
  const close = new Container();
  close.position.set(shellWidth - 52, 13);
  close.eventMode = "static";
  close.cursor = "pointer";
  close.hitArea = new Rectangle(0, 0, 30, 30);
  const x = label("X", 15, 0xe2a348);
  x.anchor.set(0.5);
  x.position.set(15, 15);
  close.addChild(x);
  close.on("pointertap", onClose);
  body.addChild(title, close);
  root.addChild(shade, body);
  return { root, body };
};

export function createLevel1PuzzleOverlays(
  handlers: Level1PuzzleHandlers,
  panelFrames: PanelFrameTextures,
  panelNameplates: PanelNameplateTextures,
  panelHardware: PanelHardwareTextures
): Level1PuzzleOverlays {
  const container = new Container();
  container.zIndex = 2_100_000;
  let active: Level1PuzzleId | null = null;
  let activeTransition: PanelApertureTransition | null = null;
  let draggingSlider: number | null = null;
  let regulatorPreview: [number, number, number] | null = null;
  let arcFlashMs = 0;
  let waveDriftPhase = 0;
  let regulatorDrawAccumulator = 0;
  let cuePulseMs = 0;
  const regulatorFrameMs = 1000 / 15;
  let signalPhase = 0;
  const mistakeSparks = createPanelMistakeSparks();
  let seenArcFlashes = handlers.snapshot().breakerPuzzle.arcFlashes;
  const close = (playSound = false, immediate = false) => {
    const wasOpen = activeTransition?.visible ?? false;
    active = null;
    draggingSlider = null;
    regulatorPreview = null;
    arcFlashMs = 0;
    flash.visible = false;
    if (immediate) activeTransition?.hideImmediately();
    else activeTransition?.close();
    activeTransition = null;
    if (wasOpen && playSound) handlers.panelClosed();
  };

  const junction = makeShell(
    panelNameplates.junctionRouter,
    { x: 96, y: 16, width: 142, rotation: -0.01 },
    () => close(true),
    panelFrames.standard
  );
  const junctionGlyphTilts = [-0.025, 0.018, -0.012, 0.027] as const;
  const junctionModules = SIGNAL_GLYPHS.map((glyph, index) => {
    const root = new Container();
    root.position.set(22 + index * 151, 75);

    const lampBezel = createHardwareSprite(panelHardware.junctionLampBezel, 106, 2, 3, 0.54, 1.5);
    lampBezel.position.set(69, 31);
    const lampXs = [37, 69, 101] as const;
    const lamps = lampXs.map((x) => {
      const off = new Sprite(panelHardware.junctionLampOff);
      off.anchor.set(0.5);
      off.position.set(x, 31);
      off.width = 25;
      off.scale.y = off.scale.x;
      off.roundPixels = true;
      const amber = new Sprite(panelHardware.junctionLampAmber);
      amber.anchor.set(0.5);
      amber.position.copyFrom(off.position);
      amber.width = 25;
      amber.scale.y = amber.scale.x;
      amber.alpha = 0;
      amber.blendMode = "add";
      amber.roundPixels = true;
      const amberGlow = new Sprite(panelHardware.junctionLampAmber);
      amberGlow.anchor.set(0.5);
      amberGlow.position.copyFrom(off.position);
      amberGlow.width = 36;
      amberGlow.scale.y = amberGlow.scale.x;
      amberGlow.alpha = 0;
      amberGlow.blendMode = "add";
      amberGlow.filters = [new BlurFilter({ strength: 6, quality: 1 })];
      const green = new Sprite(panelHardware.continuityLedGreen);
      green.anchor.set(0.5);
      green.position.copyFrom(off.position);
      green.width = 25;
      green.scale.y = green.scale.x;
      green.alpha = 0;
      green.blendMode = "add";
      green.roundPixels = true;
      const greenGlow = new Sprite(panelHardware.continuityLedGreen);
      greenGlow.anchor.set(0.5);
      greenGlow.position.copyFrom(off.position);
      greenGlow.width = 37;
      greenGlow.scale.y = greenGlow.scale.x;
      greenGlow.alpha = 0;
      greenGlow.blendMode = "add";
      greenGlow.filters = [new BlurFilter({ strength: 7, quality: 1 })];
      return { off, amberGlow, amber, greenGlow, green };
    });

    const glyphSprite = new Sprite(panelHardware.breakerGlyphs[glyph]);
    glyphSprite.anchor.set(0.5);
    glyphSprite.position.set(37, 126);
    glyphSprite.width = 29;
    glyphSprite.scale.y = glyphSprite.scale.x;
    glyphSprite.tint = 0xaaa69c;
    glyphSprite.rotation = junctionGlyphTilts[index] ?? 0;
    glyphSprite.roundPixels = true;

    const makeSwitchState = (texture: typeof panelHardware.junctionSwitchReady, anchorX: number, anchorY: number) => {
      const state = new Container();
      const shadow = new Sprite(texture);
      shadow.anchor.set(anchorX, anchorY);
      shadow.position.set(3, 4);
      shadow.scale.set(0.3);
      shadow.tint = 0x000000;
      shadow.alpha = 0.68;
      shadow.filters = [new BlurFilter({ strength: 2, quality: 1 })];
      const sprite = new Sprite(texture);
      sprite.anchor.set(anchorX, anchorY);
      sprite.scale.set(0.3);
      sprite.roundPixels = true;
      state.addChild(shadow, sprite);
      return state;
    };
    const switchControl = new Container();
    switchControl.position.set(101, 126);
    switchControl.eventMode = "static";
    switchControl.cursor = "pointer";
    switchControl.hitArea = new Rectangle(-37, -47, 74, 104);
    const switchReady = makeSwitchState(panelHardware.junctionSwitchReady, 131 / 189, 160 / 320);
    const switchIsolated = makeSwitchState(panelHardware.junctionSwitchIsolated, 59 / 119, 159 / 342);
    switchIsolated.visible = false;
    switchControl.addChild(switchReady, switchIsolated);
    switchControl.on("pointertap", () => handlers.selectJunctionGlyph(glyph));

    root.addChild(lampBezel);
    lamps.forEach(({ off, amberGlow, amber, greenGlow, green }) => root.addChild(amberGlow, greenGlow, off, amber, green));
    root.addChild(glyphSprite, switchControl);
    junction.body.addChild(root);
    return { root, glyph, glyphSprite, lamps, switchControl, switchReady, switchIsolated };
  });
  container.addChild(junction.root);

  const regulator = makeShell(
    panelNameplates.harmonicRegulator,
    { x: 91, y: 20, width: 126, rotation: 0.012 },
    () => close(true),
    panelFrames.sealed
  );
  const scopeBezel = createHardwareSprite(panelHardware.regulatorBezel, 326, 6, 8, 0.72, 3);
  scopeBezel.position.set(451, 188);
  const scopeScreen = { x: 309, y: 109, width: 284, height: 157 } as const;
  const scopeCenterY = scopeScreen.y + scopeScreen.height / 2;
  const scopeContent = new Container();
  const scopeMask = new Graphics()
    .roundRect(scopeScreen.x, scopeScreen.y, scopeScreen.width, scopeScreen.height, 18)
    .fill(0xffffff);
  scopeContent.mask = scopeMask;
  const scopeGlass = new Graphics()
    .roundRect(scopeScreen.x, scopeScreen.y, scopeScreen.width, scopeScreen.height, 18)
    .fill({ color: 0x08100f, alpha: 0.2 });
  const scopeGuides = new Graphics()
    .moveTo(scopeScreen.x + 7, scopeCenterY)
    .lineTo(scopeScreen.x + scopeScreen.width - 7, scopeCenterY)
    .stroke({ color: 0x42615a, width: 1, alpha: 0.42 });
  const gateAView = new Graphics();
  const gateBView = new Graphics();
  gateAView.blendMode = "add";
  gateBView.blendMode = "add";
  const waveformGlow = new Graphics();
  waveformGlow.blendMode = "add";
  waveformGlow.filters = [new BlurFilter({ strength: 3, quality: 1 })];
  const waveform = new Graphics();
  const scanlines = new Graphics();
  for (let y = scopeScreen.y + 3; y < scopeScreen.y + scopeScreen.height - 3; y += 4) {
    scanlines.moveTo(scopeScreen.x + 4, y).lineTo(scopeScreen.x + scopeScreen.width - 4, y);
  }
  scanlines.stroke({ color: 0x000000, width: 1, alpha: 0.2 });
  const glassVignette = new Graphics()
    .roundRect(scopeScreen.x + 3, scopeScreen.y + 3, scopeScreen.width - 6, scopeScreen.height - 6, 16)
    .stroke({ color: 0x000000, width: 9, alpha: 0.3 });
  scopeContent.addChild(scopeGlass, scopeGuides, gateAView, gateBView, waveformGlow, waveform, scanlines, glassVignette);
  regulator.body.addChild(scopeBezel, scopeContent, scopeMask);
  const sliderViews: Array<{ root: Container; knob: Container; cue: InteractionCue; index: number }> = [];
  const leverTop = 76;
  const leverTravel = 219;
  // Keep the handle inside the visible inner rail, not merely inside the
  // transparent bounds of the track texture and its decorative end caps.
  const leverInset = 30;
  const leverVisualTravel = leverTravel - leverInset * 2;
  const leverY = (value: number) => leverInset + ((4 - value) / 4) * leverVisualTravel;
  const displayedRegulatorSliders = (): readonly number[] =>
    regulatorPreview ?? handlers.snapshot().regulatorPuzzle.sliders;
  const setSliderFromEvent = (index: number, event: { global: { x: number; y: number } }) => {
    const state = handlers.snapshot();
    const ready = state.spiral.breaker4Pulled && state.spiral.junction === "clean";
    if (!ready || state.spiral.regulator === "precise") return;
    const local = regulator.body.toLocal(event.global);
    const normalizedY = (local.y - leverTop - leverInset) / leverVisualTravel;
    const rawValue = Math.max(0, Math.min(4, 4 - normalizedY * 4));
    const value = Math.round(rawValue * 100) / 100;
    const sliders = regulatorPreview ?? [...state.regulatorPuzzle.sliders] as [number, number, number];
    if (Math.abs((sliders[index] ?? 0) - value) < 0.025) return;
    sliders[index] = value;
    regulatorPreview = sliders;
    sliderViews[index]?.knob.position.set(0, leverY(value));
  };
  for (let index = 0; index < 3; index += 1) {
    const root = new Container();
    root.position.set(80 + index * 70, leverTop);
    root.eventMode = "static";
    root.cursor = "ns-resize";
    root.hitArea = new Rectangle(-27, -20, 54, leverTravel + 40);
    const track = createHardwareSprite(panelHardware.regulatorTrack, 48, 2, 3);
    track.position.set(0, leverTravel / 2);
    const knob = createHardwareSprite(panelHardware.regulatorHandle, 50, 5, 7, 0.76, 2.5);
    const cue = createInteractionCue();
    cue.position.set(0, -20);
    knob.addChild(cue);
    track.eventMode = "none";
    knob.eventMode = "none";
    root.addChild(track, knob);
    root.on("pointerdown", (event) => {
      cue.visible = false;
      draggingSlider = index;
      regulatorPreview = [...handlers.snapshot().regulatorPuzzle.sliders] as [number, number, number];
      root.cursor = "grabbing";
      setSliderFromEvent(index, event);
    });
    sliderViews.push({ root, knob, cue, index });
    regulator.body.addChild(root);
  }
  const finishSliderDrag = () => {
    if (draggingSlider === null) return;
    const sliderIndex = draggingSlider;
    const draggedView = sliderViews[sliderIndex];
    const committedValue = regulatorPreview?.[sliderIndex];
    if (draggedView) draggedView.root.cursor = "ns-resize";
    draggingSlider = null;
    regulatorPreview = null;
    if (committedValue !== undefined) handlers.setRegulator(sliderIndex, committedValue);
  };
  regulator.root.on("globalpointermove", (event) => {
    if (draggingSlider !== null) setSliderFromEvent(draggingSlider, event);
  });
  regulator.root.on("pointerup", finishSliderDrag);
  regulator.root.on("pointerupoutside", finishSliderDrag);
  regulator.root.on("pointercancel", finishSliderDrag);
  container.addChild(regulator.root);

  const breakers = makeShell(
    panelNameplates.emergencyBreakerBank,
    { x: 99, y: 20, width: 142, rotation: -0.014 },
    () => close(true),
    panelFrames.reinforced,
    550
  );
  const breakerViews: Array<{ lever: Container; topMarker: Graphics; bottomMarker: Graphics; glyph: Sprite; root: Container; index: number }> = [];
  const breakerGlyphTilts = [-0.028, 0.019, -0.015, 0.031] as const;
  for (let index = 0; index < 4; index += 1) {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const root = new Container();
    root.position.set(47 + col * 235, 67 + row * 126);
    root.eventMode = "static";
    root.cursor = "pointer";
    root.hitArea = new Rectangle(0, 0, 220, 118);
    const num = label(`B${index + 1}`, 14, 0xe2a348);
    num.position.set(12, 10);
    const glyph = new Sprite(panelHardware.breakerGlyphs.RING);
    glyph.anchor.set(0.5);
    glyph.position.set(60, 58);
    glyph.width = 31;
    glyph.scale.y = glyph.scale.x;
    glyph.tint = 0xaaa69c;
    glyph.rotation = breakerGlyphTilts[index] ?? 0;
    glyph.roundPixels = true;
    glyph.eventMode = "none";
    const housing = createHardwareSprite(panelHardware.breakerHousing, 49, 2, 3, 0.62, 1.5);
    housing.position.set(125, 58);
    const lever = createHardwareSprite(panelHardware.breakerHandle, 31, 3, 4, 0.7, 2);
    // The visible handle sits left of the source frame's geometric center.
    lever.position.set(129, 63);
    const topMarker = new Graphics()
      .moveTo(-11, 4).lineTo(-11, 0).lineTo(11, 0).lineTo(11, 4)
      .stroke({ color: 0xffffff, width: 1.5 });
    topMarker.position.set(124, 15);
    const bottomMarker = new Graphics()
      .moveTo(-11, -4).lineTo(-11, 0).lineTo(11, 0).lineTo(11, -4)
      .stroke({ color: 0xffffff, width: 1.5 });
    bottomMarker.position.set(124, 102);
    root.addChild(num, glyph, topMarker, bottomMarker, housing, lever);
    root.on("pointertap", () => {
      const state = handlers.snapshot();
      if (!state.breakerPuzzle.touched[index]) handlers.touchBreaker(index);
      else if (state.breakerPuzzle.positions[index] === "up" || state.breakerPuzzle.positions[index] === "pulled") return;
      else if (index === state.breakerPuzzle.faultIndex) handlers.pullBreaker(index);
      else handlers.toggleBreaker(index);
    });
    breakerViews.push({ lever, topMarker, bottomMarker, glyph, root, index });
    breakers.body.addChild(root);
  }
  const flash = new Graphics().rect(0, 0, 960, 420).fill(0xffffff);
  flash.visible = false;
  flash.eventMode = "none";
  flash.zIndex = 9_000_000;
  container.addChild(breakers.root, flash);
  container.addChild(mistakeSparks.container);
  const puzzleTransitions: Record<Level1PuzzleId, PanelApertureTransition> = {
    junction_board: new PanelApertureTransition(junction.root),
    regulator: new PanelApertureTransition(regulator.root),
    breaker_bank: new PanelApertureTransition(breakers.root)
  };

  const refresh = () => {
    const state = handlers.snapshot();
    const decoded = state.junctionPuzzle.decoded;
    const faultGlyph = getJunctionFaultGlyph(state);
    junctionModules.forEach(({ glyph, glyphSprite, lamps, switchControl, switchReady, switchIsolated }) => {
      const isolated = decoded && glyph === faultGlyph;
      glyphSprite.alpha = isolated ? 0.42 : 1;
      lamps.forEach(({ off }) => { off.alpha = isolated ? 0.55 : 1; });
      switchReady.visible = !isolated;
      switchIsolated.visible = isolated;
      switchControl.eventMode = decoded ? "none" : "static";
      switchControl.cursor = decoded ? "default" : "pointer";
    });
    const regulatorReady = state.spiral.breaker4Pulled && state.spiral.junction === "clean";
    const displayedSliders = regulatorPreview ?? state.regulatorPuzzle.sliders;
    sliderViews.forEach(({ root, knob, index }) => {
      const value = displayedSliders[index] ?? 0;
      knob.y = leverY(value);
      knob.tint = 0xffffff;
      const adjustable = regulatorReady && state.spiral.regulator !== "precise";
      root.eventMode = adjustable ? "static" : "none";
      root.cursor = adjustable ? "ns-resize" : "default";
      root.alpha = regulatorReady ? 1 : 0.42;
    });
    breakerViews.forEach(({ lever, topMarker, bottomMarker, glyph, index }) => {
      const position = state.breakerPuzzle.positions[index];
      const glyphName = state.breakerPuzzle.glyphs[index] ?? "RING";
      glyph.texture = panelHardware.breakerGlyphs[glyphName];
      glyph.width = 31;
      glyph.scale.y = glyph.scale.x;
      lever.y = position === "up" ? 48 : position === "pulled" ? 79 : 63;
      lever.rotation = 0;
      lever.alpha = position === "pulled" ? 0.15 : 1;
      const topActive = position === "up";
      topMarker.tint = topActive ? 0xd8a149 : 0x5f5a50;
      topMarker.alpha = topActive ? 0.95 : 0.42;
      bottomMarker.tint = position === "pulled" ? 0xd58b59 : !topActive ? 0xd8a149 : 0x5f5a50;
      bottomMarker.alpha = !topActive ? 0.95 : 0.42;
    });
    if (state.breakerPuzzle.arcFlashes > seenArcFlashes) {
      seenArcFlashes = state.breakerPuzzle.arcFlashes;
      arcFlashMs = 200;
      flash.visible = true;
    }
  };

  const drawWaveform = () => {
    const state = handlers.snapshot();
    waveform.clear();
    waveformGlow.clear();
    const displayedSliders = displayedRegulatorSliders();
    const [phaseControl = 0, frequencyControl = 0, dampingControl = 0] = displayedSliders;
    const geometry = getRegulatorScopeGeometry(displayedSliders);
    const spacing = geometry.spacing;
    const phaseOffset = geometry.phaseOffset + waveDriftPhase;
    const phaseError = 2 - phaseControl;
    const frequencyError = 2 - frequencyControl;
    const dampingTarget = REGULATOR_PRECISE_TARGET[2];
    const ringing = Math.max(0, dampingTarget - dampingControl) * 8.5;
    const overDamping = Math.max(0, dampingControl - dampingTarget);
    const carrierAmplitude = 43 * Math.max(0.58, 1 - overDamping * 0.16);
    const disorder = Math.min(1,
      Math.abs(frequencyError) * 0.2
      + Math.abs(phaseError) * 0.16
      + Math.max(0, dampingTarget - dampingControl) / dampingTarget * 0.72
    );
    const peaksAccepted = regulatorPeaksInWindows(displayedSliders);
    const drawPeakWindow = (view: Graphics, centerX: number, relativeX: number): boolean => {
      const phase = relativeX * spacing + phaseOffset;
      const crestDistance = Math.abs(Math.atan2(Math.sin(phase - Math.PI / 2), Math.cos(phase - Math.PI / 2)));
      const strength = Math.max(0, 1 - crestDistance / 0.72);
      const inside = crestDistance <= spacing * 5;
      const accepted = peaksAccepted;
      const gateColor = accepted ? 0x83d1a1 : 0xe2a348;
      const top = scopeScreen.y + 3;
      const height = scopeScreen.height - 6;
      view
        .clear()
        .rect(centerX - 5, top, 10, height)
        .fill({ color: gateColor, alpha: 0.06 + strength * 0.16 })
        .stroke({ color: gateColor, width: accepted ? 3 : inside ? 2 : 1, alpha: 0.48 + strength * 0.42 });
      if (strength > 0.18) {
        view
          .rect(centerX - 9, top, 18, height)
          .fill({ color: gateColor, alpha: strength * (accepted ? 0.085 : 0.045) });
      }
      return inside;
    };
    const peakAInside = drawPeakWindow(gateAView, 363, 52);
    const peakBInside = drawPeakWindow(gateBView, 471, 160);
    const consecutivePeaksHeld = frequencyError === 0 && peakAInside && peakBInside;
    gateAView.alpha = consecutivePeaksHeld ? 1 : 0.78;
    gateBView.alpha = consecutivePeaksHeld ? 1 : 0.78;
    const traceLeft = scopeScreen.x + 8;
    const traceWidth = scopeScreen.width - 16;
    const traceCenterX = scopeScreen.x + scopeScreen.width / 2;
    const curvePoint = (x: number, y: number) => {
      const normalizedX = (x - traceCenterX) / (traceWidth / 2);
      const edge = normalizedX * normalizedX;
      return {
        x: Math.round(x / 2) * 2,
        y: Math.round((scopeCenterY + (y - scopeCenterY) * (1 - edge * 0.14) + edge * 8) / 2) * 2
      };
    };
    for (let x = 0; x < traceWidth; x += 3) {
      const phase = x * spacing + phaseOffset;
      const envelope = 1 + Math.sin(phase * 0.43 + 0.7) * disorder * 0.3;
      const unevenHarmonics = Math.sin(phase * 2.35 + 1.1) * ringing * 0.62
        + Math.sin(phase * 4.7 - 0.4) * ringing * 0.34;
      const unstableNoise = disorder * (
        Math.sin(phase * 7.3 + phaseOffset * 0.7) * 7
        + Math.sin(phase * 11.1 - 0.8) * 4
      );
      const y = scopeCenterY + 1
        - Math.sin(phase) * carrierAmplitude * envelope
        - unevenHarmonics
        - unstableNoise;
      const curved = curvePoint(traceLeft + x, y);
      if (x === 0) {
        waveform.moveTo(curved.x, curved.y);
        waveformGlow.moveTo(curved.x, curved.y);
      } else {
        waveform.lineTo(curved.x, curved.y);
        waveformGlow.lineTo(curved.x, curved.y);
      }
    }
    const traceColor = state.spiral.regulator === "precise" ? 0x83d1a1 : 0xe2a348;
    waveformGlow.stroke({ color: traceColor, width: 5, alpha: 0.28 });
    waveform.stroke({ color: traceColor, width: 2 });
  };

  close();
  refresh();
  drawWaveform();
  return {
    container,
    close: () => close(false, true),
    open(id) {
      close(false, true);
      active = id;
      activeTransition = puzzleTransitions[id];
      activeTransition.open();
      handlers.panelOpened();
      refresh();
      if (id === "regulator") {
        const state = handlers.snapshot();
        const adjustable = state.spiral.breaker4Pulled
          && state.spiral.junction === "clean"
          && state.spiral.regulator !== "precise";
        sliderViews.forEach(({ cue, index }) => { cue.visible = adjustable && index === 0; });
        cuePulseMs = 0;
        regulatorDrawAccumulator = 0;
        drawWaveform();
      }
    },
    mistakeBurst() {
      if (active === null) return false;
      mistakeSparks.burst({ x: 155, y: 55, width: 640, height: 300 });
      return true;
    },
    refresh,
    update(deltaMs) {
      for (const transition of Object.values(puzzleTransitions)) transition.update(deltaMs);
      mistakeSparks.update(deltaMs);
      if (active === null) return;
      if (active === "junction_board") {
        const state = handlers.snapshot();
        signalPhase += deltaMs;
        const cycleMs = 2_100;
        const pulseDurationMs = 320;
        const phaseMs = signalPhase % cycleMs;
        const pulseAt = (offset: number) => {
          const local = (phaseMs - offset + cycleMs) % cycleMs;
          return local < pulseDurationMs ? 1 - local / pulseDurationMs : 0;
        };
        const faultGlyph = getJunctionFaultGlyph(state);
        const fingerprint = getJunctionFingerprint(state);
        junctionModules.forEach(({ glyph, lamps }) => {
          const isolated = state.junctionPuzzle.decoded && glyph === faultGlyph;
          let strengths = state.spiral.listened
            ? [pulseAt(0), pulseAt(450), pulseAt(900)]
            : [0, 0, 0];
          if (!state.junctionPuzzle.decoded && glyph === faultGlyph) {
            // Keep the fault beats separated from the normal cadence so they
            // remain readable even with the longer, brighter lamp pulse.
            if (fingerprint === "duplicate") strengths = [pulseAt(0), Math.max(pulseAt(450), pulseAt(1_450)), pulseAt(900)];
            if (fingerprint === "delayed") strengths = [pulseAt(0), pulseAt(450), pulseAt(1_450)];
            if (fingerprint === "dropped") strengths = [pulseAt(0), 0, pulseAt(900)];
          }
          if (isolated) strengths = [0, 0, 0];
          lamps.forEach(({ amberGlow, amber, greenGlow, green }, lampIndex) => {
            const strength = strengths[lampIndex] ?? 0;
            const healthySolved = state.junctionPuzzle.decoded && !isolated;
            amber.alpha = healthySolved ? 0 : strength;
            amberGlow.alpha = healthySolved ? 0 : strength * 0.78;
            green.alpha = healthySolved ? strength : 0;
            greenGlow.alpha = healthySolved ? strength * 0.68 : 0;
          });
        });
      }
      if (active === "regulator") {
        cuePulseMs += deltaMs;
        const cue = sliderViews[0]?.cue;
        if (cue?.visible) {
          const pulse = (Math.sin(cuePulseMs / 420) + 1) / 2;
          cue.alpha = 1;
          cue.scale.set(1);
          cue.pulseBorder.alpha = 0.22 + pulse * 0.68;
          cue.pulseBorder.scale.set(1 + pulse * 0.055);
        }
        regulatorDrawAccumulator += deltaMs;
        const frequencyError = getRegulatorControlError(displayedRegulatorSliders()[1] ?? 0);
        if (frequencyError === 0) {
          waveDriftPhase *= Math.pow(0.006, deltaMs / 1000);
          if (Math.abs(waveDriftPhase) < 0.001) waveDriftPhase = 0;
        } else {
          waveDriftPhase += deltaMs / 1000 * frequencyError * 0.4;
          waveDriftPhase = Math.atan2(Math.sin(waveDriftPhase), Math.cos(waveDriftPhase));
        }
        if (regulatorDrawAccumulator >= regulatorFrameMs) {
          regulatorDrawAccumulator %= regulatorFrameMs;
          drawWaveform();
        }
      }
      if (arcFlashMs > 0) {
        arcFlashMs -= deltaMs;
        flash.alpha = Math.max(0, arcFlashMs / 200);
        if (arcFlashMs <= 0) flash.visible = false;
      }
    },
    destroy() {
      mistakeSparks.destroy();
      container.destroy({ children: true });
    }
  };
}
