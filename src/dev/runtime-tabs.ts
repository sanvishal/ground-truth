export function mountRuntimeTabs(defaultLevel: "1" | "2"): void {
  const root = document.querySelector<HTMLElement>("#dialogue-lab");
  if (!root) return;
  const labs = [...root.querySelectorAll<HTMLElement>(".runtime-lab[data-level]")];
  if (labs.length < 2) return;
  const tabs = document.createElement("nav");
  tabs.className = "runtime-tabs";
  tabs.setAttribute("aria-label", "Runtime devtools");
  const select = (level: string) => {
    for (const lab of labs) lab.hidden = lab.dataset.level !== level;
    for (const button of tabs.querySelectorAll<HTMLButtonElement>("button")) button.dataset.active = String(button.dataset.level === level);
  };
  for (const level of ["1", "2"] as const) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.level = level;
    button.textContent = `LEVEL ${level}`;
    button.addEventListener("click", () => select(level));
    tabs.append(button);
  }
  root.prepend(tabs);
  select(defaultLevel);
  window.addEventListener("groundtruth:levelchange", (event) => {
    const level = (event as CustomEvent<{ level?: string }>).detail?.level;
    if (level === "1" || level === "2") select(level);
  });
}
