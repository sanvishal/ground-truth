import { applyLevel2Action, createInitialLevel2State, type Level2Action, type Level2State, type Level2Transition } from "../sim/level2";

export type Level2SessionListener = (transition: Level2Transition, previous: Level2State) => void;

export class Level2Session {
  private state: Level2State;
  private readonly listeners = new Set<Level2SessionListener>();

  constructor(initialState: Level2State = createInitialLevel2State()) {
    this.state = initialState;
  }

  snapshot(): Level2State {
    return this.state;
  }

  dispatch(action: Level2Action): Level2Transition {
    const previous = this.state;
    const transition = applyLevel2Action(previous, action);
    if (transition.ok) this.state = transition.state;
    for (const listener of this.listeners) listener(transition, previous);
    return transition;
  }

  subscribe(listener: Level2SessionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  reset(): Level2Transition {
    return this.dispatch({ type: "RESET_RUN" });
  }
}
