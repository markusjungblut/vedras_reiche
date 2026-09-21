import type { GameAction, PlayerGameView } from "@vedras/game-core";
import {
  PROTOCOL_VERSION,
  type CommandAcceptedMessage,
  type GameActionDto,
  type PublicRoomState,
  type ServerMessage,
} from "@vedras/protocol";
import type { GameController, GameControllerSnapshot } from "./game-controller";

export interface MultiplayerCredentials {
  readonly roomId: string;
  readonly playerId: string;
  readonly sessionToken: string;
}

export interface RemoteGameControllerSnapshot extends GameControllerSnapshot {
  readonly room?: PublicRoomState;
}

interface PendingCommand {
  readonly resolve: () => void;
  readonly reject: (reason: Error) => void;
}

/** Browser transport for authoritative rooms. It stores only the player-specific view. */
export class RemoteGameController implements GameController {
  private socket: WebSocket | undefined;
  private room: PublicRoomState | undefined;
  private view: PlayerGameView | undefined;
  private revision = 0;
  private connected = false;
  private disposed = false;
  private readonly listeners = new Set<(snapshot: RemoteGameControllerSnapshot) => void>();
  private readonly pending = new Map<string, PendingCommand>();
  private connectPromise?: Promise<void>;
  private resolveConnected: (() => void) | undefined;
  private rejectConnected: ((reason: Error) => void) | undefined;
  private sequence = 0;

  constructor(readonly credentials: MultiplayerCredentials, private readonly endpoint: string) {}

  connect(): Promise<void> {
    if (this.connectPromise !== undefined) return this.connectPromise;
    this.connectPromise = new Promise<void>((resolve, reject) => {
      this.resolveConnected = resolve;
      this.rejectConnected = reject;
      const socket = new WebSocket(this.endpoint);
      this.socket = socket;
      socket.addEventListener("open", () => {
        socket.send(JSON.stringify({
          type: "AUTHENTICATE",
          protocolVersion: PROTOCOL_VERSION,
          roomId: this.credentials.roomId,
          sessionToken: this.credentials.sessionToken,
        }));
      });
      socket.addEventListener("message", (event) => this.receive(event.data));
      socket.addEventListener("error", () => {
        if (!this.connected) this.rejectConnection(new Error("Die Verbindung zum Spielserver konnte nicht aufgebaut werden."));
      });
      socket.addEventListener("close", () => {
        if (!this.disposed && !this.connected) this.rejectConnection(new Error("Die Verbindung zum Spielserver wurde geschlossen."));
        for (const pending of this.pending.values()) pending.reject(new Error("Die Verbindung zum Spielserver wurde geschlossen."));
        this.pending.clear();
      });
    });
    return this.connectPromise;
  }

  getSnapshot(): RemoteGameControllerSnapshot {
    return {
      revision: this.revision,
      ...(this.view === undefined ? {} : { view: this.view }),
      ...(this.room === undefined ? {} : { room: this.room }),
    };
  }

  dispatch(action: GameAction): Promise<void> {
    if (!this.connected || this.socket?.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("Keine Verbindung zum Spielserver."));
    }
    const commandId = typeof crypto.randomUUID === "function"
      ? crypto.randomUUID() : `command-${Date.now()}-${++this.sequence}`;
    return new Promise<void>((resolve, reject) => {
      this.pending.set(commandId, { resolve, reject });
      const dto = action as unknown as GameActionDto;
      this.socket!.send(JSON.stringify({ type: "GAME_COMMAND", commandId, action: dto }));
    });
  }

  subscribe(listener: (snapshot: RemoteGameControllerSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    this.disposed = true;
    this.socket?.close();
    this.socket = undefined;
    for (const pending of this.pending.values()) pending.reject(new Error("Die Verbindung wurde beendet."));
    this.pending.clear();
    this.listeners.clear();
  }

  private receive(raw: unknown): void {
    let message: ServerMessage;
    try {
      message = JSON.parse(String(raw)) as ServerMessage;
    } catch {
      return;
    }
    if (message.type === "SERVER_ERROR") {
      const error = new Error(message.message);
      this.rejectConnection(error);
      return;
    }
    if (message.type === "COMMAND_ACCEPTED") {
      this.resolveCommand(message);
      return;
    }
    if (message.type === "COMMAND_REJECTED") {
      const pending = this.pending.get(message.commandId);
      this.pending.delete(message.commandId);
      pending?.reject(new Error(message.message));
      return;
    }
    if (message.type !== "ROOM_SNAPSHOT" || message.protocolVersion !== PROTOCOL_VERSION) return;
    this.room = message.room;
    this.revision = message.revision;
    if (message.gameView !== undefined) this.view = message.gameView as PlayerGameView;
    this.connected = true;
    this.resolveConnection();
    this.emit();
  }

  private resolveCommand(message: CommandAcceptedMessage): void {
    const pending = this.pending.get(message.commandId);
    this.pending.delete(message.commandId);
    pending?.resolve();
  }

  private resolveConnection(): void {
    this.resolveConnected?.();
    this.resolveConnected = undefined;
    this.rejectConnected = undefined;
  }

  private rejectConnection(error: Error): void {
    this.rejectConnected?.(error);
    this.resolveConnected = undefined;
    this.rejectConnected = undefined;
  }

  private emit(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}
