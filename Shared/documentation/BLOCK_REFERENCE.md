# Block compatibility reference

_Generated from `Shared/src/blocks/definitions.ts` by `npm run gen:docs` — do not edit by hand._

200 blocks in 19 categories. Every block has exactly one runtime implementation (`Shared/src/runtime/blockImpl.ts`) used by both apps.

Legend: **GC** = GameCraft, **LC** = LogicCraft. ⚡ trigger, ↻ looping condition. "C2" is the matching Construct 2 condition/action. "Export" lists source-code exporters that translate the block (others mark it UNSUPPORTED).

## ⚡ Events

Triggers that start an event: scene start, collisions, timers, custom events.

| ID | Kind | Name | Parameters (default) | Apps | Construct 2 | Export |
|---|---|---|---|---|---|---|
| `system.on_start_of_layout` | ⚡ trigger | On start of scene | — | GC LC | System: On start of layout | all |
| `system.on_game_start` | ⚡ trigger | On game start | — | GC LC |  | all |
| `system.every_tick` | condition | Every tick | — | GC LC | System: Every tick | all |
| `system.on_fixed_update` | ⚡ trigger | On fixed physics update | — | GC LC |  | — |
| `system.on_signal` | ⚡ trigger | On custom event | name: text (`my_event`) | GC LC | System: On signal | all |
| `object.on_collision` | ⚡ trigger | On collision with | **object**<br>other: objectType (`Coin`) | GC LC | Object: On collision with another object | — |
| `object.on_collision_end` | ⚡ trigger | On collision exited | **object**<br>other: objectType (`Coin`) | GC LC |  | — |
| `object.on_trigger_enter` | ⚡ trigger | On trigger entered | **object**<br>other: objectType (`Zone`) | GC LC |  | — |
| `object.on_created` | ⚡ trigger | On created | **object** | GC LC | Object: On created | — |
| `object.on_destroyed` | ⚡ trigger | On destroyed | **object** | GC LC | Object: On destroyed | — |
| `var.on_changed` | ⚡ trigger | On variable changed | variable: variable (`score`) | GC LC |  | — |

## ⌨ Input

Keyboard and mouse.

| ID | Kind | Name | Parameters (default) | Apps | Construct 2 | Export |
|---|---|---|---|---|---|---|
| `object.on_clicked` | ⚡ trigger | On object clicked | **object** | GC LC | Mouse: On object clicked | — |
| `input.on_key_pressed` | ⚡ trigger | On key pressed | key: key (`Space`) | GC LC | Keyboard: On key pressed | all |
| `input.on_key_released` | ⚡ trigger | On key released | key: key (`Space`) | GC LC | Keyboard: On key released | all |
| `input.key_is_down` | condition | Key is down | key: key (`ArrowRight`) | GC LC | Keyboard: Key is down | all |
| `input.on_mouse_click` | ⚡ trigger | On mouse click | button: mouse (`left`) | GC LC | Mouse: On click | — |
| `input.mouse_is_down` | condition | Mouse button is down | button: mouse (`left`) | GC LC | Mouse: Mouse button is down | — |

## ◇ Conditions

Tests and comparisons. Several conditions = AND; right-click the event for OR; invert for NOT.

| ID | Kind | Name | Parameters (default) | Apps | Construct 2 | Export |
|---|---|---|---|---|---|---|
| `system.if` | condition | If | condition: expr (`score > 10`) | GC LC |  | all |
| `system.compare_values` | condition | Compare two values | a: expr (`0`)<br>op: compare (`=`)<br>b: expr (`0`) | GC LC | System: Compare two values | all |
| `system.compare_variable` | condition | Compare variable | variable: variable (`score`)<br>op: compare (`=`)<br>value: expr (`0`) | GC LC | System: Compare variable | all |
| `system.is_boolean_set` | condition | Is boolean set | variable: variable (`isPaused`) | GC LC | System: Is boolean set | all |
| `system.trigger_once` | condition | Trigger once while true | — | GC LC | System: Trigger once while true | — |
| `system.random_chance` | condition | Random chance | percent: expr (`50`) | GC LC |  | all |
| `system.object_exists` | condition | Object exists | object: objectType (`Enemy`) | GC LC |  | all |
| `system.compare_count` | condition | Compare object count | object: objectType (`Enemy`)<br>op: compare (`=`)<br>value: expr (`0`) | GC LC |  | all |
| `object.compare_property` | condition | Compare property | **object**<br>property: choice (`X`)<br>op: compare (`=`)<br>value: expr (`0`) | GC LC | Object: Compare X / Y / Angle / Opacity | all |
| `object.compare_var` | condition | Compare instance variable | **object**<br>variable: instanceVar (`health`)<br>op: compare (`=`)<br>value: expr (`0`) | GC LC | Object: Compare instance variable | all |
| `object.is_var_true` | condition | Is boolean instance variable set | **object**<br>variable: instanceVar (`active`) | GC LC | Object: Is boolean instance variable set | all |
| `object.is_visible` | condition | Is visible | **object** | GC LC | Object: Is visible | — |
| `object.is_overlapping` | condition | Is overlapping | **object**<br>other: objectType (`Enemy`) | GC LC | Object: Is overlapping another object | — |
| `object.is_within_distance` | condition | Is within distance | **object**<br>distance: expr (`3`)<br>other: objectType (`Player`) | GC LC |  | — |
| `object.is_moving` | condition | Is moving | **object** | GC LC | Platform/8Direction: Is moving | — |
| `object.has_tag` | condition | Has tag | **object**<br>tag: text (`enemy`) | GC LC |  | — |
| `object.pick_nearest` | condition | Pick nearest | **object**<br>x: expr (`Player.X`)<br>y: expr (`Player.Y`)<br>z: expr (`Player.Z`) | GC LC | Object: Pick nearest/furthest | — |
| `object.pick_by_uid` | condition | Pick by UID | **object**<br>uid: expr (`0`) | GC LC | Object: Pick by unique ID | — |
| `object.pick_random` | condition | Pick random instance | **object** | GC LC | System: Pick random instance | — |
| `object.pick_by_expression` | condition | Pick by evaluate | **object**<br>expression: expr (`Self.X > 0`) | GC LC | System: Pick by evaluate | — |
| `object.pick_all` | condition | Pick all | **object** | GC LC | System: Pick all | — |
| `platform.is_on_floor` | condition | Is on floor | **object** | GC LC | Platform: Is on floor | — |
| `platform.is_jumping` | condition | Is jumping | **object** | GC LC | Platform: Is jumping | — |
| `platform.is_falling` | condition | Is falling | **object** | GC LC | Platform: Is falling | — |

