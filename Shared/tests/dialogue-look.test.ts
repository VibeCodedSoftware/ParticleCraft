// Dialogue looks: the new presets' own placement and motion, a style's settings winning over them, imported fonts.
import { describe, expect, it } from 'vitest';
import { colourRuns, customFontFamily, DIALOGUE_ANIMS, DIALOGUE_PRESETS, plainText, resolveDialogueLook, TEXT_IDLES, TEXT_INS } from '../src/dialogueStyle';
import { EFFECTS } from '../src/postfx';

describe('Dialogue looks', () => {
  it('Ink bubble goes over heads, types out, pops in and floats; Retro box stays on the screen and types out', () => {
    const ink = resolveDialogueLook({ preset: 'ink' });
    expect([ink.placement, ink.reveal, ink.animIn, ink.idle, ink.tail]).toEqual(['head', 'typewriter', 'pop', 'float', true]);
    const retro = resolveDialogueLook({ preset: 'retro' });
    expect([retro.placement, retro.reveal, retro.arrow, retro.radius]).toEqual(['screen', 'typewriter', true, '0']);
    // The older presets keep their behaviour.
    const dark = resolveDialogueLook({ preset: 'dark' });
    expect([dark.placement, dark.reveal, dark.animIn, dark.boil]).toEqual(['screen', 'instant', 'fade', 0]);
  });
  it("a style's own settings win, kept in range", () => {
    const L = resolveDialogueLook({ preset: 'ink', placement: 'screen', reveal: 'instant', animIn: 'bounce', animTime: 0.6, idle: 'shake', idleAmount: 3, boil: 0.5, boilRate: 99, typeSpeed: 0 });
    expect([L.placement, L.reveal, L.animIn, L.animTime, L.idle, L.idleAmount, L.boil, L.boilRate]).toEqual(['screen', 'instant', 'bounce', 0.6, 'shake', 1, 0.5, 30]);
    expect(L.typeSpeed).toBeGreaterThanOrEqual(2);
    for (const k of Object.keys(DIALOGUE_ANIMS)) expect(resolveDialogueLook({ preset: 'dark', animIn: k as any }).animIn).toBe(k);
  });
  it('an imported font is used by its own family, with the preset font behind it', () => {
    const L = resolveDialogueLook({ preset: 'retro', font: 'font:My Font' });
    expect(L.font.startsWith(`"${customFontFamily('My Font')}"`)).toBe(true);
    expect(customFontFamily('My Font')).toMatch(/^[A-Za-z0-9_]+$/);
    expect(resolveDialogueLook({ preset: 'ink', font: 'serif' }).font).toContain('Georgia');
  });
  it('every preset is complete', () => {
    for (const [k, p] of Object.entries(DIALOGUE_PRESETS)) for (const f of ['background', 'placement', 'reveal', 'animIn', 'idle', 'width', 'portraitSize'] as const) expect(p.look[f], `${k}.${f}`).toBeDefined();
  });
  it('letter animations and the ◀ ▶ responses: Ink has them, others are plain lists, kept in range', () => {
    const ink = resolveDialogueLook({ preset: 'ink' });
    expect([ink.textIn, ink.choiceMode]).toEqual(['jumble', 'arrows']);
    const dark = resolveDialogueLook({ preset: 'dark' });
    expect([dark.textIn, dark.textIdle, dark.choiceMode]).toEqual(['none', 'none', 'list']);
    const L = resolveDialogueLook({ preset: 'dark', textIn: 'scramble', textIdle: 'wave', textAmount: 5, choiceMode: 'arrows' });
    expect([L.textIn, L.textIdle, L.textAmount, L.choiceMode]).toEqual(['scramble', 'wave', 1, 'arrows']);
    for (const k of Object.keys(TEXT_INS)) expect(resolveDialogueLook({ preset: 'dark', textIn: k as any }).textIn).toBe(k);
    for (const k of Object.keys(TEXT_IDLES)) expect(resolveDialogueLook({ preset: 'dark', textIdle: k as any }).textIdle).toBe(k);
  });
  it('coloured words: named and #hex colours, unknown tags left as written', () => {
    expect(colourRuns('Hi [pink]Memu[/]!')).toEqual([{ text: 'Hi ' }, { text: 'Memu', color: '#ff8fb1' }, { text: '!' }]);
    expect(colourRuns('[#ff88aa]x[/] y')).toEqual([{ text: 'x', color: '#ff88aa' }, { text: ' y' }]);
    expect(colourRuns('a [nope]b[/]').map((r) => r.text).join('')).toBe('a [nope]b[/]');
    expect(plainText('Hi [pink]Memu[/]!')).toBe('Hi Memu!');
  });
  it('the line-art effects have line noise settings', () => {
    for (const fx of ['outline', 'paper']) expect(EFFECTS[fx].params.map((p) => p.key)).toEqual(expect.arrayContaining(['boil', 'boilRate']));
  });
});
