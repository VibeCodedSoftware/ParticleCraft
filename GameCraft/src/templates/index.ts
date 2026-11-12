// Template registry for the launcher.
import type { GameProject } from '../project/types';
import { truckTemplate } from './truck';
import { platformerTemplate } from './platformer';
import { sideScrollerTemplate } from './sidescroller';
import { physicsTemplate } from './physics';
import { combatTemplate } from './combat';
import { fpsTemplate } from './fps';
import { diggingTemplate } from './digging';
import { dungeonTemplate } from './dungeon';
import { backroomsTemplate } from './backrooms';
import { emptyProject } from './empty';
import { textAdventureTemplate } from './textAdventure';
import { mailDeliveryTemplate } from './mailDelivery';
import { vrTemplate } from './vr';
import { proceduralTemplate } from './procedural';
import { planetsTemplate } from './planets';
import { chessBoardTemplate } from './chessBoard';

export interface TemplateInfo { id: string; name: string; description: string; mode: '2D' | '3D'; color: string; icon: string; build: () => GameProject }

export const TEMPLATES: TemplateInfo[] = [
  { id: 'empty3d', name: 'Empty 3D', description: 'Ground, sun, camera. Start from scratch.', mode: '3D', color: '#6b7a90', icon: '▢', build: () => emptyProject('3d') },
  { id: 'emptyvr', name: 'Empty VR Project', description: 'A room and a VR player: teleport, grab and throw.', mode: '3D', color: '#3a8fd9', icon: '◎', build: vrTemplate },
  { id: 'empty2d', name: 'Empty 2D', description: 'Orthographic camera with pixel-perfect sprites.', mode: '2D', color: '#6b7a90', icon: '▭', build: () => emptyProject('2d') },
  { id: 'truck', name: 'Truck Coin Collector', description: 'Drive a low-poly truck, collect coins, beat the clock to the finish arch.', mode: '3D', color: '#e4572e', icon: '🚚', build: truckTemplate },
  { id: 'maildelivery', name: 'Mail Delivery', description: 'Drive the mail truck in first person, get out (third person), walk into the back for a parcel, carry it to the residents and hand it over. Vehicles with opening doors, walk-in collision, carrying animations and dialogue.', mode: '3D', color: '#2f5fa0', icon: '✉', build: mailDeliveryTemplate },
  { id: 'platformer', name: '3D Platformer', description: 'Jump across moving platforms with checkpoints, gems and fall respawn.', mode: '3D', color: '#4c97ff', icon: '🏃', build: platformerTemplate },
  { id: 'sidescroller', name: '2D Side Scroller', description: 'Pixel-art platformer with enemies, spikes, lives and parallax.', mode: '2D', color: '#3fa34d', icon: '👾', build: sideScrollerTemplate },
  { id: 'physics', name: 'Physics Playground', description: 'Walk, jump, pick up, carry, drop and throw objects with different masses.', mode: '3D', color: '#18a3b8', icon: '⚛', build: physicsTemplate },
  { id: 'procedural', name: 'Procedural Creatures', description: 'Your rigged characters animated with no clips: feet that plant and step on stairs (IK), a robot, a robot dog, a spider, a snake and an octopus. R to ragdoll, F to get up.', mode: '3D', color: '#7a5af5', icon: '🦿', build: proceduralTemplate },
  { id: 'planets', name: 'Mini Planets', description: 'Spherical gravity: walk all the way round little planets, rocks fall onto them, and walk up and over a tower (Surface Walker, Planet).', mode: '3D', color: '#4f9a5b', icon: '🪐', build: planetsTemplate },
  { id: 'combat', name: 'Combat Arena', description: 'Animated fighters with sword and gun against enemies that patrol, chase and attack with pathfinding.', mode: '3D', color: '#d93b3b', icon: '⚔', build: combatTemplate },
  { id: 'chessboard', name: 'Chess', description: 'Chess pieces on a board: move, then black answers. Take the black king to win. Reachable cells, blocked cells, captures. Built on the Grid Board and Grid Piece behaviors.', mode: '3D', color: '#8a6a3f', icon: '♞', build: chessBoardTemplate },
  { id: 'fps', name: 'Arms Shooter', description: 'First-person shooter with your arms model: hitscan rifle, reload, waves of enemies hunting you.', mode: '3D', color: '#e05d3a', icon: '🎯', build: fpsTemplate },
  { id: 'digging', name: 'Digging Treasure Hunt', description: 'First-person voxel digging: excavate and reshape the ground, follow the detector to buried treasure.', mode: '3D', color: '#d9a441', icon: '⛏', build: diggingTemplate },
  { id: 'dungeon', name: 'Dungeon Bound', description: 'Your DungeonBound .blend level and wizard: parkour, keys, crate on plate, spikes, levers, coins. Pixel-art look.', mode: '3D', color: '#8b5cf6', icon: '🗝', build: dungeonTemplate },
  { id: 'backrooms', name: 'Backrooms', description: 'First-person infinite halls from your Backrooms .blend: bacteria monster, survival, items, glowsticks, building.', mode: '3D', color: '#c9b26b', icon: '🟨', build: backroomsTemplate },
  { id: 'textadventure', name: 'Text Adventure', description: 'A text-based game: a full-screen branching story with choices, items, conditions and a status line. Written in the Dialogue editor.', mode: '2D', color: '#b08a4a', icon: '📖', build: textAdventureTemplate },
];
