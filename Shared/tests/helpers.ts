import { createLogicDocument, event, block, type EventNode, type LogicDocument, type VariableDef } from '../src/schema';
import { emptyScene, makeInstance, type InstanceData, type SceneData } from '../src/runtime/scene';
import { Runtime } from '../src/runtime/runtime';
import type { AppId } from '../src/schema';

export { event, block };

export function doc(events: EventNode[], globals: VariableDef[] = [], plane: 'xy' | 'xz' = 'xy'): LogicDocument {
  const d = createLogicDocument('test', 'logiccraft', plane);
  d.sheets[0].events = events;
  d.globals = globals;
  return d;
}

export function num(name: string, value = 0): VariableDef { return { name, type: 'number', value }; }
export function str(name: string, value = ''): VariableDef { return { name, type: 'string', value }; }

export function scene(insts: Partial<InstanceData>[], mode: '2d' | '3d' = '2d'): SceneData {
  const s = emptyScene('t', mode);
  s.instances = insts.map((o, i) => makeInstance(o.uid ?? i + 1, o.type ?? 'Box', o.kind ?? 'box', o));
  return s;
}

export function run(d: LogicDocument, s: SceneData = scene([]), ticks = 1, app: AppId = 'logiccraft') {
  const logs: string[] = [];
  const rt = new Runtime(s, d, { app, host: { log: (lvl, m) => { if (lvl === 'info') logs.push(m); } } });
  for (let i = 0; i < ticks; i++) rt.tick();
  return { rt, logs };
}
