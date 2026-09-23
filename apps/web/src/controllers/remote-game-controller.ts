import type { GameAction, PlayerGameView } from "@vedras/game-core";
import {
  NetworkErrorCode,
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
  readonly playerName?: string;
}

export type RemoteConnectionStatus = NonNullable<GameControllerSnapshot["connectionStatus"]>;

export interface RemoteGameControllerSnapshot extends GameControllerSnapshot {
  readonly room?: PublicRoomState;
  readonly connectionStatus: RemoteConnectionStatus;
  readonly rematchRoomId?: string;
}

interface PendingCommand {
  readonly resolve: () => void;
  readonly reject: (reason: Error) => void;
}

const RECONNECT_DELAYS_MS = [500, 1_000, 2_000, 4_000, 5_000] as const;

/** Browser transport for authoritative rooms. It stores only a player view and reconnect credentials. */
export class RemoteGameController implements GameController {
  private socket: WebSocket | undefined;
  private room: PublicRoomState | undefined;
  private view: PlayerGameView | undefined;
  private revision = 0;
  private connected = false;
  private disposed = false;
  private terminal = false;
  private reconnectAttempts = 0;
  private reconnectTimer: number | undefined;
  private connectionStatus: RemoteConnectionStatus = "DISCONNECTED";
  private connectionMessage: string | undefined;
  private readonly listeners = new Set<(snapshot: RemoteGameControllerSnapshot) => void>();
  private readonly pending = new Map<string, PendingCommand>();
  private connectPromise?: Promise<void>;
  private resolveConnected: (() => void) | undefined;
  private rejectConnected: ((reason: Error) => void) | undefined;
  private sequence = 0;
  private rematchRoomId: string | undefined;

  constructor(readonly credentials: MultiplayerCredentials, private readonly endpoint: string) {}

  connect(): Promise<void> {
    if (this.connectPromise !== undefined) return this.connectPromise;
    if (this.terminal) return Promise.reject(new Error(this.connectionMessage ?? "Diese Spielersitzung ist nicht mehr verfügbar."));
    this.connectPromise = new Promise<void>((resolve, reject) => {
      this.resolveConnected = resolve;
      this.rejectConnected = reject;
      this.setConnection("CONNECTING");
      this.openSocket();
    });
    return this.connectPromise;
  }

  getSnapshot(): RemoteGameControllerSnapshot {
    return {
      revision: this.revision,
      connectionStatus: this.connectionStatus,
      ...(this.connectionMessage === undefined ? {} : { connectionMessage: this.connectionMessage }),
      ...(this.view === undefined ? {} : { view: this.view }),
      ...(this.room === undefined ? {} : { room: this.room }),
      ...(this.rematchRoomId === undefined ? {} : { rematchRoomId: this.rematchRoomId }),
    };
  }

