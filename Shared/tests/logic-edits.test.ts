// Editor edits to logic: dragging a text object updates "Set position" blocks that place it with plain numbers.
import { expect, it } from 'vitest';
import { block, doc, event } from './helpers';
import { syncTextPositionBlocks } from '../src/logicEdits';
import { canvasFont, textStyleCss } from '../src/runtime/textStyle';

it('moving a text updates matching numeric Set position blocks only', () => {
  const d = doc([
    event([block('system.on_start_of_layout')], [
      block('object.set_position', { x: '20', y: '30', z: '0' }, 'Score'),
      block('object.set_position', { x: 'Player.X', y: '30', z: '0' }, 'Score'), // expression: left alone
      block('object.set_position', { x: '99', y: '99', z: '0' }, 'Score'), // a different spot: left alone
      block('object.set_position', { x: '20', y: '30', z: '0' }, 'Title'), // another object
    ]),
  ]);
  expect(syncTextPositionBlocks(d, 'Score', 20, 30, 64, 48, true)).toBe(1);
  expect(syncTextPositionBlocks(d, 'score', 20, 30, 64, 48, false)).toBe(1);
  const acts = (d.sheets[0].events[0] as any).actions;
  expect([acts[0].params.x, acts[0].params.y]).toEqual(['64', '48']);
  expect(acts[1].params.x).toBe('Player.X');
  expect(acts[2].params.x).toBe('99');
  expect(acts[3].params.x).toBe('20');
});

it('text style: weight, family, underline reach CSS and canvas fonts', () => {
  const css = textStyleCss({ weight: 300, fontFamily: 'Georgia', underline: true, italic: true });
  expect(css).toContain('font-weight:300');
  expect(css).toContain('font-family:Georgia, serif');
  expect(css).toContain('text-decoration:underline');
  expect(canvasFont(20, { bold: true })).toBe('700 20px system-ui, "Segoe UI", sans-serif');
  expect(canvasFont(16, { italic: true, weight: 500, fontFamily: 'Courier New' })).toBe('italic 500 16px "Courier New", Courier, monospace');
});
