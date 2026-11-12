// Template 8: infinite Backrooms survival, first person, built from the user's Backrooms_V10.blend
// (read natively - no Blender needed): the 25 room tiles p1..p25 with their walls, floor and doors, the
// ceiling with its light panels, the bacteria monster with its walk animation, the items (almond milk,
// bread, bandage, medkit, planks, building material, glowstick), their first-person "Hold" view models,
// and the placeable wall with its preview. Chunks are generated and recycled by event-sheet logic
// (no hidden code): GenChunk picks a random room with "Create object by name", a 3x3 neighbourhood loop
// keeps the area around the player filled, and far chunks are destroyed with everything attached to them.
// Wall collisions come from compound colliders generated from the room meshes (scripts/blend-assets.ts).
import { makeInstance, DEFAULT_LIGHT, type InstanceData } from '@shared/src/runtime/scene';
import type { AssetImportSettings, AssetRef } from '../project/types';
import { DEFAULT_IMPORT } from '../project/types';
import { B, E, G, Kit, bh, makeProject, postfx, v } from './kit';
import { makeEffect } from '@shared/src/postfx';
import { BLEND_DATA } from './blendData';

const BLEND = 'lib:library/backrooms/Backrooms_V10.blend';
const obj = (name: string) => `${BLEND}#${name}`;
/** Blender units -> meters. The user's player cube is ~1.06 units tall; this makes the halls feel human-sized. */
const S = 1.6;
const TILE = 15.095 * S;
const CEIL_Y = Math.round((-7.627 - -9.211) * S * 1000) / 1000; // ceiling height above the floor, from the .blend
const PLANK_Y = 0.85; // placed planks sit at waist height (m)
const TX = {
  iHealth: 'lib:library/backrooms/ui/Health.png', iHunger: 'lib:library/backrooms/ui/Hunger.png', iThirst: 'lib:library/backrooms/ui/Thirst.png',
  iBread: 'lib:library/backrooms/ui/Bread.png', iBandage: 'lib:library/backrooms/ui/Bandage.png', iWood: 'lib:library/backrooms/Wood2.png',
};
const NOCOL = { shape: 'none' as const, size: [1, 1, 1] as [number, number, number], offset: [0, 0, 0] as [number, number, number] };
// The carpet's two materials (Material.006 / .008) were authored with UVs at very different scales, so a few floor
// planes showed a tiny, distorted carpet next to the others: give both one world-aligned density instead.
const ROOM_SETTINGS: Partial<AssetImportSettings> = { center: false, ground: false, lights: false, collision: 'none', materialOverrides: [{ match: '^Material\\.00[68]$', worldUV: 1.58 }] }; // 1.58 tiles per Blender unit, as on the regular carpet planes
const HOLD_SETTINGS: Partial<AssetImportSettings> = { center: true, ground: false, lights: false, collision: 'none' };
const ITEM_SETTINGS: Partial<AssetImportSettings> = { lights: false };
// The glow stick's tube (Material.009, an Emission + Transparent mix) glows green.
const GLOW_GREEN = [{ match: '^Material\\.009$', emissiveColor: '#3dff5c' }];
const GLOW_ITEM_SETTINGS: Partial<AssetImportSettings> = { ...ITEM_SETTINGS, materialOverrides: GLOW_GREEN };
const SMILER_SETTINGS: Partial<AssetImportSettings> = { center: true, ground: false, lights: false, collision: 'none' };
const NAMED = BLEND_DATA.backrooms.named as Record<string, { size: readonly number[] }>;
const ROOMS = BLEND_DATA.backrooms.rooms as Record<string, { boxes: readonly (readonly number[])[]; spawn: readonly number[]; spots: readonly (readonly number[])[] }>;

/** World item made from one of the user's objects (pivot at the bottom center, collider fitted to its bounds). */
function item(type: string, blendName: string, o: Partial<InstanceData> = {}): Omit<InstanceData, 'uid'> {
  const s = NAMED[blendName].size;
  const size: [number, number, number] = [Math.max(0.12, s[0]), Math.max(0.08, s[1]), Math.max(0.12, s[2])];
  return makeInstance(0, type, 'mesh', { sx: S, sy: S, sz: S, color: '#ffffff', mesh: { asset: obj(blendName), rotY: 0 }, collider: { shape: 'box', size, offset: [0, size[1] / 2, 0] }, ...o });
}

