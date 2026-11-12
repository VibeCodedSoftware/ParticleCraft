import React from 'react';
import { createRoot } from 'react-dom/client';
import { App, ErrorBoundary } from './App';
import '@shared/ui/logic-ui.css';
import './styles.css';
import { appStyle } from '@shared/ui/icons';

// GameCraft uses line icons, not emoji, in the shared panels.
appStyle.emoji = false;

// Dev-only handle used by smoke tests and debugging in the browser console.
if (import.meta.env.DEV) import('./project/store').then((s) => import('./editor/session').then((ses) => { (window as any).__gc = { store: s.store, refs: ses.editorRefs }; }));

createRoot(document.getElementById('root')!).render(<ErrorBoundary><App /></ErrorBoundary>);