## ↻ Loops & flow

Repeat, While, For, For each, Wait and Stop loop.

| ID | Kind | Name | Parameters (default) | Apps | Construct 2 | Export |
|---|---|---|---|---|---|---|
| `system.repeat` | ↻ loop | Repeat | count: expr (`10`) | GC LC | System: Repeat | all |
| `system.while` | ↻ loop | Repeat while | condition: expr (`i < 10`) | GC LC | System: While | all |
| `system.for` | ↻ loop | For | name: text (`i`)<br>start: expr (`0`)<br>end: expr (`9`) | GC LC | System: For | all |
| `system.for_each` | ↻ loop | For each object | object: objectType (`Enemy`) | GC LC | System: For each | all |
| `system.for_each_ordered` | ↻ loop | For each (ordered) | object: objectType (`Enemy`)<br>value: expr (`Self.X`)<br>order: choice (`ascending`) | GC LC | System: For each (ordered) | — |
| `list.for_each_item` | ↻ loop | For each item | variable: variable (`inventory`) | GC LC |  | JS Py Lua |
| `system.wait` | action | Wait | seconds: expr (`1`) | GC LC | System: Wait | — |
| `system.wait_until` | action | Wait until | condition: expr (`Player.X > 5`) | GC LC | System: Wait for condition | — |
| `system.repeat_until` | condition (loop) | Repeat until | condition: expr (`i >= 10`) | GC LC | System: While (inverted) | — |
| `system.forever` | condition | Forever |  | GC LC | System: Every tick | — |
| `system.stop_loop` | action | Stop loop | — | GC LC | System: Stop loop | — |

## 𝑥 Variables

Global, local and instance variables.

| ID | Kind | Name | Parameters (default) | Apps | Construct 2 | Export |
|---|---|---|---|---|---|---|
| `var.set` | action | Set value | variable: variable (`score`)<br>value: expr (`0`) | GC LC | System: Set value | all |
| `var.add` | action | Add to | variable: variable (`score`)<br>value: expr (`1`) | GC LC | System: Add to | all |
| `var.subtract` | action | Subtract from | variable: variable (`score`)<br>value: expr (`1`) | GC LC | System: Subtract from | all |
| `var.toggle` | action | Toggle boolean | variable: variable (`isPaused`) | GC LC | System: Toggle boolean | all |
| `object.set_var` | action | Set instance variable | **object**<br>variable: instanceVar (`health`)<br>value: expr (`0`) | GC LC | Object: Set instance variable | all |
| `object.add_var` | action | Add to instance variable | **object**<br>variable: instanceVar (`health`)<br>value: expr (`1`) | GC LC | Object: Add to instance variable | all |
| `object.toggle_var` | action | Toggle instance boolean | **object**<br>variable: instanceVar (`active`) | GC LC |  | all |
| `game.save` | action | Save variables | slot: text (`save1`) | GC LC | System: Save | — |
| `game.load` | action | Load variables | slot: text (`save1`) | GC LC | System: Load | — |
| `system.log` | action | Log to console | message: expr (`"Hello"`) | GC LC | Browser: Log in console | all |

## ☰ Lists & dictionaries

Array and dictionary variables.

| ID | Kind | Name | Parameters (default) | Apps | Construct 2 | Export |
|---|---|---|---|---|---|---|
| `list.contains` | condition | List contains | variable: variable (`inventory`)<br>value: expr (`"key"`) | GC LC |  | JS Py Lua |
| `list.push` | action | Add item | variable: variable (`inventory`)<br>value: expr (`"key"`) | GC LC | Array: Push back | JS Py Lua |
| `list.set_at` | action | Set item | variable: variable (`inventory`)<br>index: expr (`0`)<br>value: expr (`0`) | GC LC | Array: Set at X | JS Py Lua |
| `list.remove_at` | action | Remove item | variable: variable (`inventory`)<br>index: expr (`0`) | GC LC | Array: Delete | JS Py Lua |
| `list.remove_value` | action | Remove value | variable: variable (`inventory`)<br>value: expr (`"key"`) | GC LC |  | — |
| `list.clear` | action | Clear list | variable: variable (`inventory`) | GC LC | Array: Clear | JS Py Lua |
| `dict.set` | action | Set key | variable: variable (`stats`)<br>key: expr (`"name"`)<br>value: expr (`0`) | GC LC | Dictionary: Add key | JS Py Lua |
| `dict.delete` | action | Delete key | variable: variable (`stats`)<br>key: expr (`"name"`) | GC LC | Dictionary: Delete key | JS Py Lua |

## ƒ Functions

