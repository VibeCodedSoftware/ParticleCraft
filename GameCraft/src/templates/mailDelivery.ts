// Template: mail delivery. Drive the mail truck in first person (seated, hands on the wheel), get out (E): the
// driver's door swings open, the camera moves behind you (third person) and the back doors open. Walk up the rear
// steps into the truck, take a parcel from the cargo floor (F) and carry it in both hands to a resident waiting by
// their house (E): they ask "Do you have my package?" (Yes / No, from the Dialogue editor). Deliver every parcel.
import { B, E, G, Kit, LIB, animatedHuman, bh, makeProject, v } from './kit';
import type { DialogueDef } from '@shared/src/schema';

const HOUSES: { x: number; z: number; model: string; name: string; shirt: string }[] = [
  { x: -16, z: -22, model: 'House 1', name: 'Mrs. Hill', shirt: '#c0504d' },
  { x: 16, z: -38, model: 'House 2', name: 'Mr. Okafor', shirt: '#e0a33a' },
  { x: -16, z: -58, model: 'House 3', name: 'Ms. Rivera', shirt: '#7a5ab8' },
  { x: 16, z: -78, model: 'House 4', name: 'The Novaks', shirt: '#3fa37a' },
];
/** The rest of the street: houses with nobody waiting. */
const NEIGHBOURS: { x: number; z: number; model: string }[] = [
  { x: 16, z: -14, model: 'House 5' },
  { x: -16, z: -40, model: 'House 6' },
  { x: -16, z: -80, model: 'House 7' },
];
/** Houses.blend: modelled with the door on +X. This scale makes the door about 2.3 m tall. */
const HOUSE_FILE = 'lib:library/mail-delivery/Houses.blend';
const HOUSE_SCALE = 0.5;
/** Footprints in model units: the longer houses are 3, 6 and 7. */
const HOUSE_SIZE: Record<string, [number, number, number]> = { 'House 3': [13.75, 14.82, 18.55], 'House 6': [13.75, 14.82, 18.55], 'House 7': [13.75, 14.82, 18.55] };

/** The truck model is ~1516 x 798 x 822 units; at this scale the cargo area is tall enough to stand in. */
const TRUCK_SCALE = 0.004;
/**
 * Truck collision in model units (x forward, y up, z right; [centre x, y, z, size x, y, z]): the chassis/floor, both
 * walls, the roof, the dashboard, the driver's seat and two steps up to the open back. The back stays open.
 */
const TRUCK_BOXES: number[][] = [
  [9.5, 156, 0, 1497, 312, 804], // chassis + cargo floor (top 1.25 m)
  [9.5, 555, -391, 1497, 486, 22], [9.5, 555, 391, 1497, 486, 22], // walls
  [9.5, 784, 0, 1497, 28, 804], // roof
  [588, 555, 0, 340, 486, 804], // dashboard / bonnet
  [88, 452, -172, 313, 388, 350], // driver's seat
  [-794.5, 100, 0, 111, 200, 500], [-915, 50, 0, 130, 100, 500], // rear steps (0.8 m, 0.4 m)
];

