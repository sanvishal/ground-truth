import type { Level2Session } from "../runtime/level2-session";
import { BALLAST_RATES, getLaunchCode, getThermalMismatchCount, THERMAL_FEED_IDS, type Level2Action, type Level2State } from "../sim/level2";

const button = (label: string, action: () => void, tone = "normal"): HTMLButtonElement => {
  const node = document.createElement("button");
  node.type = "button";
  node.className = "runtime-action";
  node.dataset.tone = tone;
  node.textContent = label;
  node.addEventListener("click", action);
  return node;
};

const group = (label: string, actions: HTMLButtonElement[]): HTMLElement => {
  const section = document.createElement("section");
  section.className = "runtime-group";
  const heading = document.createElement("h3");
  heading.textContent = label;
  const controls = document.createElement("div");
  controls.className = "runtime-group__actions";
  controls.append(...actions);
  section.append(heading, controls);
  return section;
};

export function mountLevel2RuntimeLab(session: Level2Session, activeTools: () => string[]): void {
  if (new URLSearchParams(location.search).get("dev") !== "1") return;
  const root = document.querySelector<HTMLElement>("#dialogue-lab");
  if (!root) return;

  document.body.classList.add("dev");
  root.hidden = false;
  const shell = document.createElement("section");
  shell.className = "runtime-lab";
  shell.dataset.level = "2";
  const header = document.createElement("div");
  header.className = "runtime-lab__header";
  const copy = document.createElement("div");
  const title = document.createElement("h2");
  title.textContent = "LEVEL 2 RUNTIME";
  const note = document.createElement("p");
  note.textContent = "Environment → water → ignition → pod. A known code may be entered immediately.";
  copy.append(title, note);
  const stateLine = document.createElement("output");
  stateLine.className = "runtime-state";
  header.append(copy, stateLine);

  const dispatch = (action: Level2Action) => session.dispatch(action);
  const enterCode = () => {
    for (const digit of getLaunchCode(session.snapshot())) dispatch({ type: "POD_DIGIT", digit });
  };
  const controlGrid = document.createElement("div");
  controlGrid.className = "runtime-grid";
  controlGrid.append(
    group("ENVIRONMENT", [
      button("STABILIZE", () => dispatch({ type: "DEV_STABILIZE" })),
      button("BLEED PRESSURE", () => dispatch({ type: "CRANK_PRESSURE", amount: -10 })),
      button("REMAP THERMAL", () => dispatch({ type: "DEV_REMAP_THERMAL" })),
      button("MATCH THERMAL", () => dispatch({ type: "DEV_MATCH_THERMAL" })),
      button("SIMULATE 60S", () => dispatch({ type: "TICK", deltaMs: 60_000 }))
    ]),
    group("WATER", [button("SOLVE CERTIFIED ROUTE", () => dispatch({ type: "DEV_SOLVE_WATER" }))]),
    group("IGNITION", [
      ...BALLAST_RATES.map((rate) => button(rate.toUpperCase(), () => dispatch({ type: "SET_BALLAST_RATE", rate }))),
      button("START", () => dispatch({ type: "START_IGNITION", pullSpeed: 900 })),
      button("WIDEN WINDOW", () => dispatch({ type: "ENABLE_IGNITION_ASSIST" })),
      button("SOLVE", () => dispatch({ type: "DEV_SOLVE_IGNITION" }))
    ]),
    group("POD", [
      button("ENTER CODE", enterCode),
      button("SUBMIT CODE", () => dispatch({ type: "SUBMIT_POD_CODE" })),
      button("OPEN POD", () => dispatch({ type: "DEV_OPEN_POD" })),
      button("RESET RUN", () => session.reset(), "quiet")
    ])
  );
  const trace = document.createElement("pre");
  trace.className = "runtime-trace";
  const render = (state: Level2State) => {
    stateLine.textContent = [
      `PHASE ${state.phase.toUpperCase()}`,
      `AUX ${state.reserve.toFixed(1)}`,
      `PRESS ${state.pressure.toFixed(1)}`,
      `TEMP ${state.temperature.toFixed(1)}`,
      `PLANT ${state.plant.health}`,
      `TOOLS ${activeTools().join(", ") || "none"}`
    ].join("  ·  ");
    trace.textContent = [
      `THERMAL   MISMATCH ${getThermalMismatchCount(state)}  ${state.thermal.waitingForGreen ? "WAITING FOR GREEN" : `NEXT ${Math.ceil(state.thermal.swapCountdownMs / 1000)}s`}  ${THERMAL_FEED_IDS.map((feed) => `${feed}:${state.thermal.connections[feed] ?? "HANGING"}`).join("  ")}`,
      `WATER     ${state.water.solved ? "CERTIFIED" : state.water.invalidOrder ? "FLOW / NOT CERTIFIED" : state.water.rotations.join("")}  LIVE ORDER ${state.water.requiredOrder.join(">")}  CODE ${state.water.digits}`,
      `IGNITION  ${state.ignition.rate.toUpperCase()}  KEYS ${state.ignition.keys.join(" ")}  CHARGE ${state.ignition.charge.toFixed(1)}  ${state.ignition.running ? "RUNNING" : "IDLE"}  ${state.ignition.assist ? "WIDE" : "STANDARD"}  ${state.ignition.solved ? `CODE ${state.ignition.digits}` : ""}`,
      `POD       ${state.pod.input || "------"}`,
      `FULL CODE ${getLaunchCode(state)}`,
      "",
      ...state.history.slice(-10).reverse()
    ].join("\n");
  };
  const unsubscribe = session.subscribe((transition) => render(transition.state));
  const timer = window.setInterval(() => render(session.snapshot()), 300);
  window.addEventListener("beforeunload", () => { window.clearInterval(timer); unsubscribe(); }, { once: true });
  shell.append(header, controlGrid, trace);
  root.prepend(shell);
  render(session.snapshot());
}
