import React, { useState } from 'react';
import { store, useStore } from './project/store';
import { Launcher } from './editor/Launcher';
import { Editor } from './editor/Editor';

export function App() {
  const project = useStore((s) => s.project);
  const [, force] = useState(0);
  if (!project) return <Launcher onOpen={(p) => store.open(p)} />;
  return <Editor onClose={() => force((n) => n + 1)} />;
}

/** Shows a readable message instead of a blank page if a panel crashes. */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash">
        <h2>Something went wrong</h2>
        <pre>{this.state.error.message}</pre>
        <p>Your work is autosaved every 20 seconds. Try again, or reload and recover from the launcher.</p>
        <button className="btn primary" onClick={() => this.setState({ error: null })}>Try again</button>
        <button className="btn" onClick={() => store.save().finally(() => location.reload())}>Save &amp; reload</button>
      </div>
    );
  }
}
