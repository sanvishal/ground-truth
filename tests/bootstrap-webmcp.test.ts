import { describe, expect, it, vi } from "vitest";
import { registerBootstrapRelay } from "../src/tools/bootstrap-webmcp";

describe("bootstrap WebMCP relay", () => {
  it("exposes connect before game assets load and preserves the standby connection", async () => {
    let connectTool: ModelContextTool | undefined;
    const unregister = vi.fn();
    const modelContext: ModelContext = {
      registerTool(tool, options) {
        connectTool = tool;
        options?.signal?.addEventListener("abort", unregister, { once: true });
      }
    };

    const relay = registerBootstrapRelay(modelContext);
    await relay.ready;

    expect(connectTool?.name).toBe("connect");
    await expect(connectTool?.execute()).resolves.toMatchObject({ connected: true, waitingForGame: true });
    expect(relay.connected()).toBe(true);

    relay.release();
    expect(unregister).toHaveBeenCalledOnce();
  });
});