  dispatch(action: GameAction): Promise<void> {
    if (!this.connected || this.socket?.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("Die Verbindung zum Spielserver wird wiederhergestellt."));
    }
    const commandId = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `command-${Date.now()}-${++this.sequence}`;
    return new Promise<void>((resolve, reject) => {
      this.pending.set(commandId, { resolve, reject });
      this.socket!.send(JSON.stringify({ type: "GAME_COMMAND", commandId, action: action as unknown as GameActionDto }));
    });
  }

  subscribe(listener: (snapshot: RemoteGameControllerSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    this.disposed = true;
    if (this.reconnectTimer !== undefined) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.socket?.close();
    this.socket = undefined;
    this.rejectPending("Die Verbindung wurde beendet.");
    this.rejectInitial(new Error("Die Verbindung wurde beendet."));
    this.listeners.clear();
  }

  private openSocket(): void {
    if (this.disposed || this.terminal) return;
    let socket: WebSocket;
    try {
      socket = new WebSocket(this.endpoint);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    socket.addEventListener("open", () => {
      if (this.socket !== socket || this.disposed || this.terminal) return;
      socket.send(JSON.stringify({
        type: "AUTHENTICATE",
        protocolVersion: PROTOCOL_VERSION,
        roomId: this.credentials.roomId,
        sessionToken: this.credentials.sessionToken,
      }));
    });
    socket.addEventListener("message", (event) => this.receive(event.data, socket));
    socket.addEventListener("error", () => {
      if (this.socket === socket && !this.connected) this.setConnection("RECONNECTING", "Verbindung wird wiederhergestellt …");
    });
    socket.addEventListener("close", () => this.handleClose(socket));
  }

  private receive(raw: unknown, socket: WebSocket): void {
    let message: ServerMessage;
    try {
      message = JSON.parse(String(raw)) as ServerMessage;
    } catch {
      return;
    }
    if (message.type === "SERVER_ERROR") {
      this.handleServerError(message.code, message.message, socket);
      return;
    }
    if (message.type === "REMATCH_OFFER") {
      this.rematchRoomId = message.roomId;
      this.emit();
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
    this.reconnectAttempts = 0;
    this.setConnection("CONNECTED");
    this.resolveInitial();
  }

  private handleServerError(code: NetworkErrorCode, message: string, socket: WebSocket): void {
    if (code === NetworkErrorCode.InvalidSession || code === NetworkErrorCode.RoomNotFound || code === NetworkErrorCode.SessionReplaced || code === NetworkErrorCode.PlayerRemoved) {
      this.terminal = true;
      this.connected = false;
      const status: RemoteConnectionStatus = code === NetworkErrorCode.InvalidSession ? "INVALID_SESSION" :
        code === NetworkErrorCode.RoomNotFound ? "ROOM_NOT_FOUND" : code === NetworkErrorCode.PlayerRemoved ? "PLAYER_REMOVED" : "SESSION_REPLACED";
      const displayMessage = status === "INVALID_SESSION" ? "Diese lokale Spielersitzung ist nicht mehr gültig." :
        status === "ROOM_NOT_FOUND" ? "Dieser Raum ist auf dem Server nicht mehr vorhanden." :
          status === "PLAYER_REMOVED" ? "Du wurdest aus diesem Raum entfernt." : "Diese Spielersitzung wurde in einem anderen Fenster geöffnet.";
      this.setConnection(status, displayMessage);
      this.rejectPending(displayMessage);
      this.rejectInitial(new Error(displayMessage));
      socket.close();
      return;
    }
    this.rejectPending(message);
  }

  private handleClose(socket: WebSocket): void {
    if (this.socket !== socket) return;
    this.socket = undefined;
    this.connected = false;
    this.rejectPending("Die Verbindung zum Spielserver wurde geschlossen.");
    if (this.disposed || this.terminal) return;
    this.setConnection("RECONNECTING", "Verbindung wird wiederhergestellt …");
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.terminal || this.reconnectTimer !== undefined) return;
    const delay = RECONNECT_DELAYS_MS[Math.min(this.reconnectAttempts, RECONNECT_DELAYS_MS.length - 1)]!;
    this.reconnectAttempts += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = undefined;
      this.openSocket();
    }, delay);
  }

  private resolveCommand(message: CommandAcceptedMessage): void {
    const pending = this.pending.get(message.commandId);
    this.pending.delete(message.commandId);
    pending?.resolve();
  }

  private resolveInitial(): void {
    this.resolveConnected?.();
    this.resolveConnected = undefined;
    this.rejectConnected = undefined;
  }

  private rejectInitial(error: Error): void {
    this.rejectConnected?.(error);
    this.resolveConnected = undefined;
    this.rejectConnected = undefined;
  }

  private rejectPending(message: string): void {
    for (const pending of this.pending.values()) pending.reject(new Error(message));
    this.pending.clear();
  }

  private setConnection(status: RemoteConnectionStatus, message?: string): void {
    this.connectionStatus = status;
    this.connectionMessage = message;
    this.emit();
  }

  private emit(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}