Reusable functions and custom events.

| ID | Kind | Name | Parameters (default) | Apps | Construct 2 | Export |
|---|---|---|---|---|---|---|
| `function.on_function` | ⚡ trigger | On function | name: function (`myFunction`) | GC LC | Function: On function | all |
| `function.call` | action | Call function | name: function (`myFunction`)<br>args: expr (``) | GC LC | Function: Call function | all |
| `function.set_return` | action | Set return value | value: expr (`0`) | GC LC | Function: Set return value | — |
| `system.signal` | action | Trigger custom event | name: text (`my_event`) | GC LC | System: Signal | all |

## ◼ Objects

Create, destroy, pick and change objects.

| ID | Kind | Name | Parameters (default) | Apps | Construct 2 | Export |
|---|---|---|---|---|---|---|
| `object.create` | action | Create object | object: objectType (`Coin`)<br>x: expr (`0`)<br>y: expr (`0`)<br>z: expr (`0`) | GC LC | System: Create object | all |
| `object.create_by_name` | action | Create object by name | name: expr (`"Room" & int(random(1, 4))`)<br>x: expr (`0`)<br>y: expr (`0`)<br>z: expr (`0`)<br>attach: text (empty) | GC LC | System: Create object (by name) | — |
| `object.spawn` | action | Spawn another object | **object**<br>object: objectType (`Bullet`)<br>offset: expr (`0.8`) | GC LC | Object: Spawn another object | — |
| `object.destroy` | action | Destroy | **object** | GC LC | Object: Destroy | all |
| `object.set_visible` | action | Set visible | **object**<br>visible: choice (`visible`) | GC LC | Object: Set visible | — |
| `object.set_opacity` | action | Set opacity | **object**<br>value: expr (`100`) | GC LC | Object: Set opacity | — |
| `object.set_color` | action | Set color | **object**<br>color: color (`#ff4444`) | GC LC |  | — |
| `object.set_scale` | action | Set scale | **object**<br>sx: expr (`1`)<br>sy: expr (`1`)<br>sz: expr (`1`) | GC LC | Object: Set scale | — |
| `object.change_size` | action | Change size by | **object**<br>percent: expr (`10`) | GC LC | Object: Set scale | — |
| `object.set_size` | action | Set size to | **object**<br>percent: expr (`100`) | GC LC | Object: Set scale | — |
| `sprite.next_costume` | action | Next costume | **object** | GC LC | Sprite: Set animation frame | — |
| `sprite.set_costume` | action | Switch costume | **object**<br>costume: expr (`1`) | GC LC | Sprite: Set animation frame | — |
| `object.attach_to` | action | Attach to object | **object**<br>other: objectType (`Player`) | GC LC | Pin: Pin to object | — |
| `object.add_tag` | action | Add tag | **object**<br>tag: text (`enemy`) | GC LC |  | — |
| `object.remove_tag` | action | Remove tag | **object**<br>tag: text (`enemy`) | GC LC |  | — |
| `behavior.set_enabled` | action | Set behavior enabled | **object**<br>behavior: behavior (`platform`)<br>state: choice (`enabled`) | GC LC | Behavior: Set enabled | — |

## ➜ Movement

Position, rotation and movement behaviors.

| ID | Kind | Name | Parameters (default) | Apps | Construct 2 | Export |
|---|---|---|---|---|---|---|
| `platform.on_jump` | ⚡ trigger | On jump | **object** | GC LC | Platform: On jump | — |
| `platform.on_landed` | ⚡ trigger | On landed | **object** | GC LC | Platform: On landed | — |
| `car.on_hit` | ⚡ trigger | On car hit | **object** | GC LC |  | — |
| `object.set_position` | action | Set position | **object**<br>x: expr (`Self.X`)<br>y: expr (`Self.Y`)<br>z: expr (`Self.Z`) | GC LC | Object: Set position | all |
| `object.teleport_to` | action | Set position to object | **object**<br>other: objectType (`Checkpoint`) | GC LC | Object: Set position to another object | — |
| `object.move` | action | Move by | **object**<br>dx: expr (`0`)<br>dy: expr (`0`)<br>dz: expr (`0`) | GC LC |  | all |
| `object.move_forward` | action | Move forward | **object**<br>distance: expr (`5 * dt`) | GC LC | Object: Move forward | all |
| `object.move_toward` | action | Move toward position | **object**<br>distance: expr (`3 * dt`)<br>x: expr (`Player.X`)<br>y: expr (`Self.Y`)<br>z: expr (`Player.Z`) | GC LC |  | — |
| `object.move_toward_object` | action | Move toward object | **object**<br>other: objectType (`Player`)<br>speed: expr (`3`) | GC LC |  | — |
| `object.set_velocity` | action | Set velocity | **object**<br>vx: expr (`0`)<br>vy: expr (`0`)<br>vz: expr (`0`) | GC LC |  | — |
| `object.set_angle` | action | Set angle | **object**<br>angle: expr (`0`) | GC LC | Object: Set angle | all |
| `object.rotate` | action | Rotate | **object**<br>degrees: expr (`90 * dt`) | GC LC | Object: Rotate clockwise | all |
| `object.rotate_per_second` | action | Turn (per second) | **object**<br>degrees: expr (`90`) | GC LC | Rotate behavior | — |
| `object.move_per_second` | action | Move forward (per second) | **object**<br>speed: expr (`5`) | GC LC | Object: Move forward | — |
| `object.glide_to` | action | Glide to position | **object**<br>x, y, z: expr<br>seconds: expr (`1`) | GC LC | MoveTo: Move to position | — |
| `object.point_toward_mouse` | action | Point toward mouse | **object** | GC LC | Object: Set angle toward position | — |
| `object.go_random` | action | Go to random position | **object** | GC LC |  | — |
| `object.bounce_on_edge` | action | Bounce off edge | **object** | GC LC | Bound to layout + reflect | — |
| `object.set_rotation` | action | Set rotation (3D) | **object**<br>rx: expr (`0`)<br>ry: expr (`0`)<br>rz: expr (`0`) | GC LC |  | — |
| `object.look_at` | action | Look at object | **object**<br>other: objectType (`Player`) | GC LC | Object: Set angle toward position | — |
| `object.look_at_position` | action | Look at position | **object**<br>x: expr (`Mouse.X`)<br>y: expr (`Mouse.Y`)<br>z: expr (`Mouse.Z`) | GC LC |  | — |
| `movement.set_speed` | action | Set movement speed | **object**<br>speed: expr (`6`) | GC LC |  | — |
| `platform.simulate_control` | action | Simulate control | **object**<br>control: choice (`right`) | GC LC | Platform: Simulate control | — |
| `platform.jump` | action | Jump | **object** | GC LC |  | — |
| `platform.set_jump_strength` | action | Set jump strength | **object**<br>value: expr (`10`) | GC LC | Platform: Set jump strength | — |
| `platform.set_gravity` | action | Set platform gravity | **object**<br>value: expr (`28`) | GC LC | Platform: Set gravity | — |
| `movement.fly` | action | Fly | **object**<br>speed: expr (`5`) | GC LC |  | — |

