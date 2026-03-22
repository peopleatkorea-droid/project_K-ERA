export type GooglePromptMomentNotification = {
  isDismissedMoment?: () => boolean;
  isNotDisplayed?: () => boolean;
  isSkippedMoment?: () => boolean;
};

export type GoogleCredentialResponse = {
  credential?: string;
};

export type GoogleAccountsIdApi = {
  initialize: (config: Record<string, unknown>) => void;
  prompt?: (listener?: (notification: GooglePromptMomentNotification) => void) => void;
  renderButton: (element: HTMLElement, options: Record<string, unknown>) => void;
};

export function resetGoogleButtonHost(host: HTMLDivElement) {
  host.dataset.googleReady = "false";
  host.replaceChildren();
}

export function findGoogleInteractive(host?: ParentNode | null) {
  if (!host) {
    return null;
  }
  return host.querySelector<HTMLElement>('div[role="button"], [role="button"], button, [tabindex="0"]');
}

type RenderGoogleButtonsOptions = {
  callback: (response: GoogleCredentialResponse) => void | Promise<void>;
  clientId: string;
  googleButtonWidth: number;
  googleId: GoogleAccountsIdApi;
  hosts: HTMLDivElement[];
};

export function renderGoogleButtons({
  callback,
  clientId,
  googleButtonWidth,
  googleId,
  hosts,
}: RenderGoogleButtonsOptions) {
  hosts.forEach((host) => {
    resetGoogleButtonHost(host);
  });
  googleId.initialize({
    client_id: clientId,
    callback,
  });
  hosts.forEach((host) => {
    googleId.renderButton(host, {
      theme: "outline",
      size: "large",
      width: host.clientWidth || googleButtonWidth,
      text: "signin_with",
      shape: "pill",
    });
    host.dataset.googleReady = "true";
  });
}

export function triggerRenderedGoogleButton(host?: HTMLDivElement | null): boolean {
  if (!host || host.dataset.googleReady !== "true") {
    return false;
  }
  const interactive = findGoogleInteractive(host);
  if (!interactive) {
    return false;
  }
  interactive.click();
  return true;
}
