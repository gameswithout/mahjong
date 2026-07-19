import type { AccelByteSDK } from "@accelbyte/sdk";
import { Lobby } from "@accelbyte/sdk-lobby";

export type LobbyMessage = { type?: string; [key: string]: unknown } | string;

export type LobbyErrorCode = "network" | "unknown";

export class LobbyConnectionError extends Error {
  constructor(
    readonly code: LobbyErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "LobbyConnectionError";
  }
}

interface ListenerHandle {
  removeEventListener?: () => void;
}

export interface LobbySocket {
  connect(): void;
  disconnect(code?: number, reason?: string): void;
  onOpen(callback: () => unknown): ListenerHandle;
  onClose(callback: (event: CloseEvent) => unknown): ListenerHandle;
  onMessage(callback: (message: LobbyMessage) => unknown, raw?: boolean): ListenerHandle;
  onError(callback: (error: unknown) => unknown): ListenerHandle;
}

export interface LobbyConnection {
  disconnect(): void;
}

export interface LobbyConnectionCallbacks {
  onOpen(): void;
  onMessage(message: LobbyMessage): void;
  onClose(event: CloseEvent): void;
  onError(error: LobbyConnectionError): void;
}

export type LobbySocketFactory = (sdk: AccelByteSDK) => LobbySocket;

function defaultLobbySocketFactory(sdk: AccelByteSDK): LobbySocket {
  return Lobby.WebSocket(sdk);
}

function removeListener(listener: ListenerHandle | undefined): void {
  listener?.removeEventListener?.();
}

function safeLobbyError(error: unknown): LobbyConnectionError {
  if (error instanceof LobbyConnectionError) {
    return error;
  }

  return new LobbyConnectionError("network", "Lobby could not be reached. Please retry.", {
    cause: error,
  });
}

export function createLobbyConnection(
  sdk: AccelByteSDK,
  callbacks: LobbyConnectionCallbacks,
  socketFactory: LobbySocketFactory = defaultLobbySocketFactory,
): LobbyConnection {
  const socket = socketFactory(sdk);
  let closed = false;
  let openListener: ListenerHandle | undefined;
  let closeListener: ListenerHandle | undefined;
  let messageListener: ListenerHandle | undefined;
  let errorListener: ListenerHandle | undefined;

  try {
    // The SDK creates its WebSocket instance during connect(), after which its
    // lifecycle listeners can be registered.
    socket.connect();
    openListener = socket.onOpen(() => callbacks.onOpen());
    closeListener = socket.onClose((event) => callbacks.onClose(event));
    messageListener = socket.onMessage((message) => callbacks.onMessage(message));
    errorListener = socket.onError((error) => callbacks.onError(safeLobbyError(error)));
  } catch (error) {
    const safeError = safeLobbyError(error);
    callbacks.onError(safeError);
    throw safeError;
  }

  return {
    disconnect() {
      if (closed) {
        return;
      }

      closed = true;
      removeListener(openListener);
      removeListener(closeListener);
      removeListener(messageListener);
      removeListener(errorListener);
      socket.disconnect(1000, "client disconnect");
    },
  };
}
