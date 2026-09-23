import { Component, type ErrorInfo, type ReactNode } from "react";

interface AppErrorBoundaryProps {
  readonly children: ReactNode;
}

interface AppErrorBoundaryState {
  readonly error?: Error;
}

/** Keeps an unexpected production render failure actionable without exposing internals to players. */
export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = {};

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo): void {
    // Browser error reporting remains the host application's responsibility; no game state is logged here.
  }

  render(): ReactNode {
    if (this.state.error === undefined) return this.props.children;
    return <main className="welcome-screen" role="alert">
      <span className="eyebrow">Anzeigefehler</span>
      <h1>Vedras Reiche konnte nicht angezeigt werden.</h1>
      <p>Die Seite kann neu geladen werden.</p>
      {import.meta.env.DEV && <pre className="error-details">{this.state.error.stack ?? this.state.error.message}</pre>}
      <button type="button" className="primary-button" onClick={() => window.location.reload()}>Seite neu laden</button>
    </main>;
  }
}
