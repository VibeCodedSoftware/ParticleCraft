// A WorldCraft world: the settings of every generator, hand-made edits (sculpt, paint, placed objects, drawn roads) and
// the logic document whose World blocks can drive those settings. Everything generated comes from this; the geometry is
// never saved, so the same document always gives the same world.
import type { LogicDocument } from '../schema';

export const WORLD_FORMAT = 'craft.world';
export const WORLD_VERSION = 1;

export interface TerrainCfg {
  seed: number; preset: string;
  /** How much an applied node graph's land replaces the generated land (0..1; missing: 1). */ graphBlend?: number;
  /** Finite: the world's width and depth (m). */ width: number; depth: number;
  chunkSize: number; /** Quads per chunk side. */ resolution: number;
  height: number; noiseScale: number; noiseIntensity: number; octaves: number; lacunarity: number; gain: number;
  /** 0 round hills .. 1 sharp ridges. */ sharpness: number;
  valleyDepth: number; /** Flattens the tops: 0 off. */ plateau: number; /** Steep walls between flat levels: 0 off. */ terraces: number;
  canyon: number; /** 1 = sea all round. */ island: number; flatten: number;
  /** Many islands: on (1), how wide a typical one is (m), and how much is land (0..1). */ islands?: number; islandSize?: number; islandLand?: number;
  /** Slope-aware layers: gullies and smoother valleys. */ erosion: number; smooth: number; warp: number; baseHeight: number;
  /** Shapes stacked on the base land, in order, each blended in where its masks allow. */ layers?: TerrainLayer[];
  /** The world as a region of a planet: the planet's land under it, the settings above adding the close-up detail. */ planet?: PlanetRegion;
  endless: boolean; /** Chunks loaded in each direction round the camera. */ viewChunks: number;
  /** Chunks past the load radius before one is recycled. */ unloadMargin: number; /** Chunks built per frame. */ budget: number;
}
/** A whole planet: size (km), how much is sea, continents, mountains, craters, canyons, ice caps and climate. */
export interface PlanetCfg {
  preset: string; seed: number; /** km */ radius: number; /** 0 dry .. 1 all sea. */ ocean: number; /** Typical continent (km). */ continentSize: number;
  mountains: number; /** Highest land above sea (m). */ relief: number; /** Deepest sea (m). */ depth: number;
  craters: number; canyons: number; /** How far ice reaches from the poles (0..1). */ iceCaps: number; /** −1 frozen .. 1 hot. */ temperature: number; moisture: number;
  palette: 'earth' | 'moon' | 'mars' | 'ice' | 'desert' | 'volcanic' | 'alien' | 'mercury' | 'venus' | 'pluto' | 'jupiter' | 'saturn' | 'uranus' | 'neptune';
  /** How thick the air is (0 none: the Moon) and how much of the sky is cloud (0..1). */ atmosphere?: number; clouds?: number;
  /**
   * A gas giant: no ground, only its cloud tops in bands (`bands` how strongly they differ, 0..1) with storm ovals
   * (`storms` 0..1). Rocky (unset): land and sea. `rings` 0..1: rings round it, tilted `ringTilt` degrees.
   */
  kind?: 'rocky' | 'gas'; bands?: number; storms?: number; rings?: number; ringTilt?: number;
}
/** Where on a planet a world sits (degrees), its sea level (m), and how much of the world's own noise is added on top (0..1). */
export interface PlanetRegion { enabled: boolean; planet: PlanetCfg; lat: number; lon: number; sea: number; detail: number }
/**
 * A terrain layer: a shape (its own height, `height` m, at its `scale`) blended into the land so far. Terraces and
 * plateau reshape the land itself (terrace step and plateau top are `height`). Masks: only between `minHeight` and
 * `maxHeight` of the land so far (softened over `fade` m), and only in patches of slow noise (`patchiness` 0 everywhere).
 */
