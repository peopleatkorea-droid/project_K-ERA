"use client";

import React, { type ReactNode } from "react";

import { Button } from "./button";
import { Card } from "./card";
import { SectionHeader } from "./section-header";

export type RuntimeErrorBoundaryCopy = {
  eyebrow: string;
  title: string;
  description: string;
  retryLabel: string;
  reloadLabel: string;
  exitLabel?: string;
  devDetailsLabel?: string;
};

type RuntimeErrorBoundaryProps = {
  children: ReactNode;
  copy: RuntimeErrorBoundaryCopy;
  resetKey?: string;
  scope: string;
  onExit?: () => void;
};

type RuntimeErrorBoundaryState = {
  hasError: boolean;
  errorMessage: string | null;
};

class RuntimeErrorBoundaryInner extends React.Component<
  RuntimeErrorBoundaryProps,
  RuntimeErrorBoundaryState
> {
  state: RuntimeErrorBoundaryState = {
    hasError: false,
    errorMessage: null,
  };

  static getDerivedStateFromError(error: unknown): RuntimeErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error instanceof Error ? error.message : null,
    };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    console.error("Runtime workspace boundary caught an error.", {
      scope: this.props.scope,
      error,
      componentStack: info.componentStack,
    });
  }

  componentDidUpdate(prevProps: RuntimeErrorBoundaryProps) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({
        hasError: false,
        errorMessage: null,
      });
    }
  }

  private handleRetry = () => {
    this.setState({
      hasError: false,
      errorMessage: null,
    });
  };

  private handleReload = () => {
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const { copy, onExit } = this.props;
    const showDevDetails =
      process.env.NODE_ENV !== "production" && Boolean(this.state.errorMessage);

    return (
      <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(48,88,255,0.14),transparent_34%),linear-gradient(180deg,var(--surface-muted),var(--surface))] px-4 py-6 sm:px-6 lg:px-8">
        <section className="mx-auto mt-6 grid w-full max-w-3xl gap-5">
          <Card as="section" variant="surface" className="grid gap-5 p-6 sm:p-8" role="alert">
            <SectionHeader
              eyebrow={
                <span className="inline-flex min-h-8 items-center rounded-full border border-border bg-surface-muted/80 px-3 text-[0.76rem] font-semibold uppercase tracking-[0.14em] text-muted">
                  {copy.eyebrow}
                </span>
              }
              title={copy.title}
              description={copy.description}
              aside={
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Button type="button" variant="primary" size="sm" onClick={this.handleRetry}>
                    {copy.retryLabel}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={this.handleReload}>
                    {copy.reloadLabel}
                  </Button>
                  {onExit && copy.exitLabel ? (
                    <Button type="button" variant="ghost" size="sm" onClick={onExit}>
                      {copy.exitLabel}
                    </Button>
                  ) : null}
                </div>
              }
            />
            {showDevDetails ? (
              <details className="rounded-[18px] border border-border bg-surface-muted/60 px-4 py-3 text-sm text-muted">
                <summary className="cursor-pointer font-medium text-ink">
                  {copy.devDetailsLabel ?? "Error details"}
                </summary>
                <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words text-xs leading-5 text-muted">
                  {this.state.errorMessage}
                </pre>
              </details>
            ) : null}
          </Card>
        </section>
      </main>
    );
  }
}

export function RuntimeErrorBoundary(props: RuntimeErrorBoundaryProps) {
  return <RuntimeErrorBoundaryInner {...props} />;
}
