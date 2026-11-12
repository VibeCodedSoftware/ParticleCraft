// Standalone game player (exported games, and "Preview as exported game" from the editor). It loads game.json
// and the asset files next to it - or, in the editor's dev server, a project by ?project=<id> - and runs it
// with the same engine as Play in the editor, full window, no editor UI.
import React from 'react';
import { createRoot } from 'react-dom/client';
import '../styles.css';
import { SceneView } from '../engine/sceneView';
import { letterboxRect } from '../engine/quality';
import { PlaySession } from '../engine/play';
import { migrateProject } from '../project/migrate';
import { api, useExportedAssets } from '../project/api';
import type { GameProject } from '../project/types';
import { OPEN_MULTIPLAYER, OnlineDialog } from '../editor/OnlineDialog';
import { setNetConfig, type NetClient } from '@shared/ui/net';

const $ = (id: string) => document.getElementById(id)!;

async function loadGame(): Promise<GameProject> {
  const id = new URLSearchParams(location.search).get('project');
  if (id) return api.load(id);
  const r = await fetch('game.json');
  if (!r.ok) throw new Error('game.json was not found next to this page.');
  useExportedAssets(new URL('data/', location.href).href);
  return migrateProject(await r.json());
}

async function main() {
  let project: GameProject;
  try { project = await loadGame(); }
  catch (e: any) {
    $('title').textContent = 'Could not start the game';
    $('sub').innerHTML = '';
    const p = document.createElement('p'); p.className = 'err';
    p.textContent = `${e?.message ?? e} If you opened this file straight from a folder, start it from a web server (or the Windows player): browsers do not let pages read files next to them.`;
    $('sub').append(p);
    return;
  }
  // Export settings: title and colours of the finished game.
  const ex = project.settings.export ?? {};
  const title = ex.title?.trim() || project.name;
  document.title = title;
  $('title').textContent = title;
  if (ex.background) { document.body.style.background = ex.background; $('start').style.background = ex.background; }
  if (ex.themeColor) { const m = document.querySelector('meta[name="theme-color"]') ?? document.head.appendChild(Object.assign(document.createElement('meta'), { name: 'theme-color' })); m.setAttribute('content', ex.themeColor); }  $('sub').textContent = 'Click to play';
  setNetConfig(project.settings.multiplayer); // joining a friend happens before the game session starts
  // Keep shape: the game area (picture and HUD) stays this shape in the middle, with black bars around it.
  if (letterboxRect(1, 1, ex.aspect)) {
    document.documentElement.style.background = document.body.style.background = '#000';
    const fit = () => {
      const r = letterboxRect(innerWidth, innerHeight, ex.aspect)!;
      Object.assign($('game').style, { right: 'auto', bottom: 'auto', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
    };
    fit(); addEventListener('resize', fit);
  }
  const view = new SceneView($('game'));
  view.controls.enabled = false; // the editor's orbit camera: a game has no use for it
  view.projectId = project.id;
  view.assets = project.assets;
  view.customPresets = project.particlePresets;
  let session: PlaySession | null = null;
  const callbacks = {
    log: (level: string, m: string) => (level === 'error' ? console.error : console.log)('[game]', m), onBreakpoint: () => undefined, onSceneChange: () => undefined,
    // Quit game: the Windows player (served as game.localhost) closes when the page asks for /__quit; a browser tab
    // or the Android app can't close itself, so the game goes back to its start.
    quit: () => { if (location.hostname !== 'game.localhost') return false; fetch('/__quit').catch(() => undefined); return true; },
  };
  const startScene = project.startSceneId ?? project.scenes[0].id;
  const start = (client?: NetClient) => {
    session?.stop();
    $('start').style.display = 'none';
    session = new PlaySession(project, startScene, view, $('overlay'), callbacks as any, { client });
    session.captureMouse();
  };
  $('start').onclick = () => start();
  $('start').onkeydown = () => start();

  // Online multiplayer: an exported game has it when its logic opens the menu (the Multiplayer pack, the Start screen's
  // or Pause menu's button). Previewing from the editor keeps the floating button.
  const net = $('net') as HTMLButtonElement;
  if (new URLSearchParams(location.search).get('project')) net.style.display = 'block';
  const modalRoot = createRoot($('modal-root'));
  const openOnline = () => {
    document.exitPointerLock?.();
    modalRoot.render(<OnlineDialog gameId={project.id} getSession={() => session} startPlay={() => start()} join={(c) => start(c)} onClose={() => modalRoot.render(<></>)} />);
  };
  net.onclick = openOnline;
  // "Show multiplayer menu" block (the start screen's Multiplayer button).
  window.addEventListener(OPEN_MULTIPLAYER, openOnline);

  // Installable on phones/tablets when hosted over HTTPS (exported web / Android builds ship a service worker).
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => undefined);
}

main();