export interface TerrainLayer {
  id: string; name: string; enabled: boolean; seed: number;
  type: 'mountains' | 'hills' | 'ridges' | 'dunes' | 'craters' | 'canyons' | 'outcrops' | 'ramp' | 'terraces' | 'plateau';
  blend: 'add' | 'subtract' | 'max' | 'min' | 'smooth' | 'replace';
  scale: number; height: number; minHeight: number; maxHeight: number; fade: number; patchiness: number; patchScale: number;
  /** Dunes: the wind's direction (°). */ direction: number;
  /** Outcrops: how much of the ground is rock (0..1, default 0.5). Ramp: where its middle lies, along its direction (m). */ amount?: number; offset?: number;
  /** Paints this ground material (rock, sand, dirt...) wherever the layer shapes the land; plants don't grow on rock it paints. */ paint?: string;
}
export interface SurfaceCfg { grass: string; dirt: string; rock: string; sand: string; snow: string; mud: string; gravel: string; slopeRock: number; beachWidth: number; snowLine: number; blend: number;
  /** Random patches of green on the ground. */ greens?: boolean; greenAmount?: number; /** Patch size (m). */ greenScale?: number; greenA?: string; greenB?: string; greenC?: string;
  /**
   * The ground coloured from the land's own data (height, slope, and where an erosion run left them, water flow, wear and
   * sediment) through a palette, as terrain tools' colour ramps do. `palette` '' or missing: off.
   */
  look?: { palette: string; strength: number };
  /**
   * The ground's texture in place of the built-in grass: its colour (albedo), normal and height maps (asset ids), how
   * far one copy reaches (m), and whether the picture's own colours show (else only its light and dark over the ground's).
   */
  groundTex?: { color?: string; normal?: string; height?: string; tile?: number; ownColors?: boolean } }
export interface BiomeCfg { enabled: boolean; seed: number; size: number; temperature: number; moisture: number; transition: number; custom: CustomBiome[] }
export interface CustomBiome { id: string; name: string; temperature: number; moisture: number; ground: string; density: number }

export type LayerKind = 'tree' | 'rock' | 'grass' | 'flower' | 'bush' | 'prop' | 'debris';
export interface ScatterLayer {
  id: string; name: string; kind: LayerKind; enabled: boolean; seed: number;
  /** Generator preset, or "asset:<id>" of a library asset. Several: picked per instance. */ sources: string[];
  density: number; /** Per 100 m². */
  minScale: number; maxScale: number; randomRotation: boolean; align: number;
  minSlope: number; maxSlope: number; minHeight: number; maxHeight: number; biomes: string[];
  clustering: number; clusterSize: number; spacing: number; avoid: boolean;
  /** Grass: 2D cards facing the camera, or standing crossed. */ faceCamera: boolean;
  /** Bends in the wind. */ moves: boolean;
  /** Only grows where it has been painted, instead of everywhere the rules allow. */ paintOnly?: boolean;
  /** Some of them whole-plant fall colours; fallShare of them, 0..1. */ randomColor?: boolean; fallShare?: number;
  /** Takes its colour from the ground under it. */ copyGround?: boolean;
  /** Mixed worlds: each region of the world shows the sources of its own look (realistic, stylized, toon, pixel). */ regional?: boolean;
  /** How thick particular sources grow (per 100 m²), when thinner than the layer's density. */ sourceDensity?: Record<string, number>;
  interact?: InteractCfg; regen?: RegenCfg;
}
export interface InteractCfg { enabled: boolean; action: 'pickup' | 'chop' | 'mine' | 'cut'; distance: number; duration: number; physics: boolean; fall: 'remain' | 'logs' | 'drop' | 'vanish'; resource: string; quantity: number }
export interface RegenCfg { enabled: boolean; seconds: number; variation: number }