## ⚛ Physics

Forces, gravity, collisions, raycasts, grab and throw.

| ID | Kind | Name | Parameters (default) | Apps | Construct 2 | Export |
|---|---|---|---|---|---|---|
| `bullet.on_hit_solid` | ⚡ trigger | On bullet hit solid | **object** | GC LC |  | — |
| `physics.on_impact` | ⚡ trigger | On impact | **object** | GC LC |  | — |
| `physics.is_holding` | condition | Is holding an object | **object** | GC LC |  | — |
| `physics.detect_ground` | condition | Detect ground | **object**<br>distance: expr (`0.2`) | GC LC |  | — |
| `physics.detect_wall` | condition | Detect wall | **object**<br>distance: expr (`1`) | GC LC |  | — |
| `physics.raycast` | condition | Raycast hits | **object**<br>distance: expr (`20`)<br>other: objectType (`Enemy`) | GC LC |  | — |
| `physics.apply_force` | action | Apply force | **object**<br>fx: expr (`0`)<br>fy: expr (`0`)<br>fz: expr (`0`) | GC LC | Physics: Apply force | — |
| `physics.apply_impulse` | action | Apply impulse | **object**<br>ix: expr (`0`)<br>iy: expr (`5`)<br>iz: expr (`0`) | GC LC | Physics: Apply impulse | — |
| `physics.set_world_gravity` | action | Set gravity | value: expr (`-20`) | GC LC | Physics: Set world gravity | — |
| `physics.set_mass` | action | Change mass | **object**<br>value: expr (`1`) | GC LC |  | — |
| `physics.set_friction` | action | Change friction | **object**<br>value: expr (`0.5`) | GC LC | Physics: Set friction | — |
| `physics.set_bounce` | action | Change bounce | **object**<br>value: expr (`0.3`) | GC LC | Physics: Set elasticity | — |
| `physics.add_body` | action | Create rigidbody | **object**<br>mass: expr (`1`) | GC LC |  | — |
| `physics.set_collider` | action | Create collider | **object**<br>shape: choice (`box`)<br>w: expr (`1`)<br>h: expr (`1`)<br>d: expr (`1`) | GC LC |  | — |
| `physics.grab_nearest` | action | Grab nearest object | **object**<br>object: objectType (`Crate`)<br>distance: expr (`2`) | GC LC |  | — |
| `physics.drop` | action | Drop object | **object** | GC LC |  | — |
| `physics.throw` | action | Throw object | **object**<br>strength: expr (`12`)<br>up: expr (`4`) | GC LC |  | — |
| `physics.explode` | action | Apply explosion force | x: expr (`0`)<br>y: expr (`0`)<br>z: expr (`0`)<br>radius: expr (`5`)<br>force: expr (`15`) | GC LC |  | — |

## ⚔ Combat

Health, damage, weapons and projectiles.

