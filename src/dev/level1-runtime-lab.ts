import type { Level1Session } from "../runtime/level1-session";
import {
  getBreakerRestoreOrder,
  getJunctionFaultGlyph,
  getJunctionFingerprint,
  getRegulatorSignal,
  LEVEL1_WIRES,
  REGULATOR_PRECISE_TARGET,
  type Level1Action,
  type Level1State
} from "../sim/level1";
import type { GroundtruthTestControls } from "../render/game";

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

export function mountLevel1RuntimeLab(
  session: Level1Session,
  controls: GroundtruthTestControls,
  activeTools: () => string[]
): void {
  if (new URLSearchParams(location.search).get("dev") !== "1") return;
  const root = document.querySelector<HTMLElement>("#dialogue-lab");
  if (!root) return;

  document.body.classList.add("dev");
  root.hidden = false;

  const shell = document.createElement("section");
  shell.className = "runtime-lab";
  shell.dataset.level = "1";
  const header = document.createElement("div");
  header.className = "runtime-lab__header";
  const copy = document.createElement("div");
  const title = document.createElement("h2");
  title.textContent = "LEVEL 1 RUNTIME";
  const note = document.createElement("p");
  note.textContent = "Foundation → wires → spiral → door. Trust beat intentionally skipped.";
  copy.append(title, note);
  const stateLine = document.createElement("output");
  stateLine.className = "runtime-state";
  header.append(copy, stateLine);

  const dispatch = (action: Level1Action) => session.dispatch(action);
  const ensureFoundation = () => {
    if (!session.snapshot().foundation.connected) dispatch({ type: "CONNECT" });
    if (!session.snapshot().foundation.wakeResponseHeard) dispatch({ type: "DEMI_WAKE_RESPONSE", message: "Dev calibration response." });
    if (!session.snapshot().foundation.openingResponseRelayed) dispatch({ type: "RELAY_OPENING_RESPONSE", heardMessage: "Dev calibration response." });
    if (!session.snapshot().foundation.diagnosticsRun) dispatch({ type: "RUN_DIAGNOSTICS" });
  };
  const solveWires = () => {
    ensureFoundation();
    if (session.snapshot().wires.measuredPorts.length < 5) dispatch({ type: "COMPLETE_CONTINUITY_SEQUENCE" });
    const targets = session.snapshot().wires.targets;
    for (const wire of LEVEL1_WIRES) {
      if (session.snapshot().wires.connections[wire.id] !== targets[wire.id]) {
        dispatch({ type: "CONNECT_WIRE", wire: wire.id, port: targets[wire.id] });
      }
    }
  };
  const setRegulator = (target: readonly number[]) => target.forEach((value, index) => dispatch({ type: "SET_REGULATOR_SLIDER", index, value }));
  const ensureBreakerInputs = () => {
    if (session.snapshot().phase === "failure" || session.snapshot().phase === "complete") session.reset();
    if (!session.snapshot().wires.solved) solveWires();
    if (!session.snapshot().spiral.micReseated) dispatch({ type: "RESEAT_MIC" });
    if (!session.snapshot().spiral.listened) dispatch({ type: "LISTEN" });
    if (!session.snapshot().junctionPuzzle.decoded) {
      dispatch({ type: "SELECT_JUNCTION_GLYPH", glyph: getJunctionFaultGlyph(session.snapshot()) });
    }
    if (!session.snapshot().spiral.busRead) dispatch({ type: "READ_BUS" });
  };
  const solveBreakerBank = () => {
    ensureBreakerInputs();
    checkBreakerHousings();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const state = session.snapshot();
      const order = getBreakerRestoreOrder(state);
      if (state.breakerPuzzle.orderProgress >= order.length) break;
      const next = order[state.breakerPuzzle.orderProgress];
      if (typeof next !== "number") break;
      const transition = dispatch({ type: "TOGGLE_BREAKER", index: next });
      if (!transition.ok) break;
    }
    const ready = session.snapshot();
    if (!ready.spiral.breaker4Pulled) dispatch({ type: "PULL_BREAKER", index: ready.breakerPuzzle.faultIndex });
  };
  const checkBreakerHousings = () => {
    ensureBreakerInputs();
    for (let index = 0; index < session.snapshot().breakerPuzzle.positions.length; index += 1) {
      if (!session.snapshot().breakerPuzzle.touched[index]) dispatch({ type: "TOUCH_BREAKER", index });
    }
  };
  const readyRegulator = () => {
    if (session.snapshot().spiral.regulator === "precise") session.reset();
    solveBreakerBank();
  };

  const controlGrid = document.createElement("div");
  controlGrid.className = "runtime-grid";
  controlGrid.append(
    group("FOUNDATION", [
      button("CONNECT", controls.connect),
      button("KORE RESPONSE", controls.foundationIntro),
      button("DIAGNOSTICS", () => dispatch({ type: "RUN_DIAGNOSTICS" }))
    ]),
    group("WIRE RESTORE", [
      button("RUN SEQUENCER", () => dispatch({ type: "COMPLETE_CONTINUITY_SEQUENCE" })),
      button("SOLVE LOOM", solveWires)
    ]),
    group("SPIRAL", [
      button("RESEAT MIC", () => dispatch({ type: "RESEAT_MIC" })),
      button("LISTEN", () => dispatch({ type: "LISTEN" })),
      button("READ BUS", () => dispatch({ type: "READ_BUS" })),
      button("CHECK HOUSINGS", checkBreakerHousings),
      button("SOLVE BREAKERS", solveBreakerBank),
      button("READY REGULATOR", readyRegulator),
      button("CHECK HARMONICS", () => {
        const checked = dispatch({ type: "CHECK_HARMONICS" });
        if (checked.ok && getRegulatorSignal(session.snapshot()).candidate) dispatch({ type: "REFINE" });
      }),
      button("RESET FAULT (FAIL)", () => dispatch({ type: "RESET_BREAKER_4" }), "danger"),
      button("PRECISE TUNE", () => setRegulator(REGULATOR_PRECISE_TARGET))
    ]),
    group("DOOR", [
      button("DIVERT POWER", () => dispatch({ type: "DIVERT_DOOR" })),
      button("COMMIT CLEAR", () => dispatch({ type: "COMMIT_DOOR" })),
      button("RESET RUN", () => session.reset(), "quiet")
    ]),
    group("SCENE FX", [
      button("SHAKE SCREEN", controls.triggerImpact),
      button("COLD OPEN", controls.triggerColdOpen)
    ])
  );

  const trace = document.createElement("pre");
  trace.className = "runtime-trace";

  const render = (state: Level1State) => {
    const tools = activeTools();
    stateLine.textContent = [
      `PHASE ${state.phase.toUpperCase()}`,
      `AUX ${state.reserve.toFixed(1)}`,
      `LIGHT ${state.lightingStage}`,
      `TOOLS ${tools.length ? tools.join(", ") : "none"}`
    ].join("  ·  ");
    const puzzleState = [
      `LOOM TESTED  ${state.wires.measuredPorts.join(",") || "none"}`,
      `JUNCTION     ${state.spiral.listened ? `${getJunctionFingerprint(state)} fault on ${getJunctionFaultGlyph(state)}` : "no carrier"}  ${state.junctionPuzzle.decoded ? "ISOLATED" : "LIVE"}  ${state.spiral.junction}`,
      `REGULATOR    ${state.spiral.regulator}  [${state.regulatorPuzzle.sliders.join(",")}]`,
      `BREAKERS     ${state.breakerPuzzle.glyphs.map((glyph, index) => `${glyph}:${state.breakerPuzzle.positions[index]}`).join(",")}  ORDER ${state.breakerPuzzle.orderProgress}/3`,
      "",
      ...state.history.slice(-10).reverse().map((item) => `${String(item.sequence).padStart(2, "0")}  ${item.code}`)
    ];
    trace.textContent = puzzleState.join("\n");
  };

  const unsubscribe = session.subscribe((transition) => render(transition.state));
  const toolRefresh = window.setInterval(() => render(session.snapshot()), 250);
  window.addEventListener("beforeunload", () => {
    window.clearInterval(toolRefresh);
    unsubscribe();
  }, { once: true });
  shell.append(header, controlGrid, trace);
  root.prepend(shell);
  render(session.snapshot());
}
