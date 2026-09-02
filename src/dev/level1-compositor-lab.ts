import {
  LEVEL1_LIGHTING_STAGES,
  type Level1CompositorProof,
  type Level1LightingStage
} from "../render/level1-compositor";

export function mountLevel1CompositorLab(proof: Level1CompositorProof): void {
  if (new URLSearchParams(location.search).get("dev") !== "1") return;
  if (new URLSearchParams(location.search).get("scene") !== "level1-proof") return;
  const root = document.querySelector<HTMLElement>("#dialogue-lab");
  if (!root) return;

  document.body.classList.add("dev");
  root.hidden = false;

  const section = document.createElement("section");
  section.className = "compositor-lab";
  const copy = document.createElement("div");
  copy.className = "compositor-lab__copy";
  const title = document.createElement("h2");
  title.textContent = "LEVEL 1 COMPOSITOR";
  const detail = document.createElement("p");
  const beaconPosition = proof.getBeaconPosition();
  detail.textContent = `960×420 · scrolling stars + asteroid fly-bys · restrained foreground parallax · BEACON ${Math.round(beaconPosition.x)},${Math.round(beaconPosition.y)}`;
  copy.append(title, detail);

  const controls = document.createElement("div");
  controls.className = "compositor-lab__stages";
  const buttons = new Map<Level1LightingStage, HTMLButtonElement>();
  const render = () => {
    const current = proof.getStage();
    for (const [id, button] of buttons) button.dataset.active = String(id === current);
  };
  for (const item of LEVEL1_LIGHTING_STAGES) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "compositor-stage";
    button.textContent = `${item.id}  ${item.label}`;
    button.addEventListener("click", () => { proof.setStage(item.id); render(); });
    buttons.set(item.id, button);
    controls.append(button);
  }

  section.append(copy, controls);
  root.prepend(section);
  render();

  const onKeyDown = (event: KeyboardEvent) => {
    const stage = Number(event.key) as Level1LightingStage;
    if (stage >= 1 && stage <= 5) {
      proof.setStage(stage);
      render();
    }
  };
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("groundtruth:levelchange", (event) => {
    if ((event as CustomEvent<{ level?: string }>).detail?.level !== "2") return;
    window.removeEventListener("keydown", onKeyDown);
    section.remove();
  }, { once: true });
}
