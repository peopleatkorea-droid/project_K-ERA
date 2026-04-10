export type KeraUiMode = "full" | "researcher";

function normalizeUiMode(value: string | undefined): KeraUiMode {
  const trimmed = String(value ?? "").trim().toLowerCase();
  if (trimmed === "researcher") {
    return "researcher";
  }
  return "full";
}

export function getKeraUiMode(): KeraUiMode {
  return normalizeUiMode(process.env.NEXT_PUBLIC_KERA_UI_MODE);
}

export function isResearcherUiMode(): boolean {
  return getKeraUiMode() === "researcher";
}

export function isOperatorUiEnabled(): boolean {
  return getKeraUiMode() === "full";
}