| ID | Kind | Name | Parameters (default) | Apps | Construct 2 | Export |
|---|---|---|---|---|---|---|
| `health.on_damaged` | ⚡ trigger | On damaged | **object** | GC LC |  | — |
| `health.on_healed` | ⚡ trigger | On health changed | **object** | GC LC |  | — |
| `health.on_died` | ⚡ trigger | On died | **object** | GC LC |  | — |
| `combat.on_hit` | ⚡ trigger | On hit by attack | **object** | GC LC |  | — |
| `health.compare_hp` | condition | Compare health | **object**<br>op: compare (`=`)<br>value: expr (`0`) | GC LC |  | — |
| `health.is_dead` | condition | Is dead | **object** | GC LC |  | — |
| `health.damage` | action | Deal damage | **object**<br>amount: expr (`10`) | GC LC |  | — |
| `health.heal` | action | Heal | **object**<br>amount: expr (`10`) | GC LC |  | — |
| `health.set_hp` | action | Set health | **object**<br>value: expr (`100`) | GC LC |  | — |
| `combat.shoot` | action | Shoot projectile | **object**<br>object: objectType (`Bullet`)<br>speed: expr (`30`)<br>spread: expr (`2`)<br>damage: expr (`25`) | GC LC |  | — |
| `combat.melee` | action | Perform melee attack | **object**<br>victims: objectType (`Enemy`)<br>range: expr (`2.2`)<br>arc: expr (`120`)<br>damage: expr (`34`) | GC LC |  | — |
| `input.set_cursor` | action | Set mouse cursor | mode: choice (`locked`: visible / hidden / locked) | GC LC | Mouse: Set cursor style / Pointer lock | — |
| `input.cursor_is_locked` | condition | Mouse is locked |  | GC LC | Mouse: Is pointer locked | — |
| `combat.hitscan` | action | Fire hitscan | **object**<br>victims: objectType (`Enemy`)<br>range: expr (`60`)<br>damage: expr (`25`)<br>spread: expr (`0.5`)<br>impact: text (empty) | GC LC |  | — |
| `voxel.on_dug` | ⚡ trigger | On terrain dug | **object** | GC LC |  | — |
| `voxel.on_built` | ⚡ trigger | On terrain built | **object** | GC LC |  | — |
| `voxel.dig_view` | action | Dig terrain (where you look) | **object**<br>from: objectType (`Player`)<br>radius: expr (`0.8`)<br>reach: expr (`4`) | GC LC |  | — |
| `voxel.build_view` | action | Build terrain (where you look) | **object**<br>from: objectType (`Player`)<br>radius: expr (`0.6`)<br>reach: expr (`4`)<br>material: text (`2`) | GC LC |  | — |
| `voxel.dig_at` | action | Dig terrain at point | **object**<br>x, y, z: expr<br>radius: expr (`1.5`) | GC LC |  | — |
| `combat.knockback` | action | Apply knockback | **object**<br>other: objectType (`Player`)<br>strength: expr (`8`) | GC LC |  | — |
| `combat.equip` | action | Equip weapon | **object**<br>weapon: text (`Sword`) | GC LC |  | — |
| `combat.switch_weapon` | action | Switch weapon | **object**<br>weapons: text (`Sword,Gun`) | GC LC |  | — |
| `object.respawn` | action | Respawn | **object**<br>x: expr (`0`)<br>y: expr (`1`)<br>z: expr (`0`) | GC LC |  | — |

## ◉ AI

Pathfinding, patrol, chase, flee, line of sight.

| ID | Kind | Name | Parameters (default) | Apps | Construct 2 | Export |
|---|---|---|---|---|---|---|
| `pathfinding.on_arrived` | ⚡ trigger | On arrived | **object** | GC LC | Pathfinding: On arrived | — |
| `pathfinding.on_path_found` | ⚡ trigger | On path found | **object** | GC LC | Pathfinding: On path found | — |
| `pathfinding.on_failed` | ⚡ trigger | On failed to find path | **object** | GC LC | Pathfinding: On failed to find path | — |
| `pathfinding.has_line_of_sight` | condition | Has line of sight | **object**<br>other: objectType (`Player`) | GC LC | Line of sight: Has LOS to object | — |
| `pathfinding.find_path` | action | Find path | **object**<br>x: expr (`Player.X`)<br>y: expr (`Player.Y`)<br>z: expr (`Player.Z`) | GC LC | Pathfinding: Find path | — |
| `pathfinding.move_to_object` | action | Chase object | **object**<br>other: objectType (`Player`) | GC LC |  | — |
| `pathfinding.stop` | action | Stop moving | **object** | GC LC | Pathfinding: Stop | — |
| `ai.patrol` | action | Patrol | **object**<br>radius: expr (`6`) | GC LC |  | — |
| `ai.flee` | action | Flee | **object**<br>other: objectType (`Player`)<br>distance: expr (`6`) | GC LC |  | — |
| `ai.set_state` | action | Set AI state | **object**<br>state: choice (`chase`) | GC LC |  | — |

## ⏱ Timers

Every X seconds and named timers.

| ID | Kind | Name | Parameters (default) | Apps | Construct 2 | Export |
|---|---|---|---|---|---|---|
| `timer.on_timer` | ⚡ trigger | On timer | **object**<br>tag: text (`tick`) | GC LC | Timer: On timer | — |
| `timer.is_running` | condition | Is timer running | **object**<br>tag: text (`tick`) | GC LC | Timer: Is timer running | — |
| `timer.every_x_seconds` | condition | Every X seconds | seconds: expr (`1`) | GC LC | System: Every X seconds | all |
| `timer.start` | action | Start timer | **object**<br>tag: text (`tick`)<br>duration: expr (`1`)<br>mode: choice (`once`) | GC LC | Timer: Start timer | — |
| `timer.stop` | action | Stop timer | **object**<br>tag: text (`tick`) | GC LC | Timer: Stop timer | — |

## ♪ Audio

Sounds, music and volume.

| ID | Kind | Name | Parameters (default) | Apps | Construct 2 | Export |
|---|---|---|---|---|---|---|
| `audio.play` | action | Play sound | sound: sound (`coin`)<br>volume: expr (`80`) | GC LC | Audio: Play | — |
| `audio.play_at` | action | Play spatial sound | **object**<br>sound: sound (`hit`)<br>volume: expr (`80`) | GC LC | Audio: Play at object | — |
| `audio.play_music` | action | Play music | sound: sound (`music:adventure`)<br>volume: expr (`40`) | GC LC |  | — |
| `audio.stop` | action | Stop sound | what: choice (`music`) | GC LC | Audio: Stop | — |
| `audio.set_volume` | action | Change volume | volume: expr (`80`) | GC LC | Audio: Set master volume | — |
| `audio.set_effect` | action | Trigger audio effect | effect: choice (`none`) | GC LC | Audio: Add effect | — |