export function backroomsTemplate() {
  const k = new Kit('Level 0', '3d');
  k.scene.settings.background = '#1c1a12';
  k.scene.settings.world = { color: '#d8c98a', strength: 0.32, viewTransform: 'agx', exposure: 0.25 };
  const cxz = [v('cx', 0), v('cz', 0)];

  // ---- Spawn templates (object types with no placed instances, created by GenChunk)
  // A chunk is an empty that holds one random room and the ceiling; destroying it removes both.
  k.template(makeInstance(0, 'Chunk', 'empty', { collider: NOCOL }), cxz);
  for (let n = 1; n <= 25; n++) {
    const r = ROOMS['p' + n];
    // Compound collider: one box per wall run, plus the floor slab.
    const boxes = [[0, -0.05, 0, 15.095, 0.1, 15.095], ...r.boxes.map((b) => [...b])];
    k.template(makeInstance(0, 'Room' + n, 'mesh', { sx: S, sy: S, sz: S, color: '#ffffff', mesh: { asset: obj('p' + n), rotY: 0 }, collider: { shape: 'box', size: [15.095, 0.1, 15.095], offset: [0, -0.05, 0], boxes }, behaviors: [bh('solid')] }));
  }
  k.template(makeInstance(0, 'Ceiling', 'mesh', { sx: S, sy: S, sz: S, color: '#ffffff', mesh: { asset: obj('Ceiling'), rotY: 0 }, collider: NOCOL }));
  k.template(item('Bread', 'Bread'), cxz);
  k.template(item('AlmondMilk', 'AlmondMilk'), cxz);
  k.template(item('Medkit', 'Medkit'), cxz);
  k.template(item('Bandage', 'Bandage'), cxz);
  k.template(item('Plank', 'Plank'), cxz);
  k.template(item('BuildingMaterial', 'BuildingMaterial'), cxz);
  k.template(item('Glowstick', 'Glowstick', { tags: ['glow'], collider: { shape: 'box', size: [0.12, 0.31, 0.12], offset: [0, 0.155, 0] }, behaviors: [bh('physics', { mass: 0.3, bounce: 0.35, friction: 0.6 })] }), cxz);
  const wallSize = NAMED.PlacableWall.size;
  // Placed walls turn with the player, so they use a one-box compound collider (compound boxes rotate).
  // A placed plank: the user's Plank as a barricade board at waist height (one-box compound collider so it turns).
  const ps = NAMED.Plank.size;
  k.template(item('PlacedPlank', 'Plank', { collider: { shape: 'box', size: [ps[0], ps[1], 0.1], offset: [0, ps[1] / 2, 0], boxes: [[0, ps[1] / 2, 0, ps[0], ps[1], 0.1]] }, behaviors: [bh('solid')] }));
  k.template(item('PlacableWall', 'PlacableWall', { collider: { shape: 'box', size: [...wallSize] as [number, number, number], offset: [0, wallSize[1] / 2, 0], boxes: [[0, wallSize[1] / 2, 0, wallSize[0], wallSize[1], wallSize[2]]] }, behaviors: [bh('solid')] }));

  // ---- Light pools (lights are never created at runtime, so there are no shader hitches)
  // 9 ceiling lamps for the 3x3 chunks around the player, 4 glowstick lights that follow the nearest glowsticks.
  for (let slot = 0; slot < 9; slot++) k.add('Lamp', 'light', { x: 0, y: CEIL_Y - 0.25, z: 0, vars: { slot }, light: { ...DEFAULT_LIGHT, type: 'point', power: 340, color: '#fff2c4', castShadow: false, radius: 0.3, cutoff: 24 } });
  k.typeVars('Lamp', [v('slot', 0)]);
  for (let slot = 0; slot < 4; slot++) k.add('GlowLight', 'light', { x: 0, y: -100, z: 0, vars: { slot }, light: { ...DEFAULT_LIGHT, type: 'point', power: 70, color: '#5dff74', castShadow: false, radius: 0.1, cutoff: 9 } });
  k.typeVars('GlowLight', [v('slot', 0)]);
  // Smilers: grinning faces that only appear when the lights go out (spawned by the "Lights out" events).
  // The user's Smiler(new) face from the .blend: a glowing grin cut out by its texture's alpha. It is a 1 m face
  // looking along X, so "Look at Player" every tick turns it toward you.
  k.template(makeInstance(0, 'Smiler', 'mesh', { name: 'Smiler', y: 1.45, rx: 180, sx: 1.25, sy: 1.25, sz: 1.25, color: '#ffffff', mesh: { asset: obj('Smiler(new).002'), rotY: 0 }, tags: ['glow'],
    collider: { shape: 'box', size: [0.6, 0.6, 0.6], offset: [0, 0, 0], isTrigger: true }, behaviors: [bh('sine', { movement: 'vertical', magnitude: 0.08, period: 2.2 })] }));

  // ---- Player: first person, no model (an invisible collider the camera sits in)
  const spawn = ROOMS.p13.spawn;
  k.add('Player', 'box', { name: 'Player', x: spawn[0] * S, y: 0.05, z: spawn[1] * S, ry: 90, visible: false, color: '#ffffff',
    collider: { shape: 'box', size: [0.55, 1.7, 0.55], offset: [0, 0.85, 0] },
    behaviors: [bh('platform', { maxSpeed: 3.4, runMultiplier: 1.75, jumpStrength: 5, turnSpeed: 0 }), bh('health', { maxHp: 100, hp: 100, invulnerableTime: 0.5 })] });
  // Three glowsticks to start with, next to the spawn point.
  [[1.2, 0.6], [1.4, -0.5], [-1.1, 0.9]].forEach(([dx, dz], n) => k.add('Glowstick', 'mesh', item('Glowstick', 'Glowstick', { tags: ['glow'], name: 'Glowstick ' + (n + 1), x: spawn[0] * S + dx, y: 0.05, z: spawn[1] * S + dz, collider: { shape: 'box', size: [0.12, 0.31, 0.12], offset: [0, 0.155, 0] }, behaviors: [bh('physics', { mass: 0.3, bounce: 0.35, friction: 0.6 })] })));

  const bac = NAMED['BacteriaaM.002'].size;
  k.add('Bacteria', 'mesh', { name: 'Bacteria', x: 30, y: 0, z: 30, sx: 1.9, sy: 1.9, sz: 1.9, color: '#ffffff', mesh: { asset: obj('BacteriaaM.002'), rotY: 90, animMap: { walk: 'Walk.002', idle: 'Walk.002', run: 'Walk.002' } }, vars: { state: 'idle', cooldown: 0, lastX: 0, lastZ: 0 },
    collider: { shape: 'box', size: [Math.min(bac[0], bac[2]) * 0.9, bac[1], Math.min(bac[0], bac[2]) * 0.9], offset: [0, bac[1] / 2, 0] }, behaviors: [bh('pathfinding', { maxSpeed: 3.3, cellSize: 0.5, agentRadius: 0.4 }), bh('timer')] });
  k.typeVars('Bacteria', [v('state', 'idle'), v('cooldown', 0), v('lastX', 0), v('lastZ', 0)]);
  // Building preview (the user's WallPreview object).
  k.add('WallPreview', 'mesh', { x: 0, y: -50, z: 0, sx: S, sy: S, sz: S, opacity: 45, visible: false, color: '#ffffff', mesh: { asset: obj('WallPreview'), rotY: 0 }, collider: NOCOL });
  k.add('PlankPreview', 'mesh', { x: 0, y: -50, z: 0, sx: S, sy: S, sz: S, opacity: 45, visible: false, color: '#ffffff', mesh: { asset: obj('PlankPreview'), rotY: 0 }, collider: NOCOL });

  const cam = BLEND_DATA.backrooms.camera;
  const camera = k.camera({ x: 0, y: 1.3, z: 0 }, { focalLength: cam.lens ?? 27, clipStart: 0.04, clipEnd: 70, // A light found-footage feel: soft glow on the lamps, faint grain and edge darkening. (The full VHS stack -
    // tape wobble + chroma bleed + chromatic aberration - smeared colour fringes over everything.)
    postfx: [makeEffect('glare', { intensity: 0.5, glow: 0.45, threshold: 1.2, length: 60, shape: 'horizontal', tint: '#fff2c4' }), makeEffect('grain', { amount: 0.05 }), makeEffect('vignette', { amount: 0.45 }), { ...postfx('fog')[0], params: { density: 0.045, color: '#3a3420' } }] },
    { target: 'Player', firstPerson: true, eyeHeight: 1.25, sensitivity: 0.2, lookAt: false });
  // First-person view models: the user's *Hold objects, attached to the camera (camera looks along -Z).
  // Placed lower right so the crosshair stays clear; the glowstick keeps the spot it has in the .blend.
  const holdRot = { rx: cam.rot[0], ry: cam.rot[1], rz: cam.rot[2] };
  const held = (type: string, blendName: string, pos: [number, number, number], scale: number, tags: string[] = []) =>
    k.add(type, 'mesh', { parent: camera.uid, x: pos[0], y: pos[1], z: pos[2], ...holdRot, sx: scale, sy: scale, sz: scale, visible: false, color: '#ffffff', mesh: { asset: obj(blendName), rotY: 0 }, collider: NOCOL, tags: ['viewmodel', ...tags] });
  held('HeldBread', 'BreadHold', [0.42, -0.36, -1.3], 1.3);
  held('HeldMilk', 'AlmondHold', [0.42, -0.36, -1.3], 1.3);
  held('HeldBandage', 'BandageHold', [0.42, -0.36, -1.3], 1.3);
  held('HeldMedkit', 'MedkitHold', [0.42, -0.36, -1.3], 1.3);
  held('HeldMaterial', 'BuildingMaterialHold', [0.55, -0.5, -1.4], 0.8);
  held('HeldGlowstick', 'GlowstickHold', [0.36, -0.12, -0.82], S, ['glow']);

  // ---- HUD (the user's icons)
  k.text('HealthBar', 'Health', 'tl', 16, 14, 16, '#ff5a5a', {}, { icon: TX.iHealth });
  k.text('HungerBar', 'Hunger', 'tl', 16, 50, 16, '#f2b45a', {}, { icon: TX.iHunger });
  k.text('ThirstBar', 'Thirst', 'tl', 16, 86, 16, '#5ac8f2', {}, { icon: TX.iThirst });
  k.text('Crosshair', '+', 'cc', 0, 0, 22, '#f4ecc8', { opacity: 70 });
  // Only the selected item is always shown; Tab opens the full inventory (and the survival time).
  k.text('HeldText', '', 'br', 18, 16, 14, '#e8dca0');
  const slots: [string, string, string][] = [['Slot1', 'Bread', TX.iBread], ['Slot2', 'Almond milk', TX.iThirst], ['Slot3', 'Bandage', TX.iBandage], ['Slot4', 'Medkit', TX.iHealth], ['Slot5', 'Plank', TX.iWood], ['Slot6', 'Wall', TX.iWood]];
  // Inventory: a centered column of panels (no overlap with the bars on the left or the item text bottom right).
  k.text('InvTitle', 'INVENTORY', 'cc', 0, -150, 15, '#f2e6b3', { visible: false, tags: ['inventory'] }, { panel: true, align: 'center' });
  slots.forEach(([name, label, icon], n) => k.text(name, `${n + 1} ${label}`, 'cc', 0, -100 + n * 46, 15, '#e8dca0', { visible: false, tags: ['inventory'] }, { icon, panel: true }));
  k.text('SurvivedText', 'Survived 0:00', 'cc', 0, 186, 13, '#cfc49a', { visible: false, tags: ['inventory'] }, { panel: true });
  k.text('InvHelp', '1-6 select · click use/place · right click take back · middle click rotate · E pick up · F throw glowstick', 'cc', 0, 232, 12, '#bdb38c', { visible: false, tags: ['inventory'] }, { panel: true });

  const P = (n: number) => `param(${n})`;
  const at = (dx: string, y: string, dz: string) => ({ x: `${P(0)} * chunk + ${dx}`, y, z: `${P(1)} * chunk + ${dz}` });
  const tagChunk = (type: string) => [B('object.set_var', { variable: 'cx', value: P(0) }, type), B('object.set_var', { variable: 'cz', value: P(1) }, type)];
  const pickSpot = () => B('var.set', { variable: 'spot', value: 'at(get(spots, room), int(random(len(get(spots, room)))))' });
  // Items appear on free floor spots of the room (precomputed from its walls), never inside a wall.
  const spawnItem = (type: string, chance: string) => E([B('system.random_chance', { percent: chance })], [pickSpot(), B('object.create', { object: type, ...at('at(spot, 0)', '0.02', 'at(spot, 1)') }), B('object.set_rotation', { rx: '0', ry: 'random(360)', rz: '0' }, type), ...tagChunk(type)]);
  const far = (type: string) => E([B('timer.every_x_seconds', { seconds: '1' }), B('object.pick_by_expression', { expression: 'abs(Self.cx - pcx) > 2 or abs(Self.cz - pcz) > 2' }, type)], [B('object.destroy', {}, type)]);
  const pickup = (type: string, verb: string, actions: any[]) => E([B('input.on_key_pressed', { key: 'E' }), B('object.is_within_distance', { distance: '2', other: 'Player' }, type), B('object.pick_nearest', { x: 'Player.X', y: 'Player.Y', z: 'Player.Z' }, type)], [...actions, B('ui.show_message', { text: `"${verb}"`, seconds: '1.2' }), B('audio.play', { sound: 'pickup' }), B('object.destroy', {}, type)]);
  // Using an item: the held view model lifts toward the face and drops back (eat / drink / apply).
  const HELD = ['HeldBread', 'HeldMilk', 'HeldBandage', 'HeldMedkit'];
  const use = (n: number, have: string, actions: any[]) => E([B('input.on_mouse_click', { button: 'left' }), B('system.if', { condition: `slot = ${n} and ${have} > 0` })], [
    B('anim.tween', { property: 'Y', value: '-0.12', duration: '0.18', ease: 'easeOut' }, HELD[n - 1]), B('anim.tween', { property: 'X', value: '0.15', duration: '0.18', ease: 'easeOut' }, HELD[n - 1]),
    B('var.subtract', { variable: have, value: '1' }), ...actions,
    B('system.wait', { seconds: '0.35' }),
    B('anim.tween', { property: 'Y', value: '-0.36', duration: '0.25', ease: 'easeInOut' }, HELD[n - 1]), B('anim.tween', { property: 'X', value: '0.42', duration: '0.25', ease: 'easeInOut' }, HELD[n - 1]),
  ]);
  const st = (s: string) => B('object.compare_var', { variable: 'state', op: '=', value: `"${s}"` }, 'Bacteria');
  const show = (type: string, cond: string) => E([B('system.if', { condition: cond })], [B('object.set_visible', { visible: 'visible' }, type)]);
  const ITEMS = ['Bread', 'AlmondMilk', 'Medkit', 'Bandage', 'Plank', 'BuildingMaterial', 'Glowstick'];

  const events = [
    G('Infinite generation', [
      E([B('function.on_function', { name: 'GenChunk' }), B('system.if', { condition: `not haskey(generated, ${P(0)} & "," & ${P(1)})` })], [
        B('dict.set', { variable: 'generated', key: `${P(0)} & "," & ${P(1)}`, value: 'true' }),
        // The start chunk is always room 13 (the one the player spawns in); others are random.
        B('var.set', { variable: 'room', value: `${P(0)} = 0 and ${P(1)} = 0 ? 13 : int(random(1, 26))` }),
        B('object.create', { object: 'Chunk', ...at('0', '0', '0') }), ...tagChunk('Chunk'),
        B('object.create_by_name', { name: '"Room" & room', ...at('0', '0', '0'), attach: 'Chunk' }),
        B('object.create', { object: 'Ceiling', ...at('0', String(CEIL_Y), '0') }), B('object.attach_to', { other: 'Chunk' }, 'Ceiling'),
      ], [
        spawnItem('Bread', '45'), spawnItem('AlmondMilk', '55'), spawnItem('Bandage', '35'), spawnItem('Medkit', '14'),
        spawnItem('Plank', '45'), spawnItem('BuildingMaterial', '30'), spawnItem('Glowstick', '25'),
      ]),
      // Rooms are made two chunks out (5x5), so long halls never look past the generated level; far ones are removed
      // beyond that (> 2). The 9 lamps light the 3x3 chunks nearest the player.
      E([B('system.on_start_of_layout'), B('system.for', { name: 'dx', start: '-2', end: '2' }), B('system.for', { name: 'dz', start: '-2', end: '2' })], [B('function.call', { name: 'GenChunk', args: 'loopindex("dx"), loopindex("dz")' })]),
      E([B('timer.every_x_seconds', { seconds: '0.4' })], [B('var.set', { variable: 'pcx', value: 'round(Player.X / chunk)' }), B('var.set', { variable: 'pcz', value: 'round(Player.Z / chunk)' })], [
        E([B('system.for', { name: 'dx', start: '-2', end: '2' }), B('system.for', { name: 'dz', start: '-2', end: '2' })], [B('function.call', { name: 'GenChunk', args: 'pcx + loopindex("dx"), pcz + loopindex("dz")' })]),
        E([B('system.for', { name: 'dx', start: '-1', end: '1' }), B('system.for', { name: 'dz', start: '-1', end: '1' })], [], [
          E([B('object.pick_by_expression', { expression: 'Self.slot = (loopindex("dx") + 1) * 3 + loopindex("dz") + 1' }, 'Lamp')], [B('object.set_position', { x: '(pcx + loopindex("dx")) * chunk', y: String(CEIL_Y - 0.25), z: '(pcz + loopindex("dz")) * chunk' }, 'Lamp')]),
        ]),
      ]),
      // Destroying a far chunk also destroys its room and ceiling (they are attached to it).
      E([B('timer.every_x_seconds', { seconds: '1' }), B('system.for_each', { object: 'Chunk' }), B('object.pick_by_expression', { expression: 'abs(Self.cx - pcx) > 2 or abs(Self.cz - pcz) > 2' }, 'Chunk')], [B('dict.delete', { variable: 'generated', key: 'Chunk.cx & "," & Chunk.cz' }), B('object.destroy', {}, 'Chunk')]),
      ...ITEMS.filter((t) => t !== 'Glowstick').map(far),
      // Glowsticks travel (they are thrown), so they are recycled by distance instead of by chunk.
      E([B('timer.every_x_seconds', { seconds: '1' }), B('object.is_within_distance', { distance: '60', other: 'Player' }, 'Glowstick', { invert: true })], [B('object.destroy', {}, 'Glowstick')]),
    ]),
    G('Survival', [
      E([B('system.on_start_of_layout')], [B('ui.show_message', { text: '"You noclipped out of reality…  (click to look around · Tab: inventory)"', seconds: '4' }), B('audio.set_effect', { effect: 'echo' })]),
      // Hold Tab for the inventory.
      E([B('input.on_key_pressed', { key: 'Tab' })], [B('ui.show_menu', { tag: 'inventory' }), B('object.set_visible', { visible: 'invisible' }, 'Crosshair'), B('object.set_visible', { visible: 'invisible' }, 'HeldText')]),
      E([B('input.on_key_released', { key: 'Tab' })], [B('ui.hide_menu', { tag: 'inventory' }), B('object.set_visible', { visible: 'visible' }, 'Crosshair'), B('object.set_visible', { visible: 'visible' }, 'HeldText')]),
      E([B('system.every_tick')], [
        B('var.add', { variable: 'survived', value: 'dt' }),
        B('ui.set_bar', { value: 'Player.Health.HP', max: '100' }, 'HealthBar'), B('ui.set_bar', { value: 'hunger', max: '100' }, 'HungerBar'), B('ui.set_bar', { value: 'thirst', max: '100' }, 'ThirstBar'),
        B('ui.set_text', { text: '"Survived " & floor(survived / 60) & ":" & zeropad(floor(survived % 60), 2)' }, 'SurvivedText'),
      ]),
      E([B('timer.every_x_seconds', { seconds: '1' })], [B('var.set', { variable: 'hunger', value: 'max(0, hunger - hungerRate)' }), B('var.set', { variable: 'thirst', value: 'max(0, thirst - thirstRate)' })], [
        // Starving or dehydrated: lose 1 health every 4 seconds (a warning first, not a quick death).
        E([B('system.if', { condition: '(hunger <= 0 or thirst <= 0) and floor(survived) % 4 = 0' })], [B('health.damage', { amount: '1' }, 'Player'), B('ui.show_message', { text: 'hunger <= 0 ? "You are starving" : "You are dehydrated"', seconds: '1.5' })]),
      ]),
      E([B('health.on_damaged', {}, 'Player')], [B('camera.shake', { intensity: '0.12', duration: '0.2' }), B('postfx.set_param', { effect: 'vignette', param: 'amount', value: '0.85' }), B('system.wait', { seconds: '0.3' }), B('postfx.set_param', { effect: 'vignette', param: 'amount', value: '0.45' })]),
      E([B('health.on_died', {}, 'Player')], [B('audio.play', { sound: 'lose' }), B('game.defeat', { title: '"You did not survive"', message: '"Survived " & floor(survived) & " s"' })]),
    ]),
    G('Items and inventory', [
      pickup('Bread', 'Bread', [B('var.add', { variable: 'bread', value: '1' })]),
      pickup('AlmondMilk', 'Almond milk', [B('var.add', { variable: 'milk', value: '1' })]),
      pickup('Bandage', 'Bandage', [B('var.add', { variable: 'bandages', value: '1' })]),
      pickup('Medkit', 'Medkit', [B('var.add', { variable: 'medkits', value: '1' })]),
      pickup('Plank', 'Plank (+1)', [B('var.add', { variable: 'planks', value: '1' })]),
      pickup('BuildingMaterial', 'Bundle of planks (+3)', [B('var.add', { variable: 'planks', value: '3' })]),
      ...[1, 2, 3, 4, 5, 6].map((n) => E([B('input.on_key_pressed', { key: String(n) })], [B('var.set', { variable: 'slot', value: String(n) })])),
      use(1, 'bread', [B('var.set', { variable: 'hunger', value: 'min(100, hunger + 35)' }), B('ui.show_message', { text: '"Ate bread (+35 hunger)"', seconds: '1.2' }), B('audio.play', { sound: 'pickup' })]),
      use(2, 'milk', [B('var.set', { variable: 'thirst', value: 'min(100, thirst + 40)' }), B('ui.show_message', { text: '"Drank almond milk (+40 thirst)"', seconds: '1.2' }), B('audio.play', { sound: 'pickup' })]),
      use(3, 'bandages', [B('health.heal', { amount: '15' }, 'Player'), B('ui.show_message', { text: '"Applied a bandage (+15 health)"', seconds: '1.2' }), B('audio.play', { sound: 'pickup' })]),
      use(4, 'medkits', [B('health.heal', { amount: '50' }, 'Player'), B('ui.show_message', { text: '"Used a medkit (+50 health)"', seconds: '1.2' }), B('audio.play', { sound: 'powerup' })]),
      // Inventory bar and the first-person view model of the selected item.
      E([B('system.every_tick')], [
        ...slots.map(([name, label], n) => B('ui.set_text', { text: `(slot = ${n + 1} ? "▶ " : "") & "${n + 1} ${label} ×" & ${['bread', 'milk', 'bandages', 'medkits', 'planks', 'floor(planks / 3)'][n]}` }, name)),
        B('ui.set_text', { text: 'slot = 1 ? "Bread ×" & bread : slot = 2 ? "Almond milk ×" & milk : slot = 3 ? "Bandage ×" & bandages : slot = 4 ? "Medkit ×" & medkits : slot = 5 ? "Plank ×" & planks & "  (middle click: rotate)" : "Wall ×" & floor(planks / 3) & "  (3 planks · middle click: rotate)"' }, 'HeldText'),
        ...['HeldBread', 'HeldMilk', 'HeldBandage', 'HeldMedkit', 'HeldMaterial', 'HeldGlowstick'].map((t) => B('object.set_visible', { visible: 'invisible' }, t)),
      ], [
        E([B('physics.is_holding', {}, 'Player')], [B('object.set_visible', { visible: 'visible' }, 'HeldGlowstick')]),
        E([], [], [show('HeldBread', 'slot = 1 and bread > 0'), show('HeldMilk', 'slot = 2 and milk > 0'), show('HeldBandage', 'slot = 3 and bandages > 0'), show('HeldMedkit', 'slot = 4 and medkits > 0'), show('HeldMaterial', 'slot >= 5 and planks >= 1')], { isElse: true }),
      ]),
    ]),
    G('Glowsticks', [
      E([B('input.on_key_pressed', { key: 'E' }), B('physics.is_holding', {}, 'Player', { invert: true })], [B('physics.grab_nearest', { object: 'Glowstick', distance: '2' }, 'Player')]),
      E([B('input.on_key_pressed', { key: 'F' }), B('physics.is_holding', {}, 'Player')], [B('physics.throw', { strength: '5', up: '2' }, 'Player'), B('audio.play', { sound: 'throw' })]),
      E([B('input.on_key_pressed', { key: 'G' }), B('physics.is_holding', {}, 'Player')], [B('physics.drop', {}, 'Player')]),
      // The carried glowstick is shown as the user's GlowstickHold view model; its light still follows it.
      E([B('system.every_tick')], [B('object.set_visible', { visible: 'visible' }, 'Glowstick')], [
        E([B('object.pick_by_expression', { expression: 'Self.Physics.IsHeld = 1' }, 'Glowstick')], [B('object.set_visible', { visible: 'invisible' }, 'Glowstick')]),
      ]),
      // Light pool: the 4 glowstick lights follow the 4 glowsticks nearest the player.
      E([B('system.every_tick')], [B('object.set_position', { x: '0', y: '-100', z: '0' }, 'GlowLight'), B('var.set', { variable: 'glowIndex', value: '0' })], [
        E([B('system.for_each', { object: 'Glowstick' }), B('object.is_within_distance', { distance: '30', other: 'Player' }, 'Glowstick')], [], [
          E([B('object.pick_by_expression', { expression: 'Self.slot = glowIndex' }, 'GlowLight')], [B('object.set_position', { x: 'Glowstick.X', y: 'Glowstick.Y + 0.25', z: 'Glowstick.Z' }, 'GlowLight')]),
          E([], [B('var.add', { variable: 'glowIndex', value: '1' })]),
        ]),
      ]),
    ]),
    // Building with planks: slot 5 places one plank (a barricade board), slot 6 a wall (3 planks).
    // The preview sits 2.4 m ahead on a 0.5 m grid, faces you, and the middle mouse button turns it 90°.
    G('Building', [
      E([B('input.on_mouse_click', { button: 'middle' }), B('system.if', { condition: 'slot >= 5' })], [B('var.set', { variable: 'buildRot', value: '(buildRot + 90) % 360' }), B('audio.play', { sound: 'click', volume: '40' })]),
      E([B('system.every_tick')], [B('object.set_visible', { visible: 'invisible' }, 'WallPreview'), B('object.set_visible', { visible: 'invisible' }, 'PlankPreview')], [
        E([B('system.if', { condition: 'slot = 6' })], [
          B('object.set_visible', { visible: 'visible' }, 'WallPreview'),
          B('object.set_position', { x: 'round((Player.X + cos(Player.Angle) * 2.4) * 2) / 2', y: '0', z: 'round((Player.Z - sin(Player.Angle) * 2.4) * 2) / 2' }, 'WallPreview'),
          B('object.set_rotation', { rx: '0', ry: 'round(Player.Angle / 90) * 90 + 90 + buildRot', rz: '0' }, 'WallPreview'),
        ]),
        E([B('system.if', { condition: 'slot = 5' })], [
          B('object.set_visible', { visible: 'visible' }, 'PlankPreview'),
          B('object.set_position', { x: 'round((Player.X + cos(Player.Angle) * 2) * 2) / 2', y: String(PLANK_Y), z: 'round((Player.Z - sin(Player.Angle) * 2) * 2) / 2' }, 'PlankPreview'),
          B('object.set_rotation', { rx: '0', ry: 'round(Player.Angle / 90) * 90 + 90 + buildRot', rz: '0' }, 'PlankPreview'),
        ]),
      ]),
      // Place
      E([B('input.on_mouse_click', { button: 'left' }), B('system.if', { condition: 'slot = 6' })], [], [
        E([B('system.if', { condition: 'planks >= 3' })], [
          B('object.create', { object: 'PlacableWall', x: 'WallPreview.X', y: '0', z: 'WallPreview.Z' }), B('object.set_rotation', { rx: '0', ry: 'WallPreview.RotY', rz: '0' }, 'PlacableWall'),
          B('var.subtract', { variable: 'planks', value: '3' }), B('audio.play', { sound: 'dig', volume: '60' }), B('particles.spawn_at', { preset: 'dust' }, 'PlacableWall'),
        ]),
        E([], [B('ui.show_message', { text: '"A wall needs 3 planks"', seconds: '1.2' })], [], { isElse: true }),
      ]),
      E([B('input.on_mouse_click', { button: 'left' }), B('system.if', { condition: 'slot = 5' })], [], [
        E([B('system.if', { condition: 'planks >= 1' })], [
          B('object.create', { object: 'PlacedPlank', x: 'PlankPreview.X', y: 'PlankPreview.Y', z: 'PlankPreview.Z' }), B('object.set_rotation', { rx: '0', ry: 'PlankPreview.RotY', rz: '0' }, 'PlacedPlank'),
          B('var.subtract', { variable: 'planks', value: '1' }), B('audio.play', { sound: 'hit', volume: '45' }),
        ]),
        E([], [B('ui.show_message', { text: '"No planks — pick some up (E)"', seconds: '1.2' })], [], { isElse: true }),
      ]),
      // Take back (refund)
      E([B('input.on_mouse_click', { button: 'right' }), B('system.if', { condition: 'slot = 6' }), B('object.is_within_distance', { distance: '3.5', other: 'Player' }, 'PlacableWall'), B('object.pick_nearest', { x: 'WallPreview.X', y: '0', z: 'WallPreview.Z' }, 'PlacableWall')], [B('object.destroy', {}, 'PlacableWall'), B('var.add', { variable: 'planks', value: '3' }), B('audio.play', { sound: 'hit', volume: '50' })]),
      E([B('input.on_mouse_click', { button: 'right' }), B('system.if', { condition: 'slot = 5' }), B('object.is_within_distance', { distance: '3.5', other: 'Player' }, 'PlacedPlank'), B('object.pick_nearest', { x: 'PlankPreview.X', y: 'PlankPreview.Y', z: 'PlankPreview.Z' }, 'PlacedPlank')], [B('object.destroy', {}, 'PlacedPlank'), B('var.add', { variable: 'planks', value: '1' }), B('audio.play', { sound: 'hit', volume: '50' })]),
    ]),
    // States: idle (pauses) → wander → hunt (sees you) → attack (in reach) → search (lost you: goes to where
    // it last saw you) → idle. Glowsticks make it flee from any state. Its walk clip plays at a speed that
    // matches the state, so it creeps while wandering and scuttles while hunting.
    G('Bacteria AI', [
      E([B('system.every_tick'), B('object.compare_var', { variable: 'cooldown', op: '>', value: '0' }, 'Bacteria')], [B('object.add_var', { variable: 'cooldown', value: '-dt' }, 'Bacteria')]),
      // Never far away: if it falls outside the generated area it re-appears 20-28 m from the player.
      E([B('system.every_tick'), B('object.is_within_distance', { distance: '40', other: 'Player' }, 'Bacteria', { invert: true })], [
        B('pathfinding.stop', {}, 'Bacteria'), B('object.set_position', { x: 'Player.X + choose(-1, 1) * random(20, 28)', y: '0', z: 'Player.Z + choose(-1, 1) * random(20, 28)' }, 'Bacteria'), B('ai.set_state', { state: 'idle' }, 'Bacteria'), B('timer.start', { tag: 'rest', duration: '1', mode: 'once' }, 'Bacteria'),
      ]),
      E([B('system.every_tick'), B('object.is_within_distance', { distance: '4.5', other: 'Glowstick' }, 'Bacteria'), B('object.compare_var', { variable: 'state', op: '<>', value: '"flee"' }, 'Bacteria')], [B('ai.set_state', { state: 'flee' }, 'Bacteria'), B('ai.flee', { other: 'Glowstick', distance: '10' }, 'Bacteria'), B('timer.start', { tag: 'calm', duration: '3', mode: 'once' }, 'Bacteria')]),
      E([B('timer.on_timer', { tag: 'calm' }, 'Bacteria')], [B('ai.set_state', { state: 'idle' }, 'Bacteria'), B('timer.start', { tag: 'rest', duration: '1.5', mode: 'once' }, 'Bacteria')]),
      // Detection works in every calm state (idle, wander, search), so wandering never stops it reacting.
      E([B('system.every_tick'), B('object.pick_by_expression', { expression: 'Self.state = "idle" or Self.state = "wander" or Self.state = "search"' }, 'Bacteria'),
        B('object.is_within_distance', { distance: 'huntDistance', other: 'Player' }, 'Bacteria'), B('pathfinding.has_line_of_sight', { other: 'Player' }, 'Bacteria')],
        [B('ai.set_state', { state: 'hunt' }, 'Bacteria'), B('pathfinding.move_to_object', { other: 'Player' }, 'Bacteria'), B('audio.play_at', { sound: 'explosion', volume: '20' }, 'Bacteria')]),
      // Idle: rest a moment, then pick a random spot to wander to.
      E([B('timer.on_timer', { tag: 'rest' }, 'Bacteria'), st('idle')], [B('ai.set_state', { state: 'wander' }, 'Bacteria'), B('pathfinding.find_path', { x: 'Self.X + random(-12, 12)', y: '0', z: 'Self.Z + random(-12, 12)' }, 'Bacteria')]),
      E([B('pathfinding.on_arrived', {}, 'Bacteria'), B('object.pick_by_expression', { expression: 'Self.state = "wander" or Self.state = "search"' }, 'Bacteria')], [B('ai.set_state', { state: 'idle' }, 'Bacteria'), B('timer.start', { tag: 'rest', duration: 'random(1.2, 3.5)', mode: 'once' }, 'Bacteria')]),
      E([B('pathfinding.on_failed', {}, 'Bacteria')], [B('ai.set_state', { state: 'idle' }, 'Bacteria'), B('timer.start', { tag: 'rest', duration: '0.8', mode: 'once' }, 'Bacteria')]),
      // Hunt: re-plan the route a few times a second (not every frame) and remember where the player was seen.
      E([B('system.every_tick'), st('hunt'), B('pathfinding.has_line_of_sight', { other: 'Player' }, 'Bacteria')], [B('object.set_var', { variable: 'lastX', value: 'Player.X' }, 'Bacteria'), B('object.set_var', { variable: 'lastZ', value: 'Player.Z' }, 'Bacteria')]),
      E([B('timer.every_x_seconds', { seconds: '0.4' }), st('hunt')], [B('pathfinding.move_to_object', { other: 'Player' }, 'Bacteria')]),
      // Attack when in reach.
      E([B('system.every_tick'), B('object.pick_by_expression', { expression: 'Self.state = "hunt" or Self.state = "attack"' }, 'Bacteria'), B('object.is_within_distance', { distance: '1.6', other: 'Player' }, 'Bacteria'), B('object.compare_var', { variable: 'cooldown', op: '<=', value: '0' }, 'Bacteria')],
        [B('ai.set_state', { state: 'attack' }, 'Bacteria'), B('health.damage', { amount: '10' }, 'Player'), B('object.set_var', { variable: 'cooldown', value: '1.6' }, 'Bacteria'), B('audio.play', { sound: 'hit' }), B('camera.shake', { intensity: '0.15', duration: '0.25' }), B('timer.start', { tag: 'recover', duration: '0.5', mode: 'once' }, 'Bacteria')]),
      E([B('timer.on_timer', { tag: 'recover' }, 'Bacteria'), st('attack')], [B('ai.set_state', { state: 'hunt' }, 'Bacteria')]),
      // Lost you (too far, or out of sight for a while): go and search where it last saw you.
      E([B('system.every_tick'), st('hunt'), B('object.is_within_distance', { distance: 'huntDistance * 2', other: 'Player' }, 'Bacteria', { invert: true })],
        [B('ai.set_state', { state: 'search' }, 'Bacteria'), B('pathfinding.find_path', { x: 'Self.lastX', y: '0', z: 'Self.lastZ' }, 'Bacteria')]),
      // Animation speed follows the state.
      E([B('system.every_tick')], [], [
        E([st('idle')], [B('anim.set_speed', { speed: '0.25' }, 'Bacteria')]),
        E([st('wander')], [B('anim.set_speed', { speed: '0.8' }, 'Bacteria')]),
        E([st('search')], [B('anim.set_speed', { speed: '1.1' }, 'Bacteria')]),
        E([st('hunt')], [B('anim.set_speed', { speed: '1.7' }, 'Bacteria')]),
        E([st('attack')], [B('anim.set_speed', { speed: '2.6' }, 'Bacteria')]),
        E([st('flee')], [B('anim.set_speed', { speed: '2' }, 'Bacteria')]),
      ]),
      E([B('system.on_start_of_layout')], [B('ai.set_state', { state: 'idle' }, 'Bacteria'), B('timer.start', { tag: 'rest', duration: '1', mode: 'once' }, 'Bacteria')]),
    ]),
    G('Lights out & Smilers', [
      // Every minute or two the lights fail: they flicker, die, and Smilers gather in the dark. Glowsticks keep them away.
      E([B('system.on_start_of_layout')], [B('var.set', { variable: 'nextBlackout', value: 'random(45, 80)' }), B('var.set', { variable: 'lightsOut', value: 'false' })]),
      E([B('system.every_tick'), B('system.is_boolean_set', { variable: 'lightsOut' }, undefined, { invert: true }), B('system.compare_values', { a: 'timescale', op: '>', b: '0' })], [B('var.subtract', { variable: 'nextBlackout', value: 'dt' })], [
        E([B('system.compare_variable', { variable: 'nextBlackout', op: '<=', value: '0' })], [
          B('var.set', { variable: 'lightsOut', value: 'true' }), B('var.set', { variable: 'darkLeft', value: 'random(18, 28)' }),
          B('light.flicker', { seconds: '1.6' }, 'Lamp'), B('audio.play', { sound: 'engine', volume: '40' }),
          B('system.wait', { seconds: '1.6' }),
          B('light.set_power', { value: '0' }, 'Lamp'), B('light.set_emission', { percent: '0' }), B('light.set_ambient', { value: '0.03' }),
          B('ui.show_message', { text: '"The lights went out…"', seconds: '2.5' }), B('audio.play', { sound: 'lose', volume: '35' }),
          B('system.wait', { seconds: '2' }),
          B('object.create', { object: 'Smiler', x: 'Player.X + choose(-1, 1) * random(7, 12)', y: '1.45', z: 'Player.Z + choose(-1, 1) * random(7, 12)' }),
          B('object.create', { object: 'Smiler', x: 'Player.X + choose(-1, 1) * random(9, 14)', y: '1.45', z: 'Player.Z + choose(-1, 1) * random(9, 14)' }),
          B('object.create', { object: 'Smiler', x: 'Player.X + choose(-1, 1) * random(11, 16)', y: '1.45', z: 'Player.Z + choose(-1, 1) * random(11, 16)' }),
        ]),
      ]),
      E([B('system.every_tick'), B('system.is_boolean_set', { variable: 'lightsOut' }), B('system.compare_values', { a: 'timescale', op: '>', b: '0' })], [B('var.subtract', { variable: 'darkLeft', value: 'dt' })], [
        E([B('system.compare_variable', { variable: 'darkLeft', op: '<=', value: '0' })], [
          B('light.set_power', { value: '340' }, 'Lamp'), B('light.flicker', { seconds: '0.8' }, 'Lamp'),
          B('light.set_emission', { percent: '100' }), B('light.set_ambient', { value: '0.32' }),
          B('object.destroy', {}, 'Smiler'),
          B('var.set', { variable: 'lightsOut', value: 'false' }), B('var.set', { variable: 'nextBlackout', value: 'random(70, 130)' }),
          B('ui.show_message', { text: '"The lights flicker back on."', seconds: '2' }),
        ]),
      ]),
      // Smilers always face you.
      E([B('system.every_tick')], [B('object.look_at', { other: 'Player' }, 'Smiler')]),
      // Smilers drift toward you in the dark, but stay out of glowstick light and back away from one you carry.
      E([B('system.every_tick'), B('system.is_boolean_set', { variable: 'lightsOut' }), B('object.is_within_distance', { distance: '4', other: 'Glowstick' }, 'Smiler', { invert: true }), B('physics.is_holding', {}, 'Player', { invert: true })],
        [B('object.move_toward', { distance: '1.5 * dt', x: 'Player.X', y: 'Self.Y', z: 'Player.Z' }, 'Smiler')]),
      E([B('system.every_tick'), B('system.is_boolean_set', { variable: 'lightsOut' }), B('physics.is_holding', {}, 'Player'), B('object.is_within_distance', { distance: '6', other: 'Player' }, 'Smiler')],
        [B('object.move_toward', { distance: '-2 * dt', x: 'Player.X', y: 'Self.Y', z: 'Player.Z' }, 'Smiler')]),
      E([B('system.every_tick'), B('object.is_within_distance', { distance: '1.1', other: 'Player' }, 'Smiler')],
        [B('health.damage', { amount: '25' }, 'Player'), B('camera.shake', { intensity: '0.35', duration: '0.5' }), B('audio.play', { sound: 'hit' }), B('object.destroy', {}, 'Smiler')]),
    ]),
    E([B('input.on_key_pressed', { key: 'R' })], [B('game.restart')]),
  ];

  // Free floor spots per room, in meters relative to the room center (from scripts/blend-assets.ts).
  const spots: Record<string, number[][]> = {};
  for (let n = 1; n <= 25; n++) spots[String(n)] = ROOMS['p' + n].spots.map((s) => [Math.round(s[0] * S * 100) / 100, Math.round(s[1] * S * 100) / 100]);

  const model = (name: string, settings: Partial<AssetImportSettings>): AssetRef => ({ id: obj(name), name, kind: 'model', source: 'library', importSettings: { ...DEFAULT_IMPORT, ...settings } });
  const blendAssets: AssetRef[] = [
    ...Array.from({ length: 25 }, (_, n) => model('p' + (n + 1), ROOM_SETTINGS)),
    model('Ceiling', ROOM_SETTINGS),
    ...['Bread', 'AlmondMilk', 'Medkit', 'Bandage', 'Plank', 'BuildingMaterial', 'PlacableWall', 'WallPreview', 'PlankPreview', 'BacteriaaM.002'].map((n) => model(n, ITEM_SETTINGS)),
    model('Glowstick', GLOW_ITEM_SETTINGS),
    ...['BreadHold', 'AlmondHold', 'BandageHold', 'MedkitHold', 'BuildingMaterialHold'].map((n) => model(n, HOLD_SETTINGS)),
    model('GlowstickHold', { ...HOLD_SETTINGS, materialOverrides: GLOW_GREEN }),
    model('Smiler(new).002', SMILER_SETTINGS),
  ];
  return makeProject({
    name: 'Backrooms', template: 'backrooms', scenes: [k.scene], events, plane: 'xz',
    globals: [v('chunk', TILE), v('pcx', 0), v('pcz', 0), v('generated', {}), v('room', 13), v('spot', [0, 0]), v('spots', spots),
      // Per second: hunger lasts ~14 minutes, thirst ~10 minutes from full.
      v('hunger', 100), v('thirst', 100), v('hungerRate', 0.12), v('thirstRate', 0.17), v('survived', 0),
      v('slot', 1), v('bread', 0), v('milk', 1), v('bandages', 0), v('medkits', 0), v('planks', 4), v('buildRot', 0), v('glowIndex', 0),
      v('huntDistance', 10, 'The bacteria starts hunting when you come this close (m) and it can see you'),
      v('lightsOut', false, 'True during a blackout (Smilers are out)'), v('nextBlackout', 60, 'Seconds until the next blackout'), v('darkLeft', 0, 'Seconds the current blackout lasts')],
    extraAssets: [...Object.values(TX).map((id) => ({ id, name: id.split('/').pop()!, kind: 'texture' as const, source: 'library' as const })), ...blendAssets],
    tutorial: [
      { title: 'Survive', text: 'First person: click the view to look around with the mouse. Pick up bread and almond milk (E), select them with 1-5 and left click to eat or drink before hunger and thirst run out. Bandages and medkits heal.', target: 'play' },
      { title: 'The bacteria', text: 'Your bacteria model wanders until it sees you, then hunts you around walls with pathfinding. Throw a glowstick near it (E pick up, F throw) and it flees.', target: 'eventsheet' },
      { title: 'Lights out', text: 'Every minute or two the lights flicker and die. Smilers creep toward you in the dark: stay near a glowstick or carry one to keep them back. The lights come back after about 20 seconds. See the "Lights out & Smilers" group.', target: 'eventsheet' },
      { title: 'Build', text: 'Pick up planks (E): a plank gives 1, a bundle 3. Press 5 to place a single plank (a barricade board) or 6 to place a wall (3 planks) where the preview shows. Middle click rotates it, right click takes it back. Walls block the monster.', target: 'play' },
      { title: 'Infinite generation', text: 'GenChunk picks one of your 25 rooms with "Create object by name" and attaches it to a Chunk; far chunks are destroyed with their room and ceiling. Items appear only on free floor spots.', target: 'eventsheet' },
      { title: 'Your .blend', text: 'Everything here is read straight from Backrooms_V10.blend (asset-library/backrooms) - no Blender needed. Click the .blend in the Assets panel to see all its objects; drop any of them into a scene.', target: 'assets' },
    ],
  });
}
