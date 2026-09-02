import "./styles.css";
import { mountDialogueLab } from "./dev/dialogue-lab";
import { mountLevel1CompositorLab } from "./dev/level1-compositor-lab";
import { mountLevel1RuntimeLab } from "./dev/level1-runtime-lab";
import { mountLevel2RuntimeLab } from "./dev/level2-runtime-lab";
import { mountRuntimeTabs } from "./dev/runtime-tabs";
import { loadDialogueFonts } from "./fonts";
import { createGroundtruthGame } from "./render/game";

const canvas = document.querySelector<HTMLCanvasElement>("#game");
if (!canvas) throw new Error("GROUNDTRUTH canvas is missing");

const loader = document.querySelector<HTMLElement>("#game-loader");
const loaderFill = document.querySelector<HTMLElement>("#loader-fill");
const loaderStatus = document.querySelector<HTMLElement>("#loader-status");
const preflightMessages = [
  "BALANCING FUEL LINES...",
  "CYCLING AIRLOCK SEALS...",
  "PRIMING MANEUVERING THRUSTERS...",
  "CALIBRATING STAR TRACKER...",
  "WARMING REACTOR LOOP...",
  "SECURING CARGO LATCHES...",
  "ALIGNING NAVIGATION ARRAY...",
  "VERIFYING HULL SEALS...",
  "PRESSURIZING CREW DECK...",
  "CHARGING LIFE SUPPORT RESERVES...",
  "PLOTTING RETURN CORRIDOR...",
  "SYNCHRONIZING ORBITAL CLOCKS...",
  "PURGING MANEUVER LINES...",
  "TESTING GRAVITY PLATES...",
  "COUNTING ESCAPE PODS...",
  "STOWING LOOSE CARGO...",
  "TRIMMING REACTION WHEELS...",
  "WAKING GUIDANCE COMPUTER..."
];
for (let index = preflightMessages.length - 1; index > 0; index -= 1) {
  const swapIndex = Math.floor(Math.random() * (index + 1));
  [preflightMessages[index], preflightMessages[swapIndex]] = [preflightMessages[swapIndex], preflightMessages[index]];
}
let loaderMessageIndex = 0;
const showNextPreflightMessage = () => {
  if (loaderStatus) loaderStatus.textContent = preflightMessages[loaderMessageIndex % preflightMessages.length];
  loaderMessageIndex += 1;
};
const updateLoader = (progress: number) => {
  const normalized = Math.max(0, Math.min(1, progress));
  if (loaderFill) loaderFill.style.width = `${Math.round(normalized * 100)}%`;
};

showNextPreflightMessage();
const preflightMessageTimer = window.setInterval(showNextPreflightMessage, 560);
updateLoader(0.03);
const bootstrap = async () => {
  const loaderStartedAt = performance.now();
  let game: Awaited<ReturnType<typeof createGroundtruthGame>>;
  try {
    await loadDialogueFonts();
    updateLoader(0.12);
    game = await createGroundtruthGame(canvas, ({ progress }) => {
      updateLoader(0.12 + progress * 0.84);
    });
    updateLoader(1);
    const minimumLoaderDuration = 750;
    const remainingLoaderTime = minimumLoaderDuration - (performance.now() - loaderStartedAt);
    if (remainingLoaderTime > 0) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, remainingLoaderTime));
    }
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    window.clearInterval(preflightMessageTimer);
    loader?.classList.add("is-complete");
  } catch (error) {
    window.clearInterval(preflightMessageTimer);
    loader?.classList.add("is-error");
    updateLoader(1);
    if (loaderStatus) loaderStatus.textContent = "PREFLIGHT INTERRUPTED";
    throw error;
  }

  mountDialogueLab(game.test);
  const isLevel1Proof = new URLSearchParams(location.search).get("scene") === "level1-proof";
  const isLevel2Proof = new URLSearchParams(location.search).get("scene") === "level2-proof";
  const isDev = new URLSearchParams(location.search).get("dev") === "1";
  if (isDev && (isLevel1Proof || isLevel2Proof)) {
    game.test.connect();
    game.test.enterScene();
  }
  if (isDev && isLevel1Proof && game.compositor) {
    mountLevel1CompositorLab(game.compositor);
  }
  if (isDev) {
    window.__groundtruth = {
      app: game.app,
      dialogue: game.dialogue,
      test: game.test,
      compositor: game.compositor,
      level1: game.level1,
      level2: game.level2
    };
    mountLevel1RuntimeLab(game.level1, game.test, game.activeTools);
    mountLevel2RuntimeLab(game.level2, game.test, game.activeTools);
    mountRuntimeTabs(isLevel2Proof ? "2" : "1");
  }

  window.addEventListener("beforeunload", () => game.destroy(), { once: true });
};

void bootstrap();
