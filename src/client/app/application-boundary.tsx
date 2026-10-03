import { Component, type ReactNode } from "react";
import { StartupError } from "../features/reader/reader-states";

export class ApplicationBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    if (this.state.failed)
      return (
        <StartupError
          message="Reload feedfold to get the latest version."
          retry={() => window.location.reload()}
        />
      );
    return this.props.children;
  }
}