export function mailDeliveryTemplate() {
  const k = new Kit('Street', '3d');
  k.scene.settings.background = '#a9d0f0';
  k.scene.settings.world = { color: '#c4dcf2', strength: 0.75, viewTransform: 'agx', exposure: 0, fogEnabled: true, fogColor: '#cfe0ef', fogDensity: 0.006 };
  k.box('Ground', 0, -0.5, -45, 120, 1, 140, '#78ad5a');
  k.box('Road', 0, 0.01, -45, 9, 0.02, 120, '#45494f', false, { collider: { shape: 'none', size: [1, 1, 1], offset: [0, 0, 0] } });
  for (let z = 10; z > -100; z -= 8) k.box('Stripe', 0, 0.03, z, 0.25, 0.02, 3, '#f2e6b3', false, { collider: { shape: 'none', size: [1, 1, 1], offset: [0, 0, 0] } });

  // The houses from Houses.blend, each with its door to the road and a path from the road to it.
  const house = (h: { x: number; z: number; model: string }) => {
    const side = Math.sign(h.x);
    const size = HOUSE_SIZE[h.model] ?? [12.8, 14.82, 13.57];
    k.model('House', { asset: `${HOUSE_FILE}#${h.model}`, size }, HOUSE_SCALE, { x: h.x + side * 3, y: 0, z: h.z, ry: side < 0 ? 0 : 180, behaviors: [bh('solid')] });
    const door = h.x + side * (3 - (size[0] * HOUSE_SCALE) / 2), road = side * 4.5;
    k.box('Path', (door + road) / 2, 0.03, h.z, Math.abs(door - road), 0.02, 1.6, '#b9a98a', false, { collider: { shape: 'none', size: [1, 1, 1], offset: [0, 0, 0] } });
  };
  NEIGHBOURS.forEach(house);
  // Each delivery house has its resident waiting outside (a coloured low-poly human) to be handed their parcel (E).
  HOUSES.forEach((h, n) => {
    const side = Math.sign(h.x);
    house(h);
    k.model('Resident', LIB.humanAnim, 1, {
      name: h.name, x: h.x - side * 3.2, y: 0, z: h.z + 1.4, ry: side > 0 ? 180 : 0, color: h.shirt, mesh: { ...animatedHuman(true), animMap: { ...animatedHuman().animMap, idle: 'Idle_Talking_Loop' } },
      vars: { house: n + 1, waiting: true },
      collider: { shape: 'box', size: [0.6, 1.8, 0.6], offset: [0, 0.9, 0] },
      behaviors: [bh('solid'), bh('interactable', { prompt: 'Press E to hand over the parcel', distance: 2.2, key: 'E' })],
    });
  });
  k.typeVars('Resident', [v('house', 0), v('waiting', true)]);

  // The mail truck: Car handling + Vehicle (first person from the driver's seat; the driver's door, Door1, swings
  // open while getting in or out). Walls, floor and steps are compound collision boxes, so you can walk inside.
  const truck = k.model('Truck', LIB.mailTruck, TRUCK_SCALE, {
    name: 'Truck', x: 3.2, y: 0, z: 6, ry: 90, mesh: { asset: LIB.mailTruck.asset, rotY: -90 },
    collider: { shape: 'box', size: [1516, 798, 822], offset: [0, 399, 0], boxes: TRUCK_BOXES as any },
    behaviors: [
      bh('solid'),
      bh('car', { maxSpeed: 15, acceleration: 8, braking: 24, steerSpeed: 85, drift: 0.06 }),
      bh('vehicle', {
        driver: 'Player', camera: 'first person', hideDriver: false, seatedAnim: 'drive', seatEye: 1.35, seatEyeForward: -0.3,
        seatX: 0.42, seatY: 1.12, seatZ: -0.69, exitX: 0.6, exitY: 0, exitZ: -2.3, enterDistance: 1.8, transition: 0.6,
        doorPart: 'Door1', doorHinge: 'front edge', doorAngle: -75, parkSnap: 90,
      }),
    ],
  }, [6, 3.2, 3.3]);
  // Parcels on the cargo floor (children of the truck, so they ride along; positions in the truck's model units).
  const PARCELS: [number, number][] = [[-560, -250], [-560, 240], [-380, -250], [-380, 240]];
  PARCELS.forEach(([px, pz], n) => k.add('Parcel', 'box', {
    name: 'Parcel ' + (n + 1), parent: truck.uid, x: px, y: 342, z: pz, sx: 85, sy: 60, sz: 80, color: n % 2 ? '#c49a62' : '#b9874f',
    collider: { shape: 'none', size: [1, 1, 1], offset: [0, 0, 0] },
    behaviors: [bh('interactable', { prompt: 'Press F to take the parcel', key: 'F', distance: 1.3 })],
  }));
  // Visible rear steps (the collision is part of the truck's own boxes).
  k.add('Step', 'box', { parent: truck.uid, x: -794.5, y: 190, z: 0, sx: 111, sy: 20, sz: 500, color: '#3a3d42', collider: { shape: 'none', size: [1, 1, 1], offset: [0, 0, 0] } });
  k.add('Step', 'box', { parent: truck.uid, x: -915, y: 90, z: 0, sx: 130, sy: 20, sz: 500, color: '#3a3d42', collider: { shape: 'none', size: [1, 1, 1], offset: [0, 0, 0] } });

  // The back doors' handle: press G at the back of the truck. Shut (the start), this box is solid and keeps you out.
  k.add('BackDoors', 'box', {
    name: 'BackDoors', parent: truck.uid, x: -745, y: 400, z: 0, sx: 16, sy: 700, sz: 640, visible: false, color: '#ffffff',
    collider: { shape: 'box', size: [1, 1, 1], offset: [0, 0, 0] },
    behaviors: [bh('solid'), bh('interactable', { prompt: 'Press G: back doors', key: 'G', distance: 2.2 })],
  });

  // The postie: an animated low-poly human in a blue uniform. Third person on foot, first person at the wheel.
  const player = k.model('Player', LIB.humanAnim, 1, {
    name: 'Player', x: 1.2, y: 0, z: 6, ry: 90, color: '#2f5fa0', mesh: animatedHuman(true),
    collider: { shape: 'box', size: [0.55, 1.7, 0.55], offset: [0, 0.85, 0] },
    behaviors: [bh('platform', { maxSpeed: 4.2, runMultiplier: 1.6, jumpStrength: 5, stepHeight: 0.5 })],
  });
  // The parcel in your hands (shown while carrying one): HELD_BOX, where the carrying clips put the hands (the model
  // faces +Z and is turned 90°, so its Z is the player's X).
  k.add('HeldParcel', 'box', { parent: player.uid, x: 0.34, y: 0.98, z: 0, sx: 0.3, sy: 0.26, sz: 0.4, color: '#b9874f', visible: false, collider: { shape: 'none', size: [1, 1, 1], offset: [0, 0, 0] } });
  k.camera({ x: -4, y: 2.5, z: 6 }, { focalLength: 26, clipStart: 0.05, clipEnd: 260 }, { target: 'Player', firstPerson: false, orbitWithMouse: true, distance: 4.2, offsetY: 1.9, lookAt: true, avoidWalls: true, sensitivity: 0.2, eyeHeight: 1.62 });
  k.sun(3.2, -50, 35, { behaviors: [bh('follow', { target: 'Player', offsetX: 10, offsetY: 30, offsetZ: 20, lookAt: false, smoothing: 0 })] });

  k.text('DeliveredText', 'Delivered 0 / 4', 'tl', 16, 12, 24, '#ffffff', {}, { style: { bold: true, outline: '#22313f', outlineWidth: 3 } });
  k.text('CarryText', '', 'tl', 16, 46, 18, '#ffe7a8');
  k.text('Hint', 'E: get in / out of the truck · hand over parcels   G: open / shut the back doors   F: take a parcel (inside the truck)   W/A/S/D drive or walk', 'bc', 0, 14, 14, '#eef4fa');

  const BACK_DOORS = (open: boolean) => [
    B('model.rotate_part', { part: 'Door3', angle: open ? '-100' : '0', hinge: 'left edge', seconds: '0.7' }, 'Truck'),
    B('model.rotate_part', { part: 'Door4', angle: open ? '100' : '0', hinge: 'right edge', seconds: '0.7' }, 'Truck'),
  ];
  const CARRY = (on: boolean) => [
    B('anim.set_role', { role: 'idle', clip: on ? 'Hold_Box_Idle' : '' }, 'Player'),
    B('anim.set_role', { role: 'walk', clip: on ? 'Hold_Box_Walk' : '' }, 'Player'),
    B('anim.set_role', { role: 'run', clip: on ? 'Hold_Box_Walk' : '' }, 'Player'),
    B('object.set_visible', { visible: on ? 'visible' : 'invisible' }, 'HeldParcel'),
    B('ui.set_text', { text: on ? '"Carrying a parcel"' : '""' }, 'CarryText'),
  ];
  const events = [
    G('Start the round', [
      E([B('system.on_start_of_layout')], [
        B('input.set_cursor', { mode: 'locked' }),
        B('vehicle.enter', { vehicle: 'Truck' }, 'Player'),
        B('ui.show_message', { text: '"Morning shift! 4 parcels to deliver. Drive to a house, get out (E), open the back doors (G), take a parcel (F) and hand it over (E)."', seconds: '5' }),
      ]),
    ]),
    G('The back doors', [
      // Yours to open and shut: stand at the back of the truck and press G. Shut, they also block the way in.
      E([B('interact.on_interact', {}, 'BackDoors')], [], [
        E([B('system.is_boolean_set', { variable: 'backOpen' }, undefined, { invert: true })], [
          B('var.set', { variable: 'backOpen', value: 'true' }), ...BACK_DOORS(true),
          B('behavior.set_enabled', { behavior: 'solid', state: 'disabled' }, 'BackDoors'), B('audio.play', { sound: 'click', volume: '60' }),
        ]),
        E([], [
          B('var.set', { variable: 'backOpen', value: 'false' }), ...BACK_DOORS(false),
          B('behavior.set_enabled', { behavior: 'solid', state: 'enabled' }, 'BackDoors'), B('audio.play', { sound: 'click', volume: '60' }),
        ], [], { isElse: true }),
      ]),
    ]),
    G('Parcels', [
      E([B('interact.on_interact', {}, 'Parcel')], [], [
        E([B('system.is_boolean_set', { variable: 'carrying' }, undefined, { invert: true })], [
          B('var.set', { variable: 'carrying', value: 'true' }),
          B('object.destroy', {}, 'Parcel'),
          ...CARRY(true),
          B('audio.play', { sound: 'pickup', volume: '70' }),
        ]),
        E([], [B('ui.show_message', { text: '"Your hands are full."', seconds: '1.5' })], [], { isElse: true }),
      ]),
    ]),
    G('Handing over', [
      E([B('interact.on_interact', {}, 'Resident')], [], [
        E([B('object.compare_var', { variable: 'waiting', op: '=', value: 'true' }, 'Resident')], [
          B('var.set', { variable: 'house', value: 'Resident.house' }),
          B('object.look_at', { other: 'Player' }, 'Resident'),
          B('input.set_cursor', { mode: 'visible' }),
          B('dialogue.start', { dialogue: 'Package', wait: false }),
        ]),
        E([], [B('ui.show_message', { text: '"Thanks again for the parcel!"', seconds: '1.8' })], [], { isElse: true }),
      ]),
    ]),
    G('The conversation', [
      // "Yes" (only possible when you are carrying one; otherwise the resident is disappointed).
      E([B('dialogue.on_event', { name: 'delivered' })], [], [
        E([B('system.is_boolean_set', { variable: 'carrying' })], [
          B('var.set', { variable: 'carrying', value: 'false' }),
          B('var.add', { variable: 'delivered', value: '1' }),
          ...CARRY(false),
          B('ui.set_text', { text: '"Delivered " & delivered & " / 4"' }, 'DeliveredText'),
          B('audio.play', { sound: 'coin', volume: '70' }),
        ], [
          E([B('object.pick_by_expression', { expression: 'Self.house = house' }, 'Resident')], [
            B('object.set_var', { variable: 'waiting', value: 'false' }, 'Resident'),
            B('interact.set_prompt', { text: '""' }, 'Resident'),
            B('anim.set_role', { role: 'idle', clip: 'Idle_Loop' }, 'Resident'),
          ]),
        ]),
        E([], [B('ui.show_message', { text: '"You don\'t have a parcel - take one from the back of the truck (F)."', seconds: '2.5' })], [], { isElse: true }),
      ]),
      E([B('dialogue.on_end')], [B('input.set_cursor', { mode: 'locked' })], [
        E([B('system.compare_variable', { variable: 'delivered', op: '>=', value: '4' })], [B('system.wait', { seconds: '0.8' }), B('audio.play', { sound: 'win', volume: '80' }), B('game.victory', { title: '"Round complete!"', message: '"Every parcel delivered."' })]),
      ]),
    ]),
  ];
  const dialogue: DialogueDef = {
    id: 'dlg_package', name: 'Package', start: 'q',
    nodes: [
      { id: 'q', speaker: 'Resident', text: 'Oh, hello! Do you have my package?', choices: [{ id: 'yes', text: 'Yes, here you go!', to: 'thanks' }, { id: 'no', text: 'No, sorry.', to: 'sad' }], x: 40, y: 40 },
      { id: 'thanks', speaker: 'Resident', text: 'Wonderful, thank you so much! Have a nice day.', choices: [], event: 'delivered', end: true, x: 300, y: 0 },
      { id: 'sad', speaker: 'Resident', text: 'Oh... I\'ll keep waiting then.', choices: [], end: true, x: 300, y: 120 },
    ],
  };
  const p = makeProject({
    name: 'Mail Delivery', template: 'maildelivery', scenes: [k.scene], events, plane: 'xz',
    globals: [v('carrying', false), v('backOpen', false), v('delivered', 0), v('house', 0)],
    tutorial: [
      { title: 'Your round', text: 'Press Play. You start at the wheel of the mail truck (first person): drive with W/A/S/D, stop by a house and press E to get out. The camera moves behind you. At the back of the truck, G opens and shuts its doors.', target: 'play' },
      { title: 'Parcels', text: 'Walk up the steps at the back into the truck, stand by a parcel and press F: you carry it in both hands. Walk to the resident outside the house and press E to hand it over. They ask for their package: answer Yes.', target: 'play' },
      { title: 'How the truck works', text: 'Select the Truck: Car is the handling; Vehicle makes it enterable (seat, door, first-person camera, the Door1 part that swings open, park straight). Its collision is a set of boxes (floor, walls, roof, steps), so you can walk inside. The parcels are its children and ride along.', target: 'inspector' },
      { title: 'Doors and carrying', text: 'The "The back doors" group swings the rear doors when you press G (Rotate model part: Door3 / Door4), and switches off the solid BackDoors box so you can walk in. "Set animation role" swaps the Player\'s idle and walk for the box-carrying clips while holding a parcel.', target: 'eventsheet' },
    ],
  });
  p.logic.dialogues = [dialogue];
  return p;
}
