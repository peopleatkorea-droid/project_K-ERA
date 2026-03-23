import type { DesktopAppConfigState } from "./desktop-app-config";
import type { DesktopDiagnosticsSnapshot } from "./desktop-diagnostics";

export type DesktopOnboardingStepId =
  | "storage"
  | "controlPlane"
  | "site"
  | "runtimeContract"
  | "runtimeServices"
  | "signIn";

export type DesktopOnboardingStepStatus = "done" | "current" | "pending";

export type DesktopOnboardingStep = {
  id: DesktopOnboardingStepId;
  ready: boolean;
  status: DesktopOnboardingStepStatus;
};

export type DesktopRuntimeServiceHealth = {
  backendReady: boolean;
  workerRequired: boolean;
  workerReady: boolean;
  mlRequired: boolean;
  mlReady: boolean;
};

export type DesktopOnboardingState = {
  firstRun: boolean;
  currentStepId: DesktopOnboardingStepId;
  completed: number;
  total: number;
  percent: number;
  canStartRuntime: boolean;
  canSignIn: boolean;
  canOpenWorkspace: boolean;
  needsSettings: boolean;
  runtimeServices: DesktopRuntimeServiceHealth;
  steps: DesktopOnboardingStep[];
};

function hasValue(value: string | null | undefined) {
  return Boolean(value?.trim());
}

export function describeDesktopOnboarding(
  config: DesktopAppConfigState | null,
  diagnostics: DesktopDiagnosticsSnapshot | null,
): DesktopOnboardingState {
  const values = config?.values;
  const runtimeContractErrors = config?.runtime_contract.errors.length ?? 0;

  const storageReady = hasValue(values?.storage_dir);
  const runtimeContractReady = runtimeContractErrors === 0;

  const workerRequired = (values?.local_backend_mode ?? "managed") !== "external";
  const mlRequired = (values?.ml_transport ?? "sidecar") === "sidecar";
  const backendReady = diagnostics?.localBackend?.healthy === true;
  const workerReady = !workerRequired || diagnostics?.localWorker?.running === true;
  const mlReady = !mlRequired || diagnostics?.mlBackend?.healthy === true;
  const runtimeServicesReady = backendReady && workerReady && mlReady;
  const canStartRuntime = storageReady && runtimeContractReady;
  const canSignIn = runtimeContractReady && runtimeServicesReady;

  const baseSteps: Array<{ id: DesktopOnboardingStepId; ready: boolean }> = [
    { id: "storage", ready: storageReady },
    { id: "runtimeContract", ready: runtimeContractReady },
    { id: "runtimeServices", ready: runtimeServicesReady },
    { id: "signIn", ready: canSignIn },
  ];

  const currentStepId = baseSteps.find((step) => !step.ready)?.id ?? "signIn";
  const steps: DesktopOnboardingStep[] = baseSteps.map((step) => ({
    ...step,
    status: step.ready ? "done" : step.id === currentStepId ? "current" : "pending",
  }));
  const completed = steps.filter((step) => step.ready).length;
  const total = steps.length;

  return {
    firstRun: !config?.setup_ready && completed <= 1,
    currentStepId,
    completed,
    total,
    percent: Math.round((completed / total) * 100),
    canStartRuntime,
    canSignIn,
    canOpenWorkspace: Boolean(config?.setup_ready) && canSignIn,
    needsSettings: ["storage", "runtimeContract"].includes(currentStepId),
    runtimeServices: {
      backendReady,
      workerRequired,
      workerReady,
      mlRequired,
      mlReady,
    },
    steps,
  };
}
