import { BitmapText, Container, Graphics, Rectangle, Sprite, Texture } from "pixi.js";
import { COLD_OPEN_PANELS } from "../content/cold-open";
import { DIALOGUE_FONT, UI_FONT } from "../fonts";
import { ColdOpenDitherFilter } from "./cold-open-dither-filter";
import { drawBayerMask } from "./screen-dither-transition";

const WIDTH = 960;
const HEIGHT = 540;
const IMAGE_HEIGHT = 400;
const PANEL_WIDTH = 640;
const PANEL_HEIGHT = 360;
const TYPE_CPS = 38;
const SHUTTER_MS = 900;
const TEXT_START_DELAY_MS = 500;
const INPUT_ARM_DELAY_MS = 260;
const INPUT_DEBOUNCE_MS = 140;

const COLORS = {
  black: 0x030506,
  ink: 0xe7dfcc,
  amber: 0xe2a348,
  muted: 0x8f918c
};

const makeText = (value: string, size: number, color: number, family = DIALOGUE_FONT): BitmapText => new BitmapText({
  text: value,
  style: { fontFamily: family, fontSize: size, fill: color, letterSpacing: 0 }
});

const punctuationPause = (character: string): number => {
  if (character === ".") return 260;
  if (character === ",") return 120;
  if (character === ";" || character === ":") return 170;
  return 0;
};

export interface ColdOpenSequence {
  container: Container;
  play(onComplete?: () => void): void;
  update(deltaMs: number): void;
  destroy(): void;
}