/** How the world looks: each style's own trees, leaves, grass and rocks, or all of them together. */
export type WorldStyle = 'realistic' | 'stylized' | 'toon' | 'pixel' | 'mixed';
/** The kind of leaf a tree wears. */
export type LeafStyle = 'realistic' | 'stylized' | 'toon' | 'pixel';
export const LEAF_STYLES: LeafStyle[] = ['realistic', 'stylized', 'toon', 'pixel'];
/** A tree as its wood: every branch a line of nodes. Generated trees can be turned into one and edited; drawn trees are one. */
export interface TreeBranch { /** 0 trunk, 1 branches, 2 and up smaller. */ l: number; /** Nodes, metres from the tree's foot. */ p: [number, number, number][]; /** Radius at each node. */ r: number[]; /** Branch it grows from (-1: none) and the node of that branch it starts at. */ parent: number; at: number }
export interface TreeSkeleton { branches: TreeBranch[] }
export interface TreeCfg { /** Leaf kind: unset = the species' own picture. */ leafStyle?: LeafStyle;
  /** The crown leaning and reaching further to one side (0 even .. 1 strongly one-sided); how much branches bend as they grow (0 .. 1); how many different random shapes a scattered species comes in. */
  asymmetry?: number; curvature?: number; variants?: number;
  height: number; trunk: number; branches: number; levels: number; angle: number; length: number; randomness: number; taper: number; roots: number; leafSize: number; leafDensity: number; leafSpread: number; canopy: 'round' | 'cone' | 'wide' | 'droop' | 'palm' | 'none'; bark: string; leaf: string; leafAsset: string; barkAsset: string; /** Show the leaf picture's own colours, not the leaf colour. */ leafOriginal: boolean; age: number; pixelLeaves: boolean;
  /** Growth forces, for every stage unless a stage changes them. */
  upAttraction?: number; gravity?: number; stiffness?: number; splitChance?: number; splitAngle?: number; breakChance?: number; flatness?: number; phyllotaxis?: number; start?: number;
  /** How much branches compete for light (0 none .. 1 strong). */ light?: number;
  /** Trunk base swelling, and how far from round the trunk is. */ flare?: number; lumps?: number;
  /** Per stage: 0 trunk, 1 branches, up to twigs. */ stages?: GrowthStage[];
  /** Leaf particles: how leaves grow from the wood. */ hair?: Partial<LeafHairCfg>;
  /** How the bark material repeats and turns. */ barkU?: number; barkV?: number; barkRot?: number }
/** A wood material on a supplied tree model: which set, and its UV. */
export interface ModelWood { set: number; u: number; v: number; rot: number }
/** Leaves grown out of the wood, like hair particles. */
export interface LeafHairCfg {
  /** More or fewer leaves. */ amount: number;
  /** Only the outermost twigs, or all the wood from a stage up. */ where: 'tips' | 'all'; fromStage: number;
  /** Along each branch (0 base, 1 tip); on a supplied model, up the tree. */ start: number; end: number;
  /** Crowds them toward the tips. */ tipBias: number;
  /** Stalk: how far out from the wood, in metres. */ length: number;
  /** Away from the branch: 0 along it, 90 straight out. */ angle: number;
  /** Random direction. */ random: number; droop: number; sizeRandom: number;
  /** Children: leaves at each spot, and how far apart. */ clumps: number; clumpSize: number;
  /** Most leaves on one tree. */ limit: number;
  /** Supplied models: leaf size as % of tree height, how thin the wood must be (0..1 of the thinnest), and the picture. */ size?: number; thinOnly?: number; picture?: string;
}
/** What one stage of the Growth Stack changes. count, length and radius multiply; angle adds; the rest replace. */
export interface GrowthStage { count?: number; length?: number; angle?: number; radius?: number; start?: number; end?: number; up?: number; gravity?: number; split?: number; splitAngle?: number; flat?: number; brk?: number }
/** What GameCraft needs to go on generating a world for ever: its rules, and its objects baked once each. */
export interface EndlessSettings {
  /** Changes with each export: a new one rebuilds the stream. */ id: string;
  config: WorldConfig; edits: WorldEdits; roads: RoadPath[];
  /** Model per source, keyed by streamKey(). `far`: a picture card for the distance. */ sources: Record<string, { asset: string; scale: number; far?: string }>;
  /** Spawnable structures: model, scale and footprint for collision. */ structures: Record<string, { asset: string; scale: number; size: [number, number, number] }>;
  /** The ground picture, in greys. */ ground?: string;
  /** Chunks kept loaded round the player. */ viewChunks: number;
  /** A finite, baked world: its land and objects are ordinary scene objects, and only its grass is generated round the player. */ grassOnly?: boolean;
}
/** Where an exported grey picture's average sits (leaving headroom for its light parts): a colour over it is divided by this to come out true. */
export const GRAY_MEAN = 0.58;
/** One source in one look: fall colour -1 for its own, gray when it takes the ground's colour. */
export const streamKey = (source: string, fall: number, gray: boolean) => `${fall}|${gray ? 1 : 0}|${source}`;

