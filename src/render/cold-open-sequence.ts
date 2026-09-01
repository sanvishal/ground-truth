import { BitmapText, Container, Graphics, Rectangle, Sprite, Texture } from "pixi.js";
import { COLD_OPEN_PANELS, type ColdOpenPanelCopy } from "../content/cold-open";
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

export interface SequenceFinalAction {
  label?: string;
  credit?: string;
  onCredit?: () => void;
  onAction(): void;
}

export function createColdOpenSequence(
  textures: readonly Texture[],
  onCharacter?: (character: string) => void,
  onAdvance?: () => void,
  onPanelChange?: (panelIndex: number) => void,
  panels: readonly ColdOpenPanelCopy[] = COLD_OPEN_PANELS,
  allowSkip = false,
  finalAction?: SequenceFinalAction
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
  const skipText = makeText("ESC TO SKIP", 12, COLORS.muted, UI_FONT);
  skipText.anchor.set(1, 0);
  skipText.position.set(918, 18);
  skipText.visible = allowSkip;

  const finalCredit = makeText(finalAction?.credit ?? "", finalAction?.onCredit ? 18 : 13, finalAction?.onCredit ? COLORS.amber : COLORS.muted, UI_FONT);
  finalCredit.anchor.set(0.5);
  finalCredit.position.set(WIDTH / 2, 516);
  finalCredit.visible = false;
  if (finalAction?.onCredit) {
    finalCredit.eventMode = "none";
    finalCredit.cursor = "pointer";
    finalCredit.hitArea = new Rectangle(-finalCredit.width / 2 - 8, -finalCredit.height / 2 - 5, finalCredit.width + 16, finalCredit.height + 10);
    finalCredit.on("pointerover", () => { finalCredit.tint = 0xffd079; });
    finalCredit.on("pointerout", () => { finalCredit.tint = 0xffffff; });
    finalCredit.on("pointertap", (event) => {
      event.stopPropagation();
      finalAction.onCredit?.();
    });
  }
  const finalActionButton = new Container();
  finalActionButton.position.set(824, 520);
  finalActionButton.eventMode = "none";
  finalActionButton.cursor = "pointer";
  finalActionButton.hitArea = new Rectangle(-86, -15, 172, 30);
  const finalActionBack = new Graphics()
    .roundRect(-86, -15, 172, 30, 3)
    .fill({ color: COLORS.black, alpha: 0.92 })
    .stroke({ color: COLORS.amber, width: 1, alpha: 0.72 });
  const finalActionLabel = makeText(finalAction?.label ?? "", 13, COLORS.amber, UI_FONT);
  finalActionLabel.anchor.set(0.5);
  finalActionButton.addChild(finalActionBack, finalActionLabel);
  finalActionButton.visible = false;

  const content = new Container();
  content.addChild(backdrop, image, narrationBand, narration, continueText, holdText, skipText, finalCredit, finalActionButton);

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
  let finalActionReady = false;
  let completion: (() => void) | undefined;
  let appliedPauses = new Set<number>();

  const panel = () => panels[panelIndex]!;
  const isFinalPanel = () => panelIndex === panels.length - 1;
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
    finalCredit.visible = false;
    finalCredit.eventMode = "none";
    finalActionReady = false;
    finalActionButton.visible = false;
    finalActionButton.eventMode = "none";
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
    const showAction = Boolean(finalAction && isFinalPanel());
    finalActionReady = showAction;
    holdText.visible = !showAction && Boolean(current.finalHoldMs);
    continueText.visible = !showAction && !current.finalHoldMs;
    finalCredit.visible = showAction && Boolean(finalAction?.credit);
    finalCredit.eventMode = finalCredit.visible && Boolean(finalAction?.onCredit) ? "static" : "none";
    finalActionButton.visible = showAction && Boolean(finalAction?.label);
    finalActionButton.eventMode = finalActionButton.visible ? "static" : "none";
  };

  const activateFinalAction = () => {
    if (!finalAction || !finalActionReady) return;
    finalActionReady = false;
    container.visible = false;
    container.eventMode = "none";
    finalCredit.eventMode = "none";
    finalActionButton.eventMode = "none";
    finalAction.onAction();
  };
  finalActionButton.on("pointertap", (event) => {
    event.stopPropagation();
    onAdvance?.();
    activateFinalAction();
  });

  const activateDestination = () => {
    if (destinationActivated) return;
    destinationActivated = true;
    content.visible = false;
    const callback = completion;
    completion = undefined;
    callback?.();
  };

  const finishSequence = () => {
    container.visible = false;
    container.eventMode = "none";
    container.alpha = 1;
    dissolving = false;
    shutter.visible = false;
    shutterMask.clear();
    // A destination callback may synchronously navigate and destroy the Pixi
    // scene. Finish all local cleanup before handing control to it.
    activateDestination();
  };

  const advance = () => {
    if (!container.visible || dissolving || inputLockRemaining > 0) return;
    if (introHoldElapsed < TEXT_START_DELAY_MS) return;
    inputLockRemaining = INPUT_DEBOUNCE_MS;
    onAdvance?.();
    if (finalActionReady) {
      activateFinalAction();
      return;
    }
    if (!typingComplete) {
      finishTyping();
      return;
    }
    if (!canContinue()) return;
    if (panelIndex < panels.length - 1) {
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
    if (!container.visible) return;
    if (allowSkip && event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (finalAction) {
        panelIndex = panels.length - 1;
        resetPanel();
        introHoldElapsed = TEXT_START_DELAY_MS;
        inputLockRemaining = 0;
        finishTyping();
        return;
      }
      finishSequence();
      return;
    }
    if (!["Enter", " ", "ArrowRight"].includes(event.key)) return;
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
        if (!finalActionReady) {
          continueText.visible = ready;
          holdText.visible = !ready && Boolean(panel().finalHoldMs);
        }
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
