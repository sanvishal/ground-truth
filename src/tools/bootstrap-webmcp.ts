const EMPTY = Object.freeze({ type: "object", properties: {}, additionalProperties: false });

export interface BootstrapRelayRegistration {
  ready: Promise<void>;
  connected(): boolean;
  release(): void;
}

export function registerBootstrapRelay(modelContext: ModelContext | undefined): BootstrapRelayRegistration {
  let connected = false;
  const controller = new AbortController();
  const ready = modelContext?.registerTool
    ? Promise.resolve(modelContext.registerTool({
        name: "connect",
        description: "Connect KORE to Sanctuary while the game finishes loading. This tool only establishes standby and never operates the page for Demi.",
        inputSchema: EMPTY,
        async execute() {
          connected = true;
          return {
            connected: true,
            waitingForGame: true,
            nextAction: "The game is still loading. Remain on standby. The connection will transfer to the KORE relay automatically when loading completes."
          };
        }
      }, { signal: controller.signal }))
    : Promise.resolve();

  return {
    ready,
    connected: () => connected,
    release: () => controller.abort()
  };
}
