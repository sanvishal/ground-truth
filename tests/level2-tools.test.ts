import { describe, expect, it } from "vitest";
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
  it("never exposes pressure or thermal state to KORE", async () => {
    const { active, modelContext, dialogue, session } = harness();
    const registration = await registerLevel2Tools(modelContext, dialogue, session, {
      onConnected() {}, onEvent() {}, onWarning() {}, onProcessing() {}
    }, { requireHandshake: true });
    expect([...active.keys()]).toEqual(["connect"]);
    await active.get("connect")?.execute();
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

  it("recalls each solved console trace only after confirmation for two AUX including transmission", async () => {
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
    await expect(active.get("recall_console_code")?.execute({ source: "water", confirmed: false })).rejects.toThrow(/confirm/i);
    expect(session.snapshot().reserve).toBe(reserve);
    const recalled = await active.get("recall_console_code")?.execute({ source: "water", confirmed: true }) as Record<string, unknown>;
    expect(recalled.digits).toBe(waterDigits);
    expect(session.snapshot().reserve).toBe(reserve - 1.5);
    await active.get("transmit")?.execute({ message: `The trace was ${waterDigits}.` });
    expect(session.snapshot().reserve).toBe(reserve - 2);
    await active.get("signal_processing")?.execute();
    const ignitionRecall = await active.get("recall_console_code")?.execute({ source: "ignition", confirmed: true }) as Record<string, unknown>;
    expect(ignitionRecall.digits).toBe(ignitionDigits);
    await active.get("transmit")?.execute({ message: `The trace was ${ignitionDigits}.` });
    expect(session.snapshot().reserve).toBe(reserve - 4);
    registration.dispose();
  });

  it("does not expose console recall until both trace-producing puzzles are complete", async () => {
    const { active, modelContext, dialogue, session } = harness();
    const registration = await registerLevel2Tools(modelContext, dialogue, session, {
      onConnected() {}, onEvent() {}, onWarning() {}, onProcessing() {}
    });
    expect(active.has("recall_console_code")).toBe(false);
    session.dispatch({ type: "DEV_SOLVE_WATER" });
    expect(active.has("recall_console_code")).toBe(false);
    session.dispatch({ type: "DEV_SOLVE_IGNITION" });
    await active.get("signal_processing")?.execute();
    expect(active.has("recall_console_code")).toBe(true);
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