export function createColdOpenSequence(
  textures: readonly Texture[],
  onCharacter?: (character: string) => void,
  onAdvance?: () => void,
  onPanelChange?: (panelIndex: number) => void
): ColdOpenSequence {
  const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const container = new Container();
  container.visible = false;
  container.eventMode = "static";
  container.hitArea = new Rectangle(0, 0, WIDTH, HEIGHT);
  container.cursor = "pointer";

  const backdrop = new Graphics().rect(0, 0, WIDTH, HEIGHT).fill(COLORS.black);
  const image = new Sprite(textures[0] ?? Texture.EMPTY);
  image.position.set(Math.round((WIDTH - PANEL_WIDTH) / 2), Math.round((IMAGE_HEIGHT - PANEL_HEIGHT) / 2));
  image.width = PANEL_WIDTH;
  image.height = PANEL_HEIGHT;
  image.roundPixels = true;
  const ditherFilter = new ColdOpenDitherFilter();
  image.filters = [ditherFilter];

  const narrationBand = new Graphics().rect(0, IMAGE_HEIGHT, WIDTH, HEIGHT - IMAGE_HEIGHT).fill(COLORS.black);
  const narration = makeText("", 21, COLORS.ink);
  narration.position.set(Math.round((WIDTH - PANEL_WIDTH) / 2), 410);
  narration.style.wordWrap = true;
  narration.style.wordWrapWidth = PANEL_WIDTH;
  narration.style.lineHeight = 27;

  const continueText = makeText("CLICK TO CONTINUE", 14, COLORS.amber, UI_FONT);
  continueText.anchor.set(1, 0.5);
  continueText.position.set(918, 520);
  continueText.visible = false;
  const holdText = makeText("...", 16, COLORS.muted, UI_FONT);
  holdText.anchor.set(1, 0.5);
  holdText.position.set(918, 520);
  holdText.visible = false;

  const content = new Container();
  content.addChild(backdrop, image, narrationBand, narration, continueText, holdText);

  // The ordered dither curtain becomes fully opaque before the destination is
  // swapped, so gameplay never bleeds through the final comic panel.
  const shutter = new Graphics().rect(0, 0, WIDTH, HEIGHT).fill(COLORS.black);
  const shutterMask = new Graphics();
  shutter.mask = shutterMask;
  shutter.visible = false;
  container.addChild(content, shutter, shutterMask);

  let panelIndex = 0;
  let visibleCharacters = 0;
  let characterAccumulator = 0;
  let introHoldElapsed = 0;
  let pauseRemaining = 0;
  let finalHoldElapsed = 0;
  let typingComplete = false;
  let dissolving = false;
  let dissolveElapsed = 0;
  let destinationActivated = false;
  let inputLockRemaining = 0;
  let completion: (() => void) | undefined;
  let appliedPauses = new Set<number>();

  const panel = () => COLD_OPEN_PANELS[panelIndex];
  const canContinue = () => typingComplete
    && introHoldElapsed >= TEXT_START_DELAY_MS
    && finalHoldElapsed >= (panel().finalHoldMs ?? 0);

  const resetPanel = () => {
    image.texture = textures[panelIndex] ?? Texture.EMPTY;
    image.alpha = 1;
    visibleCharacters = 0;
    characterAccumulator = 0;
    introHoldElapsed = prefersReducedMotion ? TEXT_START_DELAY_MS : 0;
    pauseRemaining = 0;
    finalHoldElapsed = 0;
    typingComplete = false;
    appliedPauses = new Set<number>();
    narration.text = "";
    continueText.visible = false;
    holdText.visible = false;
    ditherFilter.setProgress(prefersReducedMotion ? 1 : 0);
    image.filters = prefersReducedMotion ? [] : [ditherFilter];
    // Ensure a stale longer page never affects the next panel's wrap bounds.
    narration.style.wordWrapWidth = PANEL_WIDTH;
    onPanelChange?.(panelIndex);
  };

  const finishTyping = () => {
    const current = panel();
    visibleCharacters = current.text.length;
    narration.text = current.text;
    typingComplete = true;
    pauseRemaining = 0;
    image.alpha = 1;
    holdText.visible = Boolean(current.finalHoldMs);
    continueText.visible = !current.finalHoldMs;
  };

  const activateDestination = () => {
    if (destinationActivated) return;
    destinationActivated = true;
    content.visible = false;
    const callback = completion;
    completion = undefined;
    callback?.();
  };

  const finishSequence = () => {
    activateDestination();
    container.visible = false;
    container.eventMode = "none";
    container.alpha = 1;
    dissolving = false;
    shutter.visible = false;
    shutterMask.clear();
  };

  const advance = () => {
    if (!container.visible || dissolving || inputLockRemaining > 0) return;
    if (introHoldElapsed < TEXT_START_DELAY_MS) return;
    inputLockRemaining = INPUT_DEBOUNCE_MS;
    onAdvance?.();
    if (!typingComplete) {
      finishTyping();
      return;
    }
    if (!canContinue()) return;
    if (panelIndex < COLD_OPEN_PANELS.length - 1) {
      panelIndex += 1;
      resetPanel();
      return;
    }
    if (prefersReducedMotion) {
      finishSequence();
      return;
    }
    dissolving = true;
    dissolveElapsed = 0;
    destinationActivated = false;
    continueText.visible = false;
    holdText.visible = false;
    shutter.visible = true;
    container.eventMode = "none";
  };

  const keydown = (event: KeyboardEvent) => {
    if (!container.visible || !["Enter", " ", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    advance();
  };
  container.on("pointertap", advance);
  window.addEventListener("keydown", keydown, true);

  return {
    container,
    play(onComplete) {
      completion = onComplete;
      panelIndex = 0;
      dissolving = false;
      dissolveElapsed = 0;
      destinationActivated = false;
      inputLockRemaining = INPUT_ARM_DELAY_MS;
      container.alpha = 1;
      content.visible = true;
      shutter.visible = false;
      shutterMask.clear();
      container.visible = true;
      container.eventMode = "static";
      resetPanel();
    },
    update(deltaMs) {
      if (!container.visible) return;
      inputLockRemaining = Math.max(0, inputLockRemaining - deltaMs);
      if (dissolving) {
        dissolveElapsed = Math.min(SHUTTER_MS, dissolveElapsed + deltaMs);
        const progress = dissolveElapsed / SHUTTER_MS;
        const coverage = progress < 0.5 ? progress * 2 : (1 - progress) * 2;
        drawBayerMask(shutterMask, coverage, WIDTH, HEIGHT);
        if (progress >= 0.5) activateDestination();
        if (dissolveElapsed >= SHUTTER_MS) finishSequence();
        return;
      }

      introHoldElapsed = Math.min(TEXT_START_DELAY_MS, introHoldElapsed + deltaMs);
      if (!prefersReducedMotion) {
        ditherFilter.setProgress(introHoldElapsed / TEXT_START_DELAY_MS);
        if (introHoldElapsed >= TEXT_START_DELAY_MS) image.filters = [];
      }
      if (introHoldElapsed < TEXT_START_DELAY_MS) return;

      if (typingComplete) {
        finalHoldElapsed += deltaMs;
        const ready = canContinue();
        continueText.visible = ready;
        holdText.visible = !ready && Boolean(panel().finalHoldMs);
        return;
      }
      if (pauseRemaining > 0) {
        pauseRemaining = Math.max(0, pauseRemaining - deltaMs);
        return;
      }

      characterAccumulator += deltaMs * TYPE_CPS / 1_000;
      const current = panel();
      while (characterAccumulator >= 1 && visibleCharacters < current.text.length) {
        characterAccumulator -= 1;
        visibleCharacters += 1;
        const character = current.text[visibleCharacters - 1] ?? "";
        narration.text = current.text.slice(0, visibleCharacters);
        onCharacter?.(character);
        pauseRemaining += punctuationPause(character);
        for (let index = 0; index < current.pauses.length; index += 1) {
          if (appliedPauses.has(index)) continue;
          if (visibleCharacters === current.text.indexOf(current.pauses[index].after) + current.pauses[index].after.length) {
            pauseRemaining += current.pauses[index].durationMs;
            appliedPauses.add(index);
          }
        }
        if (pauseRemaining > 0) break;
      }
      if (visibleCharacters >= current.text.length) finishTyping();
    },
    destroy() {
      window.removeEventListener("keydown", keydown, true);
      container.removeAllListeners();
      image.filters = [];
      ditherFilter.destroy();
      container.destroy({ children: true });
    }
  };
}
