// Project-wide render quality presets (Preferences › Rendering): shadow filtering, shadow map resolution and the
// pixel ratio. 'high' is the long-standing look; lower presets trade detail for speed on weaker machines / phones.
import * as THREE from 'three';
import type { RenderSettings } from './culling';

export type QualityPreset = 'low' | 'medium' | 'high' | 'ultra';
export interface Quality { shadowType: THREE.ShadowMapType; shadowScale: number; maxPixelRatio: number; label: string }

export const QUALITY: Record<QualityPreset, Quality> = {
  low: { shadowType: THREE.BasicShadowMap, shadowScale: 0.5, maxPixelRatio: 1, label: 'Low — hard shadows, half-size shadow maps, 1× pixels (fastest)' },
  medium: { shadowType: THREE.PCFShadowMap, shadowScale: 1, maxPixelRatio: 1.5, label: 'Medium — smoothed shadows, up to 1.5× pixels' },
  high: { shadowType: THREE.PCFSoftShadowMap, shadowScale: 1, maxPixelRatio: 2, label: 'High — soft shadows, up to 2× pixels (default)' },
  ultra: { shadowType: THREE.PCFSoftShadowMap, shadowScale: 2, maxPixelRatio: 3, label: 'Ultra — soft shadows at double resolution, full screen sharpness' },
};

/** The preset lights read when they build their shadow maps (set by the scene view). */
export let currentQuality: Quality = QUALITY.high;
export function setCurrentQuality(q: QualityPreset | undefined) { currentQuality = QUALITY[q ?? 'high'] ?? QUALITY.high; }

/** Shadow defaults for lights without their own setting (Project settings; 0 = the built-in default). */
export const shadowDefaults = { resolution: 0, distance: 0 };

export const SHADOW_FILTERS: Record<NonNullable<RenderSettings['shadowFilter']>, { type: THREE.ShadowMapType; label: string }> = {
  basic: { type: THREE.BasicShadowMap, label: 'Hard (fastest)' },
  pcf: { type: THREE.PCFShadowMap, label: 'Smoothed' },
  soft: { type: THREE.PCFSoftShadowMap, label: 'Soft' },
  vsm: { type: THREE.VSMShadowMap, label: 'Very soft (VSM; can leak light at contact)' },
};

/** Graphics presets: related settings together. Changing any one of them afterwards makes it Custom. */
export type GraphicsPreset = 'low' | 'medium' | 'high' | 'ultra';
export const GRAPHICS_PRESETS: Record<GraphicsPreset, { label: string; values: Partial<RenderSettings> }> = {
  low: { label: 'Low: fastest', values: { quality: 'low', renderScale: 0.75, antialias: 'none', msaaSamples: 4, ambientOcclusion: 0, shadows: true, shadowFilter: 'basic', shadowResolution: 1024, textureQuality: 'low', textureFilter: 'bilinear', textureMaxSize: 1024, textureCompression: true, contactShadows: 0, cascades: 0 } },
  medium: { label: 'Medium: balanced', values: { quality: 'medium', renderScale: 1, antialias: 'msaa', msaaSamples: 2, ambientOcclusion: 0, shadows: true, shadowFilter: 'pcf', shadowResolution: 2048, textureQuality: 'medium', textureFilter: 'trilinear', textureMaxSize: 2048, textureCompression: true, contactShadows: 0, cascades: 0 } },
  high: { label: 'High: the default look', values: { quality: 'high', renderScale: 1, antialias: 'msaa', msaaSamples: 4, ambientOcclusion: 0, shadows: true, shadowFilter: 'soft', shadowResolution: 0, textureQuality: 'high', textureFilter: 'trilinear', textureMaxSize: 0, textureCompression: false, contactShadows: 0, cascades: 0 } },
  ultra: { label: 'Ultra: best picture', values: { quality: 'ultra', renderScale: 1, antialias: 'msaa', msaaSamples: 8, ambientOcclusion: 0.8, shadows: true, shadowFilter: 'soft', shadowResolution: 4096, textureQuality: 'max', textureFilter: 'trilinear', textureMaxSize: 0, textureCompression: false, contactShadows: 0.6, cascades: 3 } },
};
/** The settings presets control: changing one by hand makes the preset Custom. */
export const PRESET_KEYS = Object.keys(GRAPHICS_PRESETS.high.values) as (keyof RenderSettings)[];

/** What to store when a Project settings row changes: the change, marked Custom if it touches a preset's setting. */
export function renderPatch(patch: Partial<RenderSettings>): Partial<RenderSettings> {
  return !('preset' in patch) && Object.keys(patch).some((k) => PRESET_KEYS.includes(k as keyof RenderSettings)) ? { ...patch, preset: 'custom' } : patch;
}
export function presetPatch(p: GraphicsPreset): Partial<RenderSettings> { return { ...GRAPHICS_PRESETS[p].values, preset: p }; }

/** Where a picture of this shape ("16:9") sits in a window, with black bars; null = no such shape, fill the window. */
export function letterboxRect(winW: number, winH: number, aspect: string | undefined): { left: number; top: number; width: number; height: number } | null {
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(aspect ?? '');
  const a = m ? Number(m[1]) / Number(m[2]) : 0;
  if (!a || !Number.isFinite(a) || winW <= 0 || winH <= 0) return null;
  const width = Math.round(Math.min(winW, winH * a)), height = Math.round(Math.min(winH, winW / a));
  return { left: Math.floor((winW - width) / 2), top: Math.floor((winH - height) / 2), width, height };
}

/** Out-of-range or hand-edited values never reach the renderer. */
export function validRenderScale(v: unknown) { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.max(0.25, Math.min(2, n)) : 1; }
export function validMaxFps(v: unknown) { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.max(10, Math.min(1000, Math.round(n))) : 0; }
