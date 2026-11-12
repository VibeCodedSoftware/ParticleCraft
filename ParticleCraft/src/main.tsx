import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import '@shared/ui/logic-ui.css';
import './styles.css';
import { appStyle } from '@shared/ui/icons';

// ParticleCraft uses line icons, not emoji, in the shared panels.
appStyle.emoji = false;

createRoot(document.getElementById('root')!).render(<App />);