## ✦ Particles

Particle emitters and presets.

| ID | Kind | Name | Parameters (default) | Apps | Construct 2 | Export |
|---|---|---|---|---|---|---|
| `particles.spawn` | action | Spawn particle system | preset: particlePreset (`explosion`)<br>x: expr (`0`)<br>y: expr (`0`)<br>z: expr (`0`) | GC LC |  | — |
| `particles.spawn_at` | action | Spawn particles at object | **object**<br>preset: particlePreset (`coin`) | GC LC |  | — |
| `particles.attach` | action | Attach effect to object | **object**<br>preset: particlePreset (`fire`) | GC LC |  | — |
| `particles.burst` | action | Trigger burst | **object**<br>count: expr (`30`) | GC LC |  | — |
| `particles.start` | action | Start emission | **object** | GC LC |  | — |
| `particles.stop` | action | Stop emission | **object** | GC LC |  | — |
| `particles.set_param` | action | Set particle property | **object**<br>param: choice (`rate`)<br>value: expr (`30`) | GC LC |  | — |
| `particles.set_color` | action | Set particle color | **object**<br>start: color (`#ffffff`)<br>end: color (`#ff8800`) | GC LC |  | — |

## ◎ Camera & effects

Camera shake, targets and post-processing.

| ID | Kind | Name | Parameters (default) | Apps | Construct 2 | Export |
|---|---|---|---|---|---|---|
| `follow.set_target` | action | Change follow target | **object**<br>other: objectType (`Player`) | GC LC |  | — |
| `camera.shake` | action | Shake camera | intensity: expr (`0.3`)<br>duration: expr (`0.3`) | GC LC | ScrollTo: Shake | — |
| `camera.set_active` | action | Set active camera | **object** | GC |  | — |
| `camera.set_focal_length` | action | Set focal length | **object**<br>mm: expr (`50`) | GC |  | — |
| `camera.set_clipping` | action | Set camera clipping | **object**<br>near: expr (`0.1`)<br>far: expr (`1000`) | GC |  | — |
| `camera.set_zoom` | action | Set 2D zoom | zoom: expr (`1`) | GC LC |  | — |
| `postfx.apply_preset` | action | Apply post-processing preset | preset: postfxPreset (`ps1`) | GC |  | — |
| `postfx.set_enabled` | action | Enable or disable effect | effect: effectType (`bloom`)<br>state: choice (`enabled`) | GC |  | — |
| `postfx.set_param` | action | Set effect parameter | effect: effectType (`bloom`)<br>param: text (`strength`)<br>value: expr (`1`) | GC |  | — |
| `postfx.set_bloom` | action | Set bloom intensity | value: expr (`1`) | GC |  | — |
| `postfx.set_pixelation` | action | Enable pixelation | value: expr (`4`) | GC |  | — |
| `postfx.set_ps1` | action | Enable PS1-style effects | state: choice (`enabled`) | GC |  | — |
| `postfx.set_vignette` | action | Set vignette | value: expr (`0.5`) | GC |  | — |
| `postfx.set_dof` | action | Change depth of field | focus: expr (`10`)<br>fstop: expr (`2.8`) | GC |  | — |
| `postfx.color_grade` | action | Change color grading | saturation: expr (`1`)<br>contrast: expr (`1`)<br>temperature: expr (`0`) | GC |  | — |

## ▤ UI

Messages, text, bars and menus.

| ID | Kind | Name | Parameters (default) | Apps | Construct 2 | Export |
|---|---|---|---|---|---|---|
| `ui.on_button_clicked` | ⚡ trigger | On button clicked | button: text (`Restart`) | GC LC | Button: On clicked | — |
| `looks.say` | action | Say | **object**<br>text: expr (`"Hello!"`)<br>seconds: expr (`2`) | GC LC |  | — |
| `looks.think` | action | Think | **object**<br>text: expr (`"Hmm…"`)<br>seconds: expr (`2`) | GC LC |  | — |
| `ui.ask` | action | Ask and wait | question: expr<br>variable: variable (`answer`) | GC LC |  | — |
| `ui.show_message` | action | Show message | text: expr (`"Hello!"`)<br>seconds: expr (`2`) | GC LC |  | — |
| `ui.set_text` | action | Update text | **object**<br>text: expr (`"Coins: " & coins`) | GC LC | Text: Set text | — |
| `ui.set_bar` | action | Update health bar | **object**<br>value: expr (`Player.Health.HP`)<br>max: expr (`100`) | GC LC |  | — |
| `ui.show_menu` | action | Show menu | tag: text (`pause_menu`) | GC LC |  | — |
| `ui.hide_menu` | action | Hide menu | tag: text (`pause_menu`) | GC LC |  | — |

## ⚑ Game flow

Pause, restart, scenes, checkpoints, win and lose.

| ID | Kind | Name | Parameters (default) | Apps | Construct 2 | Export |
|---|---|---|---|---|---|---|
| `game.pause` | action | Pause game | — | GC LC | System: Set time scale (0) | — |
| `game.resume` | action | Resume game | — | GC LC |  | — |
| `system.set_timescale` | action | Set time scale | scale: expr (`1`) | GC LC | System: Set time scale | — |
| `game.restart` | action | Restart scene | — | GC LC | System: Restart layout | — |
| `game.load_scene` | action | Load scene | scene: text (`Level 2`) | GC LC | System: Go to layout | — |
| `game.set_checkpoint` | action | Set checkpoint | **object** | GC LC |  | — |
| `game.respawn_checkpoint` | action | Respawn at checkpoint | **object** | GC LC |  | — |
| `game.victory` | action | Display victory screen | title: expr (`"You win!"`)<br>message: expr (`"Well done"`) | GC LC |  | — |
| `game.defeat` | action | Display defeat screen | title: expr (`"Game over"`)<br>message: expr (`"Try again"`) | GC LC |  | — |