export interface LeafCfg { sizeMin: number; sizeMax: number; healthy: number; yellow: number; orange: number; brown: number; variation: number; brightness: number; saturation: number; opacity: number; cluster: number; seed: number }
export interface RockCfg { size: number; detail: number; roughness: number; smooth: number; deform: number; fractures: number; sharpness: number; variation: number; color: string; lowPoly: boolean; elongate: number }
export interface GeneratorPreset<T> { id: string; name: string; cfg: T }

export interface WaterCfg { enabled: boolean; level: number; waves: number; waveDirection: number; waveSpeed: number; color: string; opacity: number; foam: boolean; rivers: number; riverSeed: number; riverWidth: number; riverDepth: number; meander: number; branching: number; lakes: number;
  /** GameCraft's water look. */ deepColor?: string; clarity?: number; foamWidth?: number; detail?: number; highlights?: number; turbulence?: number; waveSeed?: number;
  /** Waterfalls (ParticleCraft's Waterfall and mist) where rivers drop steeply; missing: on. */ waterfalls?: boolean }
export interface RoadPath { /** Realistic (detailed surface, soft edges blending into the land) or stylized (the cartoon walkway). Unset: the world's look. */ look?: 'realistic' | 'stylized';
  /** In snow: ploughed (cleared, banks of snow along its sides, a few clumps left on it) or covered (under the snow, packed tyre tracks). Unset: ploughed. */ snow?: 'ploughed' | 'covered'; id: string; kind: string; width: number; points: [number, number][]; conform: number; bridge: boolean; material: string; decorate: number }
export interface SnowCfg { /** Extra snow toward the peaks (0..1), how much cold climates hold snow lower (0..1), and how much more lies on slopes facing away from the sun (0..1). */ peaks?: number; temperature?: number; aspect?: number;
  /** Icicles hanging from tree branches: how many and how long (0 none .. 1). */ icicles?: number;
  enabled: boolean; coverage: number; startHeight: number; blendHeight: number; maxSlope: number; color: string; onObjects: number; thickness: number; variation: number; seed: number; fall: number; footprints: boolean; footprintDepth: number; footprintSize: number; recovery: number; trackLife: number; resistance: number }
