import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RuntimeErrorBoundary, type RuntimeErrorBoundaryCopy } from "./runtime-error-boundary";

const copy: RuntimeErrorBoundaryCopy = {
  eyebrow: "Workspace Recovery",
  title: "The workspace hit an unexpected error.",
  description: "Retry this view or reload the page.",
  retryLabel: "Retry",
  reloadLabel: "Reload",
  exitLabel: "Sign out",
};

describe("RuntimeErrorBoundary", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a fallback and retries a transient render failure", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    function FailingChild() {
      throw new Error("transient workspace crash");
    }

    function Harness() {
      const [shouldFail, setShouldFail] = useState(true);

      return (
        <div>
          <button type="button" onClick={() => setShouldFail(false)}>
            Resolve crash
          </button>
          <RuntimeErrorBoundary copy={copy} scope="case-workspace">
            {shouldFail ? <FailingChild /> : <div>Recovered workspace</div>}
          </RuntimeErrorBoundary>
        </div>
      );
    }

    render(<Harness />);

    expect(screen.getByRole("heading", { name: copy.title })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Resolve crash" }));
    fireEvent.click(screen.getByRole("button", { name: copy.retryLabel }));

    expect(await screen.findByText("Recovered workspace")).toBeInTheDocument();
    expect(consoleError).toHaveBeenCalled();
  });

  it("clears the fallback when the reset key changes", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    function AlwaysFails() {
      throw new Error("persistent crash");
    }

    const { rerender } = render(
      <RuntimeErrorBoundary copy={copy} resetKey="a" scope="admin-workspace">
        <AlwaysFails />
      </RuntimeErrorBoundary>
    );

    expect(screen.getByRole("heading", { name: copy.title })).toBeInTheDocument();

    rerender(
      <RuntimeErrorBoundary copy={copy} resetKey="b" scope="admin-workspace">
        <div>Healthy workspace</div>
      </RuntimeErrorBoundary>
    );

    expect(await screen.findByText("Healthy workspace")).toBeInTheDocument();
    expect(consoleError).toHaveBeenCalled();
  });
});
