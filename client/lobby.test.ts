import { describe, expect, it } from "vitest";

import type { AccelByteSDK } from "@accelbyte/sdk";

import {
  createLobbyConnection,
  type LobbyMessage,
  type LobbySocket,
} from "./lobby";

function fakeSocket() {
  let openCallback: (() => unknown) | undefined;
  let closeCallback: ((event: CloseEvent) => unknown) | undefined;
  let messageCallback: ((message: LobbyMessage) => unknown) | undefined;
  let errorCallback: ((error: unknown) => unknown) | undefined;
  let disconnected = false;

  const socket: LobbySocket = {
    connect() {},
    disconnect() {
      disconnected = true;
    },
    onOpen(callback) {
      openCallback = callback;
      return { removeEventListener: () => (openCallback = undefined) };
    },
    onClose(callback) {
      closeCallback = callback;
      return { removeEventListener: () => (closeCallback = undefined) };
    },
    onMessage(callback) {
      messageCallback = callback;
      return { removeEventListener: () => (messageCallback = undefined) };
    },
    onError(callback) {
      errorCallback = callback;
      return { removeEventListener: () => (errorCallback = undefined) };
    },
  };

  return {
    socket,
    emitOpen() {
      openCallback?.();
    },
    emitClose() {
      closeCallback?.(new CloseEvent("close"));
    },
    emitMessage(message: LobbyMessage) {
      messageCallback?.(message);
    },
    emitError(error: unknown) {
      errorCallback?.(error);
    },
    isDisconnected() {
      return disconnected;
    },
  };
}

describe("createLobbyConnection", () => {
  it("reports open, messages, close, and cleans up listeners", () => {
    const fake = fakeSocket();
    const events: string[] = [];
    const connection = createLobbyConnection(
      {} as AccelByteSDK,
      {
        onOpen: () => events.push("open"),
        onMessage: (message) =>
          events.push(typeof message === "string" ? message : message.type ?? "message"),
        onClose: () => events.push("close"),
        onError: () => events.push("error"),
      },
      () => fake.socket,
    );

    fake.emitOpen();
    fake.emitMessage({ type: "connectNotif" });
    fake.emitClose();
    expect(events).toEqual(["open", "connectNotif", "close"]);

    connection.disconnect();
    expect(fake.isDisconnected()).toBe(true);
    fake.emitOpen();
    fake.emitMessage({ type: "unexpected-after-cleanup" });
    expect(events).toEqual(["open", "connectNotif", "close"]);
  });

  it("maps raw socket failures to a safe error", () => {
    const fake = fakeSocket();
    let observed: { code: string; message: string } | undefined;
    createLobbyConnection(
      {} as AccelByteSDK,
      {
        onOpen: () => undefined,
        onMessage: () => undefined,
        onClose: () => undefined,
        onError: (error) => {
          observed = { code: error.code, message: error.message };
        },
      },
      () => fake.socket,
    );

    fake.emitError(new Error("access-token-must-not-render"));
    expect(observed).toEqual({
      code: "network",
      message: "Lobby could not be reached. Please retry.",
    });
  });
});