export interface SeasonCfg { enabled: boolean; season: 'spring' | 'summer' | 'autumn' | 'winter'; next: 'spring' | 'summer' | 'autumn' | 'winter'; blend: number; speed: number; intensity: number; preserve: number; brightness: number; saturation: number; hue: number; variation: number; seed: number; treeLeaves: boolean; grass: boolean; bushes: boolean; flowers: boolean }
export interface WeatherCfg { type: 'clear' | 'rain' | 'snow' | 'fog' | 'storm' | 'dust' | 'mist'; intensity: number; windDirection: number; windSpeed: number; windStrength: number; gusts: number; fog: number; clouds: number; sway: boolean; grassSway: boolean; swayAmount: number;
  /** Clouds: how they're drawn, height above the peaks (m), depth and size multipliers, solidity, quality, fog particles (thousands). */
  cloudStyle?: 'volumetric' | 'particles' | 'both'; cloudHeight?: number; cloudThickness?: number; cloudSize?: number; cloudDensity?: number; cloudSteps?: number; cloudPuffs?: number;
  /** Cloud shapes, how much they differ from one another (0..1), and their own seed. */
  cloudKind?: CloudKind; cloudVariety?: number; cloudSeed?: number;
  /** Rain and snow as SpriteCraft's weather presets draw them (falls back to the type's own). */
  fallPreset?: string; splashes?: boolean;
  /**
   * Falling leaves: ParticleCraft's Falling leaves (or, in a wind, Leaves in the wind) under the trees round the camera,
   * in the world's look; `leafAmount` how many (autumn doubles it). Missing: off.
   */
  leaves?: boolean; leafAmount?: number }
export type CloudKind = 'mixed' | 'cumulus' | 'stratus' | 'cirrus' | 'towering';
export interface SkyCfg { time: number; dayNight: boolean; sunStrength: number; ambient: number; stars: boolean }
export interface OptimizeCfg { profile: 'high' | 'balanced' | 'performance' | 'mobile' | 'openworld'; lodDistance: number; cull: number; grassDistance: number; impostors: boolean; /** What's outside the view isn't drawn (absent = on). */ frustum?: boolean }

/** Imported objects placed or spawned deterministically. */
export interface Placed { id: string; asset: string; name: string; x: number; y: number; z: number; ry: number; scale: number; snap: boolean; group?: string; locked?: boolean; interact?: InteractCfg;
  /** A generated tree's own wood, once its nodes have been edited or it was drawn by hand; `leaves` false: bare wood (a drawn tree before its leaves are added). */ tree?: { skeleton: TreeSkeleton; leaves?: boolean } }
export interface StructureSpawn {
  id: string; name: string; enabled: boolean; seed: number; assets: string[];
  mode: 'fixed' | 'region' | 'scatter';
  /** fixed: exact spots. */ fixed: { x: number; z: number; ry: number }[];
  /** region: inside this box; scatter: anywhere. */ region: { x: number; z: number; w: number; d: number };
  /** One attempt per cell of this size (m). */ cell: number; chance: number; minDistance: number;
  minHeight: number; maxHeight: number; maxSlope: number; biomes: string[]; fixedRotation: number; randomRotation: boolean; scale: number; persistent: boolean;
}
/** Caves through the whole world (see caves.ts). `y`: the shallowest a tunnel runs below ground, `depth` the deepest.
 * `tunnels`: how many per area. `size`: a tunnel's typical length. `entrances`: the share that open at the surface.
 * (`x`, `z` and `stalactites` are from the earlier single cave network; kept so older worlds load.) */
export interface CaveCfg { enabled: boolean; seed: number; x: number; y: number; z: number; size: number; tunnels: number; tunnelWidth: number; chamber: number; roughness: number; branching: number; voxel: number; stalactites: number;
  depth?: number; entrances?: number;
  /** Smooth rock walls (default) or blocks. */ style?: 'smooth' | 'voxel' }
export interface VoxelCfg { enabled: boolean; size: number; smooth: boolean; target: 'terrain' | 'objects' | 'all' }
export interface ParticleRef { id: string; effect: string; name: string; x: number; y: number; z: number; attach?: string; scale: number; /** Turn around the up axis (degrees). */ rotation?: number; /** Pushed by the world's wind (default on). */ wind?: boolean }
export interface SoundRef { id: string; asset: string; name: string; x: number; y: number; z: number; radius: number; volume: number }

