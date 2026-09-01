export {};

declare global {
  interface ModelContextTool {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    execute(args?: Record<string, unknown>): unknown | Promise<unknown>;
  }

  interface ModelContext {
    registerTool(tool: ModelContextTool, options?: { signal?: AbortSignal }): Promise<void> | void;
  }

  interface Document {
    modelContext?: ModelContext;
  }

  interface Window {
    __groundtruth?: {
      app: unknown;
      dialogue: unknown;
      test: import("../render/game").GroundtruthTestControls;
      compositor?: import("../render/level1-compositor").Level1CompositorProof;
      level1: import("../runtime/level1-session").Level1Session;
      level2: import("../runtime/level2-session").Level2Session;
    };
  }
}
