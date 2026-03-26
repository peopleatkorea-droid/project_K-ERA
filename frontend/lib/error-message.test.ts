import { describe, expect, it } from "vitest";

import { messageFromUnknownError } from "./error-message";

describe("messageFromUnknownError", () => {
  it("returns the message from Error instances", () => {
    expect(messageFromUnknownError(new Error("Local API server is unavailable."))).toBe(
      "Local API server is unavailable.",
    );
  });

  it("returns trimmed string errors", () => {
    expect(messageFromUnknownError("  Failed to launch the desktop-managed local worker.  ")).toBe(
      "Failed to launch the desktop-managed local worker.",
    );
  });

  it("returns the message field from message-like objects", () => {
    expect(messageFromUnknownError({ message: "Initial training is unavailable: Local API server is unavailable." })).toBe(
      "Initial training is unavailable: Local API server is unavailable.",
    );
  });

  it("returns null for unsupported error payloads", () => {
    expect(messageFromUnknownError({ detail: "missing" })).toBeNull();
    expect(messageFromUnknownError(null)).toBeNull();
  });
});