export interface WorldConfig {
  terrain: TerrainCfg; surface: SurfaceCfg; biomes: BiomeCfg; layers: ScatterLayer[];
  trees: GeneratorPreset<TreeCfg>[]; rocks: GeneratorPreset<RockCfg>[]; leaves: LeafCfg;
  /** Leaf particles on supplied tree models, by asset id. */ modelLeaves?: Record<string, Partial<LeafHairCfg>>;
  /** Wood material on supplied tree models, by asset id. */ modelWood?: Record<string, Partial<ModelWood>>;
  water: WaterCfg; snow: SnowCfg; season: SeasonCfg; weather: WeatherCfg; sky: SkyCfg; optimize: OptimizeCfg;
  spawns: StructureSpawn[]; cave: CaveCfg; voxel: VoxelCfg;
  /** The world's look: which trees, leaves, grass and rocks the scatter layers use. */ style?: WorldStyle;
  /** The grass picked for each look (asset id). */ grassChoice?: Partial<Record<LeafStyle, string>>;
}

/** Sparse hand edits on a grid of `cell` metres. Keys are "x,z" of the cell. */
export interface WorldEdits {
  cell: number;
  height: Record<string, number>;
  /** Painted ground material weight: material name to cell to 0..1. */
  paint: Record<string, Record<string, number>>;
  /** Painted scatter density: layer id to cell to multiplier (0 = erased). */
  density: Record<string, Record<string, number>>;
  snow: Record<string, number>;
  biome: Record<string, string>;
  holes: Record<string, number>;
  /** Objects collected or destroyed by uid. */
  removed: string[];
  /** Whole-world results of a simulation (erosion), stored compactly as dense grids instead of one edit per cell. */
  grids?: EditGrid[];
  /** How the hand-sculpted layer is laid over the generated land (none: added as it is). */
  layer?: SculptLayerCfg;
}
/**
 * The sculpt layer's settings: its heights scaled; laid on as Add (both ways), Raise only or Lower only; and, where it
 * has been sculpted, the ground snapped to steps of `step` metres (terraced levels).
 */
export interface SculptLayerCfg { scale?: number; op?: 'add' | 'raise' | 'lower'; step?: number;
  /** Metres added wherever the land was sculpted. */ offset?: number;
  /** How much of the sculpted result shows (0: the land as generated, 1: all of it). */ blend?: number }
/**
 * A dense grid over the world from (`x0`, `z0`), `nx` × `nz` points `cell` metres apart, base64 encoded: `height` as
 * 16-bit centimetres added to the land, `paint` (material → bytes, 0..255 as 0..1 weight) and `density` (scatter layer
 * id → bytes, painted density).
 */
export interface EditGrid { id: string; label: string; x0: number; z0: number; nx: number; nz: number; cell: number; height?: string; paint?: Record<string, string>; density?: Record<string, string>;
  /** Data maps the simulation left (bytes, 0..255): `flow`, `wear`, `deposit`, for the ground's look. */ maps?: Record<string, string>;
  /**
   * The land itself rather than a change to it (the node graph): `height` is absolute, in 5 cm steps, and takes the
   * place of the generated land (by the terrain's `graphBlend`); rivers, roads and hand sculpting still apply on top.
   */
  absolute?: boolean }

export interface WorldDoc {
  format: typeof WORLD_FORMAT; schemaVersion: number; id: string; name: string; created: string; modified: string;
  config: WorldConfig; edits: WorldEdits;
  placed: Placed[]; roads: RoadPath[]; particles: ParticleRef[]; sounds: SoundRef[];
  logic: LogicDocument;
  /** Assets imported by the user (library assets are referenced directly). */
  assets: { id: string; name: string; kind: 'model' | 'texture'; group: string; tags: string[]; favorite?: boolean }[];
  favorites: string[];
  /** Saved settings by category: name to a copy of that part of the config. */
  presets: Record<string, Record<string, unknown>>;
  /** The terrain node graph (the Node graph window), kept so it can be changed and applied again. */
  graph?: import('./terrainGraph').TerrainGraph;
}

export const deepCopy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
