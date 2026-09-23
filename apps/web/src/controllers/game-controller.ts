import {
  applyAction,
  type CardSource,
  type GameAction,
  type GameState,
  type PlayerGameView,
  type RandomSource,
  type Suit,
} from "@vedras/game-core";

export interface GameControllerSnapshot {
  readonly view?: GameState | PlayerGameView;
  readonly revision: number;
  readonly connectionStatus?: "CONNECTING" | "CONNECTED" | "RECONNECTING" | "DISCONNECTED" | "INVALID_SESSION" | "ROOM_NOT_FOUND" | "SESSION_REPLACED" | "PLAYER_REMOVED";
  readonly connectionMessage?: string;
}

export interface GameController {
  getSnapshot(): GameControllerSnapshot;
  dispatch(action: GameAction): Promise<void>;
  subscribe(listener: (snapshot: GameControllerSnapshot) => void): () => void;
  dispose(): void;
  /** Available only to the local controller; remote views are already redacted. */
  getLocalSecretFaction?(playerId: string): Suit | undefined;
}

export interface LocalGameControllerOptions {
  readonly randomSource: RandomSource;
  readonly cardSource: CardSource;
  readonly timestamp: (state: GameState) => string;
}

/** Local debug controller. Its complete state never leaves this browser. */
export class LocalGameController implements GameController {
  private state: GameState;
  private revision = 0;
  private readonly listeners = new Set<(snapshot: GameControllerSnapshot) => void>();

  constructor(initialState: GameState, private readonly options: LocalGameControllerOptions) {
    this.state = initialState;
  }

  getSnapshot(): GameControllerSnapshot {
    return { view: this.state, revision: this.revision };
  }

  async dispatch(action: GameAction): Promise<void> {
    const result = applyAction(this.state, action, {
      randomSource: this.options.randomSource,
      cardSource: this.options.cardSource,
      timestamp: this.options.timestamp(this.state),
    });
    this.state = result.state;
    this.revision += 1;
    this.emit();
  }

  subscribe(listener: (snapshot: GameControllerSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    this.listeners.clear();
  }

  getLocalSecretFaction(playerId: string): Suit | undefined {
    return this.state.players.find((player) => player.id === playerId)?.secretFactionSuit;
  }

  private emit(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}