## ▶ Animation

Animation clips and tweens.

| ID | Kind | Name | Parameters (default) | Apps | Construct 2 | Export |
|---|---|---|---|---|---|---|
| `anim.on_finished` | ⚡ trigger | On animation finished | **object**<br>name: text (`dig`) | GC LC | Sprite: On animation finished | — |
| `anim.is_playing` | condition | Is animation playing | **object**<br>name: text (`walk`) | GC LC | Sprite: Is playing | — |
| `anim.play` | action | Play animation | **object**<br>name: text (`dig`)<br>loop: choice (`once`) | GC LC | Sprite: Set animation | — |
| `anim.stop` | action | Stop animation | **object** | GC LC |  | — |
| `anim.tween` | action | Tween property | **object**<br>property: choice (`Y`)<br>value: expr (`Self.Y + 1`)<br>duration: expr (`0.5`)<br>ease: choice (`easeOut`) | GC LC | Tween: Tween one property | — |

## Behaviors

| Behavior | Properties | Expressions |
|---|---|---|
| ▣ **Solid** (`solid`) — Blocks Platform, 8-Direction, Car, Bullet, Physics and Pathfinding movement. | Enabled (true) | — |
| 🏃 **Platform** (`platform`) — Side-view (2D) or third-person (3D) character controller: run, jump, gravity, ground detection. 3D movement is relative to the active camera. | Max speed (6), Run multiplier (Shift) (1.6), Acceleration (40), Deceleration (40), Jump strength (10), Gravity (28), Max fall speed (40), Air control (0.7), Double jump (false), Turn speed (3D) (720), Default controls (true), Enabled (true) | Obj.Platform.Speed, Obj.Platform.VectorX, Obj.Platform.VectorY, Obj.Platform.VectorZ, Obj.Platform.IsOnFloor |
| ✥ **8 Direction** (`eightdir`) — Top-down movement in 8 directions (arrows / WASD). In 3D, up is -Z (away from a default camera). | Max speed (6), Acceleration (50), Deceleration (50), Set angle (true), Default controls (true), Enabled (true) | Obj.8Direction.Speed, Obj.8Direction.VectorX, Obj.8Direction.VectorY, Obj.8Direction.VectorZ |
| 🚚 **Car** (`car`) — Vehicle handling: throttle (Up/W), brake & reverse (Down/S), steer (Left/Right, A/D). Steering scales with speed; drift keeps some sideways velocity. | Top speed (24), Acceleration (14), Braking (34), Reverse speed (8), Steering (°/s) (120), Rolling friction (5), Drift (0.12), Gravity (25), Default controls (true), Enabled (true) | Obj.Car.Speed, Obj.Car.VectorX, Obj.Car.VectorZ |
| ➤ **Bullet** (`bullet`) — Moves forward along its angle. Optional gravity, lifetime, and destroy-on-solid. | Speed (30), Gravity (0), Destroy on solid (true), Lifetime (s, 0 = forever) (3), Enabled (true) | Obj.Bullet.Speed |
| ⚛ **Physics** (`physics`) — Rigid body with gravity, mass, friction and bounce (AABB collision). Can be grabbed, dropped and thrown. | Mass (kg) (1), Friction (0.5), Bounce (0.3), Gravity scale (1), Linear damping (0.05), Immovable (false), Enabled (true) | Obj.Physics.VelocityX, Obj.Physics.VelocityY, Obj.Physics.VelocityZ, Obj.Physics.Speed, Obj.Physics.Mass, Obj.Physics.IsHeld |
| ∿ **Sine** (`sine`) — Oscillates a property: perfect for moving platforms, bobbing pickups and pulsing lights. Moving Solids carry Platform characters. | Movement (vertical), Period (s) (4), Magnitude (2), Phase (0-1) (0), Enabled (true) | Obj.Sine.Value |
| ⟳ **Rotate** (`rotate`) — Spins continuously around an axis. | Speed (°/s) (90), Axis (y), Enabled (true) | — |
| ⌖ **Pathfinding** (`pathfinding`) — Finds routes around Solid obstacles with grid A* and follows them. Use "Find path" then wait for "On arrived". | Max speed (4), Cell size (0.5), Agent radius (0.45), Rotate speed (°/s) (540), Enabled (true) | Obj.Pathfinding.IsMoving, Obj.Pathfinding.NodeCount |
| ♥ **Health** (`health`) — Hit points with damage, healing, invulnerability frames, and On damaged / On died triggers. | Max health (100), Start health (100), Invulnerable after hit (s) (0), Enabled (true) | Obj.Health.HP, Obj.Health.MaxHP, Obj.Health.Percent, Obj.Health.IsDead |
| ⏱ **Timer** (`timer`) — Named countdown timers that fire "On timer". | Enabled (true) | — |
| 🎥 **Follow (camera rig)** (`follow`) — Smoothly follows a target. With "Orbit with mouse" the camera orbits the target (drag / pointer lock). Use on cameras or any object. | Target (Player), Offset X (0), Offset Y (6), Offset Z (10), Rotate offset with target (false), Smoothing (0.85), Look at target (true), Orbit with mouse (false), Mouse sensitivity (0.25), Orbit distance (8), Enabled (true) | — |

## Expression functions

