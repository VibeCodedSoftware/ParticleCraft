// VR project settings and performance profiles. VR runs through WebXR (the browser's OpenXR layer): Meta Quest 2 / 3
// in the Quest browser (standalone), and PC headsets through SteamVR / OpenXR in Chrome or Edge. Controller input
// arrives as the VR actions (input.ts: VR_ACTIONS) so blocks work the same in VR, on gamepads and on keyboards.

export type VrProfile = 'quest' | 'pcvr';
export interface VrSettings {
  enabled: boolean;
  /** Performance profile: Quest (standalone, mobile GPU) or PC VR (SteamVR). */
  profile: VrProfile;
  /** standing (room scale, floor at 0) or seated (eye height added). */
  playArea: 'standing' | 'seated';
  /** Comfort: darken the edges of the view while moving with the stick (reduces motion sickness). */
  comfortVignette: boolean;
  /** Overrides of the profile (0 = profile default). */
  resolutionScale: number;
  foveation: number;
  /** Refresh rate to ask the headset for (Hz; 0 = the profile's: Quest 72, PC 90). Not every headset allows it. */
  refreshRate?: number;
  /** Player height (m): sets the eye height when seated and in the desktop VR preview (standing uses your own). */
  playerHeight?: number;
  /** Controller vibration strength for all haptics (0 = off, 1 = as asked). */
  haptics?: number;
}
export const DEFAULT_VR: VrSettings = { enabled: false, profile: 'quest', playArea: 'standing', comfortVignette: true, resolutionScale: 0, foveation: 0, refreshRate: 0, playerHeight: 1.7, haptics: 1 };

/** Eye height in metres for a player height (eyes sit about 7% below the top of the head; seated about 70%). */
export const eyeHeight = (height: number, seated: boolean) => (seated ? 0.7 : 0.93) * Math.max(0.5, height);

/** Performance profiles: render resolution, fixed foveation (0..1), render quality preset, frame rate to target. */
export const VR_PROFILES: Record<VrProfile, { name: string; resolutionScale: number; foveation: number; quality: 'low' | 'medium' | 'high' | 'ultra'; fps: number; doc: string }> = {
  quest: { name: 'Meta Quest 2 / 3 (standalone)', resolutionScale: 0.85, foveation: 1, quality: 'low', fps: 72, doc: 'Mobile GPU: lower resolution, strong foveation, hard shadows. Aim for 72 fps (Quest 3 can run 90).' },
  pcvr: { name: 'PC VR (SteamVR / OpenXR)', resolutionScale: 1, foveation: 0, quality: 'high', fps: 90, doc: 'Desktop GPU: full resolution, soft shadows, 90 fps.' },
};

/** The effective numbers for a project's VR settings. */
export function vrEffective(s: VrSettings | undefined) {
  const v = { ...DEFAULT_VR, ...s };
  const p = VR_PROFILES[v.profile] ?? VR_PROFILES.quest;
  return { ...p, resolutionScale: v.resolutionScale > 0 ? v.resolutionScale : p.resolutionScale, foveation: v.foveation > 0 ? v.foveation : p.foveation, fps: (v.refreshRate ?? 0) > 0 ? v.refreshRate! : p.fps, settings: v };
}
