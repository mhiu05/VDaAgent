import { Component, type ReactNode } from "react";
import { i18n } from "./i18n/messages";
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: boolean }
> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? (
      <div className="page-state" role="alert">
        <h1>{i18n.t("error")}</h1>
        <button
          className="button button-secondary"
          onClick={() => location.reload()}
        >
          {i18n.t("retry")}
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}