| Function | Arguments | Description |
|---|---|---|
| `abs` | x | Absolute value |
| `floor` | x | Round down |
| `ceil` | x | Round up |
| `round` | x | Round to nearest |
| `int` | x | Convert to integer (truncates) |
| `float` | x | Convert to number |
| `str` | x | Convert to text |
| `sqrt` | x | Square root |
| `sin` | deg | Sine of an angle in degrees |
| `cos` | deg | Cosine of an angle in degrees |
| `tan` | deg | Tangent of an angle in degrees |
| `atan2` | y, x | Angle in degrees |
| `min` | a, b, ... | Smallest value |
| `max` | a, b, ... | Largest value |
| `clamp` | x, lo, hi | Limit x between lo and hi |
| `lerp` | a, b, t | Linear interpolation |
| `random` | a [, b] | random(a): 0..a, random(a, b): a..b (not inclusive) |
| `choose` | a, b, ... | Pick one argument at random |
| `distance` | x1, y1, x2, y2 | 2D distance |
| `distance3` | x1, y1, z1, x2, y2, z2 | 3D distance |
| `angle` | x1, y1, x2, y2 | Angle in degrees from point 1 to point 2 |
| `len` | text or list | Length of text or list |
| `upper` | text | Uppercase |
| `lower` | text | Lowercase |
| `left` | text, n | First n characters |
| `right` | text, n | Last n characters |
| `mid` | text, start, count | Substring |
| `find` | text, search | Index of search in text, -1 if missing |
| `zeropad` | n, digits | Pad a number with zeros |
| `at` | list, index | Item of a list (0-based) |
| `get` | dict, key | Value of a dictionary key |
| `haskey` | dict, key | True if key exists |
| `contains` | list, value | True if the list contains value |
| `vec` | x, y, z | Make a vector |
| `vx` | v | X of a vector |
| `vy` | v | Y of a vector |
| `vz` | v | Z of a vector |
| `loopindex` | [name] | Current loop iteration (optionally of a named For loop) |
| `param` | i | Function parameter i |
| `call` | "name", args… | Call a function and use its return value |
| `item` | | Current item in "For each item" |

Special names: `dt`, `time`, `tickcount`, `timescale`, `pi`, `Self.<prop>`, `<Object>.<prop>`, `<Object>.Count`, `<Object>.<Behavior>.<expr>`, `Mouse.X/Y/Z`, `Camera.X/Y/Z/Zoom`.

## Post-processing effects

| Effect | Fidelity | Notes |
|---|---|---|
| Bloom (`bloom`) | accurate | Unreal-style multi-mip bloom. |
| Depth of field (`dof`) | approximation | Bokeh pass driven by the camera focus distance and f-stop (Blender-style). |
| Pixelation (`pixelate`) | accurate | Renders at reduced resolution with nearest-neighbor upscaling. |
| Palette & dither (`palette`) | accurate | Quantizes colors (levels per channel or a fixed palette) with 4x4 ordered Bayer dithering. |
| PS1 renderer (`ps1`) | approximation | Low-resolution target, vertex snapping in the vertex shader, affine (non-perspective) texture mapping, nearest filtering, 15-bit color with dithering. Not emulated: GTE fixed-point math, missing Z-buffer sorting artifacts. |
| CRT monitor (`crt`) | approximation | Barrel curvature, scanlines, aperture mask and edge falloff. |
| VHS (`vhs`) | approximation | Chroma bleed, tracking lines, wobble and tape noise. |
| Film grain (`grain`) | accurate | Animated luminance noise. |
| Vignette (`vignette`) | accurate | Radial edge darkening. |
| Chromatic aberration (`chromatic`) | accurate | Radial RGB channel offset. |
| Color grading (`colorgrade`) | accurate | Lift/gamma/gain, contrast, saturation, temperature and tint. |
| Outline (`outline`) | approximation | Screen-space Sobel edges on depth and color. |
| Posterize (`posterize`) | accurate | Reduces tonal steps. |
| Comic halftone (`halftone`) | approximation | Rotated dot screen mixed over shading. |
| Distortion (`distortion`) | approximation | Animated UV distortion (heat shimmer or underwater waves). |
| Motion blur (`motionblur`) | approximation | Frame accumulation (afterimage), not per-object velocity blur. |
| Letterbox (`letterbox`) | accurate | Cinematic bars. |
| Fog (`fog`) | accurate | Exponential scene fog (atmosphere). |
| Noir (`noir`) | accurate | Desaturation with contrast curve. |
| Cel shading (`celshade`) | accurate | Swaps lit materials to stepped toon shading. |

Presets: None (`none`), PS1 Retro (`ps1`), Pixel Art (`pixelart`), Cinematic (`cinematic`), VHS (`vhs`), CRT monitor (`crt`), Noir (`noir`), Anime outlines (`anime`), Comic book (`comic`), Dreamlike glow (`dreamy`), Horror (`horror`), Underwater (`underwater`), Heat distortion (`heat`), Bloom (`bloom`), Depth of field (`dof`), Motion blur (`motionblur`), Chromatic aberration (`chromatic`), Vignette (`vignette`), Film grain (`grain`), Color grading (`colorgrade`), Cel shading (`celshade`), Outline rendering (`outline`), Fog & atmosphere (`fog`).

## Particle presets

Fire (`fire`), Smoke (`smoke`), Sparks (`sparks`), Dust (`dust`), Rain (`rain`), Snow (`snow`), Magic sparkle (`magic`), Explosion (`explosion`), Coin collection (`coin`), Weapon muzzle flash (`muzzle`), Sword impact (`sword`), Footsteps (`footsteps`), Digging dirt (`dirt`), Teleportation (`teleport`), Low-poly debris (`debris`).
