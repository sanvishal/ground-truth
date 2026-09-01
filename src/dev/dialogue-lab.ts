import { DEFAULT_DIALOGUE_PRESET, type DialoguePreset, type GroundtruthTestControls, type TextEffect } from "../render/game";

const field = (label: string, options: string[], value: string, onChange: (value: string) => void): HTMLLabelElement => {
  const wrapper = document.createElement("label");
  wrapper.className = "lab-field";
  const title = document.createElement("span");
  title.textContent = label;
  const select = document.createElement("select");
  for (const option of options) {
    const node = document.createElement("option");
    node.value = option;
    node.textContent = option;
    node.selected = option === value;
    select.append(node);
  }
  select.addEventListener("change", () => onChange(select.value));
  wrapper.append(title, select);
  return wrapper;
};

const action = (label: string, onClick: () => void): HTMLButtonElement => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "lab-action";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
};

export function mountDialogueLab(controls: GroundtruthTestControls): void {
  if (new URLSearchParams(location.search).get("dev") !== "1") return;
  const root = document.querySelector<HTMLElement>("#dialogue-lab");
  if (!root) return;
  document.body.classList.add("dev");
  root.hidden = false;

  const heading = document.createElement("div");
  heading.className = "lab-heading";
  const title = document.createElement("h2");
  title.textContent = "DIALOGUE LAB";
  const hint = document.createElement("p");
  hint.textContent = "The game remains visible while these live presets change.";
  heading.append(title, hint);

  const controlsRow = document.createElement("div");
  controlsRow.className = "lab-controls";
  controlsRow.append(
    field("DENSITY", ["HYBRID", "STAR FOX", "UNDERTALE"], DEFAULT_DIALOGUE_PRESET, (value) => controls.setPreset(value as DialoguePreset)),
    field("TYPE SPEED", ["20 CPS", "40 CPS", "70 CPS"], "40 CPS", (value) => controls.setSpeed(Number.parseInt(value, 10))),
    field("TEXT EFFECT", ["NONE", "WAVE", "JITTER"], "NONE", (value) => controls.setEffect(value.toLowerCase() as TextEffect))
  );
  const samples = document.createElement("div");
  samples.className = "lab-samples";
  samples.append(
    action("SHOW ANIMATION", controls.previewAnimation),
    action("LONG KORE", controls.koreLong),
    action("DEMI ECHO", controls.demiLong),
    action("HOVER REACTION", controls.hover),
    action("INTERRUPT", controls.interrupt)
  );
  controlsRow.append(samples);
  root.append(heading, controlsRow);
}
