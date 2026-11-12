// Play / Pause / Step / Stop / Restart controller shared by the toolbar, menus and shortcuts.
import { store } from '../project/store';
import { PlaySession } from '../engine/play';
import type { SceneView } from '../engine/sceneView';
import type { NetClient } from '@shared/ui/net';

export const editorRefs: { view: SceneView | null; overlay: HTMLElement | null; session: PlaySession | null } = { view: null, overlay: null, session: null };

export function play() {
  const s = store.get();
  if (!s.project || !editorRefs.view || !editorRefs.overlay) return;
  if (editorRefs.session) { editorRefs.session.paused = false; store.set({ play: 'play' }); editorRefs.session.captureMouse(); return; }
  store.log('info', 'Play');
  editorRefs.session = new PlaySession(s.project, s.sceneId, editorRefs.view, editorRefs.overlay, {
    log: (level, message, ref) => store.log(level, message, ref),
    onBreakpoint: (id) => { store.set({ play: 'paused', focusBlockId: null }); store.log('warn', `Paused at breakpoint (event ${id}). Press Play/Resume to continue.`, { eventId: id }); },
    onSceneChange: (id) => store.set({ sceneId: id }),
    // "Quit game" stops play (after the tick that asked).
    quit: () => { store.log('info', 'Quit game: play stopped'); setTimeout(stop, 0); return true; },
  });
  editorRefs.session.traceEnabled = true;
  editorRefs.session.rt.traceEnabled = true;
  store.set({ play: 'play', selection: [] });
  editorRefs.view.renderer.domElement.focus();
  // Mouse-look games grab the mouse right away (this runs inside the Play click / F5 key gesture).
  editorRefs.session.captureMouse();
}

/** Play as a player who joined someone's online game (the host runs the game; we show it and send controls). */
export function joinOnline(client: NetClient) {
  const s = store.get();
  if (!s.project || !editorRefs.view || !editorRefs.overlay) return;
  if (editorRefs.session) stop();
  store.log('info', `Joined as player ${client.slot}`);
  editorRefs.session = new PlaySession(s.project, s.sceneId, editorRefs.view, editorRefs.overlay, {
    log: (level, message, ref) => store.log(level, message, ref),
    onBreakpoint: () => undefined,
    onSceneChange: (id) => store.set({ sceneId: id }),
  }, { client });
  store.set({ play: 'play', selection: [] });
  editorRefs.view.renderer.domElement.focus();
}

export function pause() {
  const ses = editorRefs.session; if (!ses) return;
  if (ses.rt.pausedAtBreakpoint) { ses.rt.resumeFromBreakpoint(); ses.paused = false; store.set({ play: 'play' }); return; }
  ses.paused = !ses.paused;
  store.set({ play: ses.paused ? 'paused' : 'play' });
  if (ses.paused) document.exitPointerLock?.(); else ses.captureMouse();
}

export function step() {
  const ses = editorRefs.session; if (!ses) return;
  if (ses.rt.pausedAtBreakpoint) ses.rt.resumeFromBreakpoint();
  ses.step();
  store.set({ play: 'paused' });
}

export function stop() {
  if (!editorRefs.session) return;
  document.exitPointerLock?.();
  editorRefs.session.stop();
  editorRefs.session = null;
  store.set({ play: 'edit', rev: store.get().rev + 1 });
  store.log('info', '■ Stopped — the scene is back to its edited state');
}

export function restart() {
  if (editorRefs.session) editorRefs.session.restart();
  else play();
}

/** Logic edits while playing are hot-reloaded into the running game. */
store.subscribe(() => {
  const s = store.get();
  const ses = editorRefs.session;
  if (ses && s.project && ses.rt.doc !== s.project.logic) ses.reloadLogic(s.project.logic);
});
