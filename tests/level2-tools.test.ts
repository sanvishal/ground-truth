import { describe, expect, it, vi } from "vitest";
import { DialogueEngine } from "../src/dialogue/engine";
import { Level2Session } from "../src/runtime/level2-session";
import { registerLevel2Tools } from "../src/tools/webmcp-level2";

function harness() {
  const active = new Map<string, ModelContextTool>();
  const modelContext: ModelContext = {
    registerTool(tool, options) {
      active.set(tool.name, tool);
      options?.signal?.addEventListener("abort", () => active.delete(tool.name), { once: true });
    }
  };
  const dialogue = new DialogueEngine({ maxWidth: 400, maxLines: 3, measure: (text) => text.length * 8 });
  const session = new Level2Session();
  return { active, modelContext, dialogue, session };
}

describe("Level 2 WebMCP boundaries", () => {
  it("inherits a bootstrap connection when the Level 2 tools register", async () => {
    const { active, modelContext, dialogue, session } = harness();
    const onConnected = vi.fn();
    const registration = await registerLevel2Tools(modelContext, dialogue, session, {
      onConnected, onEvent() {}, onWarning() {}, onProcessing() {}
    }, { requireHandshake: true, initiallyConnected: true });

    expect(onConnected).toHaveBeenCalledOnce();
    expect(active.has("connect")).toBe(false);
    expect(active.has("signal_processing")).toBe(true);
    registration.dispose();
  });

  it("never exposes pressure or thermal state to KORE", async () => {
    const { active, modelContext, dialogue, session } = harness();
    const registration = await registerLevel2Tools(modelContext, dialogue, session, {
      onConnected() {}, onEvent() {}, onWarning() {}, onProcessing() {}
    }, { requireHandshake: true });
    expect([...active.keys()]).toEqual(["connect"]);
    const connectionBrief = await active.get("connect")?.execute();
    expect(JSON.stringify(connectionBrief)).not.toMatch(/water|ignition|timing line/i);
    expect([...active.keys()]).not.toContain("pressure");
    expect([...active.keys()]).not.toContain("temperature");
    const report = await active.get("self_report")?.execute() as Record<string, unknown>;
    expect(report.pressure).toMatch(/unavailable/);
    expect(report).not.toHaveProperty("temperature");
    expect(JSON.stringify(report)).not.toMatch(/temperature|thermal/i);
    registration.dispose();
  });

  it("replaces lamp sensing with KORE-controlled ballast and explicit timing assist", async () => {
    const { active, modelContext, dialogue, session } = harness();
    const registration = await registerLevel2Tools(modelContext, dialogue, session, {
      onConnected() {}, onEvent() {}, onWarning() {}, onProcessing() {}
    });
    expect(active.has("spectrometer")).toBe(false);
    expect(active.has("set_ballast_drive")).toBe(true);
    expect(active.has("widen_strike_window")).toBe(true);
    expect(session.snapshot().ignition.assist).toBe(false);
    await active.get("widen_strike_window")?.execute();
    expect(session.snapshot().ignition.assist).toBe(true);
    registration.dispose();
  });

  it("charges one AUX for each upward ballast step and lowers for free", async () => {
    const { active, modelContext, dialogue, session } = harness();
    const registration = await registerLevel2Tools(modelContext, dialogue, session, {
      onConnected() {}, onEvent() {}, onWarning() {}, onProcessing() {}
    });
    await active.get("set_ballast_drive")?.execute({ rate: "elevated" });
    expect(session.snapshot().reserve).toBe(9.5);
    await active.get("set_ballast_drive")?.execute({ rate: "high" });
    expect(session.snapshot().reserve).toBe(8.5);
    await active.get("set_ballast_drive")?.execute({ rate: "nominal" });
    expect(session.snapshot().reserve).toBe(8.5);
    registration.dispose();
  });

  it("searches ship logs for both three-digit entries only after confirmation", async () => {
    const { active, modelContext, dialogue, session } = harness();
    session.dispatch({ type: "DEV_SOLVE_WATER" });
    session.dispatch({ type: "DEV_SOLVE_IGNITION" });
    const registration = await registerLevel2Tools(modelContext, dialogue, session, {
      onConnected() {}, onEvent() {}, onWarning() {}, onProcessing() {}
    });
    const waterDigits = session.snapshot().water.digits;
    const ignitionDigits = session.snapshot().ignition.digits;
    const reserve = session.snapshot().reserve;
    const processing = await active.get("signal_processing")?.execute() as Record<string, unknown>;
    expect(JSON.stringify(processing)).not.toContain(waterDigits);
    expect(JSON.stringify(processing)).not.toContain(ignitionDigits);
    await expect(active.get("search_ship_logs")?.execute({ confirmed: false })).rejects.toThrow(/confirm/i);
    expect(session.snapshot().reserve).toBe(reserve);
    const search = await active.get("search_ship_logs")?.execute({ confirmed: true }) as Record<string, unknown>;
    expect(search.codes).toEqual([waterDigits, ignitionDigits]);
    expect(JSON.stringify(search)).not.toMatch(/water|ignition/i);
    expect(session.snapshot().reserve).toBe(reserve - 1.5);
    await active.get("transmit")?.execute({ message: `The log entries were ${waterDigits} and ${ignitionDigits}.` });
    expect(session.snapshot().reserve).toBe(reserve - 2);
    registration.dispose();
  });

  it("does not expose ship-log search until both three-digit entries exist", async () => {
    const { active, modelContext, dialogue, session } = harness();
    const registration = await registerLevel2Tools(modelContext, dialogue, session, {
      onConnected() {}, onEvent() {}, onWarning() {}, onProcessing() {}
    });
    expect(active.has("search_ship_logs")).toBe(false);
    session.dispatch({ type: "DEV_SOLVE_WATER" });
    expect(active.has("search_ship_logs")).toBe(false);
    session.dispatch({ type: "DEV_SOLVE_IGNITION" });
    await active.get("signal_processing")?.execute();
    expect(active.has("search_ship_logs")).toBe(true);
    registration.dispose();
  });

  it("keeps audible transmission available when environmental drain exhausted AUX", async () => {
    const { active, modelContext, dialogue, session } = harness();
    session.dispatch({ type: "SPEND_RESERVE", amount: session.snapshot().reserve, reason: "test drain" });
    const warnings: string[] = [];
    const registration = await registerLevel2Tools(modelContext, dialogue, session, {
      onConnected() {}, onEvent() {}, onWarning(message) { warnings.push(message); }, onProcessing() {}
    });
    const result = await active.get("transmit")?.execute({ message: "Relay carrier restored." }) as Record<string, unknown>;
    expect(result.delivered).toBe(true);
    expect(result.emergencyCarrier).toBe(true);
    expect(session.snapshot().reserve).toBe(0);
    expect(warnings.join(" ")).toMatch(/emergency relay/i);
    registration.dispose();
  });
});
