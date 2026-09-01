import {
  applyLevel1Action,
  createInitialLevel1State,
  type Level1Action,
  type Level1State,
  type Level1Transition
} from "../sim/level1";

export type Level1SessionListener = (transition: Level1Transition, previous: Level1State) => void;

export class Level1Session {
  private state: Level1State;
  private readonly listeners = new Set<Level1SessionListener>();

  constructor(initialState: Level1State = createInitialLevel1State()) {
    this.state = initialState;
  }

  snapshot(): Level1State {
    return this.state;
  }

  dispatch(action: Level1Action): Level1Transition {
    const previous = this.state;
    const transition = applyLevel1Action(previous, action);
    if (transition.ok) this.state = transition.state;
    for (const listener of this.listeners) listener(transition, previous);
    return transition;
  }

  spend(amount: number, reason: string): Level1Transition {
    return this.dispatch({ type: "SPEND_RESERVE", amount, reason });
  }

  subscribe(listener: Level1SessionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  reset(): Level1Transition {
    return this.dispatch({ type: "RESET_RUN" });
  }
}
