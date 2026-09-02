import { describe, expect, it, vi } from "vitest";
import { DialogueEngine } from "../src/dialogue/engine";
import { Level1Session } from "../src/runtime/level1-session";
import { registerLevel1Tools } from "../src/tools/webmcp";
import { LEVEL1_WIRES } from "../src/sim/level1";
import { KORE_OPENING_PAGES, KORE_OPENING_RESPONSE } from "../src/content/level1";

describe("Level 1 WebMCP tool gates", () => {
  it("inherits a bootstrap standby connection when the full game tools register", async () => {
    const active = new Map<string, ModelContextTool>();
    const onStandbyConnected = vi.fn();
    const modelContext: ModelContext = {
      registerTool(tool, options) {
        active.set(tool.name, tool);
        options?.signal?.addEventListener("abort", () => active.delete(tool.name), { once: true });
      }
    };
    const dialogue = new DialogueEngine({ maxWidth: 400, maxLines: 3, measure: (text) => text.length * 8 });
    const session = new Level1Session();
    const registration = await registerLevel1Tools(modelContext, dialogue, session, {
      onStandbyConnected,
      onConnected() {}, onEvent() {}, onWarning() {}, onProcessing() {}
    }, { gameplayReady: false, requireHandshake: true, initiallyConnected: true });

    expect(onStandbyConnected).toHaveBeenCalledOnce();
    expect(active.has("connect")).toBe(true);

    registration.dispose();
  });

  it("automatically opens the relay when a standby KORE connection becomes active", async () => {
    const active = new Map<string, ModelContextTool>();
    const modelContext: ModelContext = {
      registerTool(tool, options) {
        active.set(tool.name, tool);
        options?.signal?.addEventListener("abort", () => active.delete(tool.name), { once: true });
      }
    };
    const dialogue = new DialogueEngine({ maxWidth: 400, maxLines: 3, measure: (text) => text.length * 8 });
    const session = new Level1Session();
    const onTransmissionStarted = vi.fn();
    const registration = await registerLevel1Tools(modelContext, dialogue, session, {
      onConnected() {
        session.dispatch({ type: "DEMI_WAKE_RESPONSE", message: "I hear you. Stop!" });
      },
      onTransmissionStarted,
      onEvent() {}, onWarning() {}, onProcessing() {}
    }, { gameplayReady: false });

    await expect(active.get("connect")?.execute()).resolves.toMatchObject({
      connected: true,
      waitingForDemi: true,
      nextAction: expect.stringContaining("do not post any private status message")
    });

    await registration.activateGameplay?.();

    expect(onTransmissionStarted).toHaveBeenCalledOnce();
    expect(session.snapshot().foundation.openingResponseRelayed).toBe(true);
    expect(dialogue.snapshot().channels.KORE.current?.body).toBe(KORE_OPENING_RESPONSE);

    registration.dispose();
  });

  it("renders the authored KORE opening as short pages even when the agent paraphrases it", async () => {
    const active = new Map<string, ModelContextTool>();
    const modelContext: ModelContext = {
      registerTool(tool, options) {
        active.set(tool.name, tool);
        options?.signal?.addEventListener("abort", () => active.delete(tool.name), { once: true });
      }
    };
    const dialogue = new DialogueEngine({ maxWidth: 1000, maxLines: 8, measure: (text) => text.length });
    const session = new Level1Session();
    const registration = await registerLevel1Tools(modelContext, dialogue, session, {
      onConnected() {}, onEvent() {}, onWarning() {}, onProcessing() {}
    });

    await active.get("connect")?.execute();
    session.dispatch({ type: "DEMI_WAKE_RESPONSE", message: "I hear you. Stop!" });
    await active.get("transmit")?.execute({ message: "Demi. I hear you." });

    const opening = dialogue.snapshot().channels.KORE.current;
    expect(opening?.body).toBe(KORE_OPENING_RESPONSE);
    expect(opening?.pages).toEqual([...KORE_OPENING_PAGES]);
    expect(opening?.pages[0]).toMatch(/^Bzzzzt/);
    registration.dispose();
  });

  it("directs the player through the continuity sequencer without adding a metered tool", async () => {
    const active = new Map<string, ModelContextTool>();
    const modelContext: ModelContext = {
      registerTool(tool, options) {
        active.set(tool.name, tool);
        options?.signal?.addEventListener("abort", () => active.delete(tool.name), { once: true });
      }
    };
    const dialogue = new DialogueEngine({ maxWidth: 400, maxLines: 3, measure: (text) => text.length * 8 });
    const session = new Level1Session();
    const registration = await registerLevel1Tools(modelContext, dialogue, session, {
      onConnected() {},
      onEvent() {},
      onWarning() {},
      onProcessing() {}
    });

    expect([...active.keys()]).toEqual(["connect"]);
    await active.get("connect")?.execute();
    expect([...active.keys()].sort()).toEqual(["read_manual", "self_report", "signal_processing", "transmit"]);

    session.dispatch({ type: "DEMI_WAKE_RESPONSE", message: "KORE... stop. I hear you." });
    session.dispatch({ type: "RELAY_OPENING_RESPONSE" });
    session.dispatch({ type: "RUN_DIAGNOSTICS" });
    await expect(active.get("signal_processing")?.execute()).resolves.toMatchObject({
      nextAction: expect.stringContaining("CONTINUITY SEQUENCER")
    });
    const calibrationOrder = session.snapshot().wires.calibrationOrder.join(", ");
    await expect(active.get("signal_processing")?.execute()).resolves.toMatchObject({
      nextAction: expect.stringContaining(calibrationOrder)
    });
    expect(active.has("continuity_ping")).toBe(false);

    session.dispatch({ type: "COMPLETE_CONTINUITY_SEQUENCE" });
    await expect(active.get("signal_processing")?.execute()).resolves.toMatchObject({
      nextAction: expect.stringContaining("All terminals are measured")
    });
    expect(active.has("continuity_ping")).toBe(false);

    registration.dispose();
  });

  it("signals visible processing and permits only one metered action per player message", async () => {
    const active = new Map<string, ModelContextTool>();
    const processing: boolean[] = [];
    const modelContext: ModelContext = {
      registerTool(tool, options) {
        active.set(tool.name, tool);
        options?.signal?.addEventListener("abort", () => active.delete(tool.name), { once: true });
      }
    };
    const dialogue = new DialogueEngine({ maxWidth: 400, maxLines: 3, measure: (text) => text.length * 8 });
    const session = new Level1Session();
    const registration = await registerLevel1Tools(modelContext, dialogue, session, {
      onConnected() {},
      onEvent() {},
      onWarning() {},
      onProcessing(active) { processing.push(active); }
    });

    await active.get("connect")?.execute();
    session.dispatch({ type: "DEMI_WAKE_RESPONSE", message: "I hear you." });
    session.dispatch({ type: "RELAY_OPENING_RESPONSE" });
    await expect(active.get("signal_processing")?.execute()).resolves.toMatchObject({
      nextAction: expect.stringContaining("only if her latest response explicitly agrees")
    });
    const report = await active.get("self_report")?.execute() as Record<string, unknown>;
    expect(report.nextAction).toEqual(expect.stringContaining("Call transmit now"));
    expect(report.nextAction).toEqual(expect.stringContaining("Stop there"));
    expect(String(report.nextAction)).not.toMatch(/physically inspect|use it as a constraint/i);
    await expect(active.get("read_manual")?.execute({ topic: "bus_loom" })).rejects.toThrow("Only one metered");
    await active.get("transmit")?.execute({ message: "Hold there." });

    expect(processing).toEqual([true, false]);
    registration.dispose();
  });

  it("directs KORE to listen immediately after the mic is reseated", async () => {
    const active = new Map<string, ModelContextTool>();
    const modelContext: ModelContext = {
      registerTool(tool, options) {
        active.set(tool.name, tool);
        options?.signal?.addEventListener("abort", () => active.delete(tool.name), { once: true });
      }
    };
    const dialogue = new DialogueEngine({ maxWidth: 400, maxLines: 3, measure: (text) => text.length * 8 });
    const session = new Level1Session();
    const registration = await registerLevel1Tools(modelContext, dialogue, session, {
      onConnected() {},
      onEvent() {},
      onWarning() {},
      onProcessing() {}
    });

    await active.get("connect")?.execute();
    session.dispatch({ type: "DEMI_WAKE_RESPONSE", message: "I hear you." });
    session.dispatch({ type: "RELAY_OPENING_RESPONSE" });
    session.dispatch({ type: "RUN_DIAGNOSTICS" });
    session.dispatch({ type: "COMPLETE_CONTINUITY_SEQUENCE" });
    for (const wire of LEVEL1_WIRES) session.dispatch({ type: "CONNECT_WIRE", wire: wire.id, port: wire.target });
    session.dispatch({ type: "RESEAT_MIC" });

    await expect(active.get("signal_processing")?.execute()).resolves.toMatchObject({
      nextAction: expect.stringContaining("Call listen now")
    });

    session.dispatch({ type: "LISTEN" });
    await expect(active.get("signal_processing")?.execute()).resolves.toMatchObject({
      nextAction: expect.stringContaining("JUNCTION ROUTER")
    });
    expect(active.has("refine")).toBe(false);
    session.dispatch({ type: "SET_JUNCTION", route: "rough" });
    await Promise.resolve();
    await Promise.resolve();
    expect(active.has("read_bus")).toBe(false);
    expect(active.has("refine")).toBe(false);
    await expect(active.get("signal_processing")?.execute()).resolves.toMatchObject({
      nextAction: expect.stringContaining("HARMONIC REGULATOR")
    });
    session.dispatch({ type: "SET_REGULATOR", tune: "rough" });
    await vi.waitFor(() => expect(active.has("read_bus")).toBe(true));
    await vi.waitFor(() => expect(active.has("refine")).toBe(true));
    session.dispatch({ type: "REFINE" });
    await expect(active.get("signal_processing")?.execute()).resolves.toMatchObject({
      nextAction: expect.stringContaining("Call read_bus now")
    });
    session.dispatch({ type: "READ_BUS" });
    await expect(active.get("signal_processing")?.execute()).resolves.toMatchObject({
      nextAction: expect.stringContaining("breaker bank")
    });
    session.dispatch({ type: "PULL_BREAKER_4" });
    await expect(active.get("signal_processing")?.execute()).resolves.toMatchObject({
      nextAction: expect.stringContaining("JUNCTION ROUTER")
    });
    session.dispatch({ type: "SET_JUNCTION", route: "clean" });
    await expect(active.get("signal_processing")?.execute()).resolves.toMatchObject({
      nextAction: expect.stringContaining("changed the load")
    });
    await expect(active.get("refine")?.execute()).resolves.toMatchObject({
      constraint: expect.stringContaining("Do not call refine again")
    });
    await vi.waitFor(() => expect(active.has("refine")).toBe(false));
    await expect(active.get("signal_processing")?.execute()).resolves.toMatchObject({
      nextAction: expect.stringContaining("Do not call refine again")
    });
    registration.dispose();
  });
});
