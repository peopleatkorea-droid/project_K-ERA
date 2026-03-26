export function messageFromUnknownError(error: unknown): string | null {
  if (error instanceof Error) {
    const message = error.message.trim();
    return message || null;
  }
  if (typeof error === "string") {
    const message = error.trim();
    return message || null;
  }
  if (error && typeof error === "object") {
    const message =
      "message" in error && typeof (error as { message?: unknown }).message === "string"
        ? (error as { message: string }).message.trim()
        : "";
    if (message) {
      return message;
    }
  }
  return null;
}
