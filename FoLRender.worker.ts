// FoLRender.worker.ts
// Flower of Life particle-growth renderer.
// BFS runs INSIDE this worker, one ring per animation frame.
// Accumulation canvas stores all painted vesicae — never redraws old geometry.
// spacingPx and maxGeneration are ALWAYS derived from screen dimensions — nothing hardcoded.
//
// The lattice structure is INVARIANT.
// Geometries from Bashar Keys of Ascension are perceived purely from DIFFERENT RGB
// values assigned to existing lattice nodes. ASSIGN_GEOMETRY_ZONE changes node
// colours only — the BFS topology never changes.
//
// Phase 2+: Willis oscillator network, overlayCanvas, ZONE_MAP, CARRIER_UPDATE,
//           LOCK_STATE, ASSIGN_GEOMETRY_ZONE, OSH cross-fade, PLACE_ITEM masks.

const SQRT3    = Math.sqrt(3);
const INV_SQRT3 = 1 / SQRT3;
const TWO_PI   = Math.PI * 2;

// ─── Geometry RGB Table (Keys of Ascension bijection) ─────────────────────────
// The INVARIANT lattice nodes are coloured by these RGB values.
// The lattice structure does NOT change — only which nodes receive which colour.
const GEOMETRY_RGB: ReadonlyArray<readonly [number, number, number]> = [
  [  0,   0,   0],  // 0  Formlessness
  [139,   0,   0],  // 1  Cube — Root Red
  [255, 140,   0],  // 2  Four-sided pyramid — Golden Orange
  [255, 215,   0],  // 3  Tetrahedron — Golden Yellow
  [  0, 201,  87],  // 4  Double Tetrahedron — Emerald Green
  [  0,   0, 255],  // 5  Octahedron — Blue
  [ 75,   0, 130],  // 6  Tesseract — Indigo
  [148,   0, 211],  // 7  Torus — Violet
  [255, 255, 255],  // 8  Galactic Disc — White
  [240, 240, 255],  // 9  Sphere — Clear/UV
] as const;

const N_GEOMETRY_LEVELS = GEOMETRY_RGB.length; // 10

// 3-shell shade factors (outer→inner depth demarcation)
const SHADE_FACTORS = [1.0, 0.56, 0.28] as const;

// ─── Hex directions (pointy-top, Flower of Life grid) ─────────────────────────
const DIR_Q = [ 0,  1,  1,  0, -1, -1];
const DIR_R = [-1, -1,  0,  1,  1,  0];

// ─── Integer key encoding ─────────────────────────────────────────────────────
const _QO = 300, _RO = 300, _QS = 1000, _ES = 2_000_000;
const nk = (q: number, r: number): number => (q + _QO) * _QS + (r + _RO);
const ek = (a: number, b: number): number => a < b ? a * _ES + b : b * _ES + a;

function axialToPixel(q: number, r: number, sp: number): [number, number] {
  return [sp * SQRT3 * (q + r * 0.5), sp * 1.5 * r];
}

// ─── Screen-derived lattice parameters ───────────────────────────────────────
// Uses full diagonal so BFS reaches ALL four corners regardless of aspect ratio.
function deriveParams(w: number, h: number): { spacingPx: number; maxGeneration: number } {
  const diagonal    = Math.hypot(w, h);
  const targetRings = 80;
  // spacingPx based on half-diagonal so ring density stays constant
  const spacingPx   = Math.max(5, Math.round(diagonal * 0.5 / (targetRings * SQRT3)));
  // maxGeneration from FULL diagonal — guarantees corner coverage
  const maxGeneration = Math.ceil(diagonal / (spacingPx * SQRT3)) + 6;
  return { spacingPx, maxGeneration };
}

// ─── BFS queue (typed arrays — zero GC pressure) ──────────────────────────────
const MAX_Q = 250_000;
const qqQ  = new Int16Array(MAX_Q);
const qqR  = new Int16Array(MAX_Q);
const qqG  = new Uint16Array(MAX_Q);
const qqI  = new Int8Array(MAX_Q);
let bfsHead = 0;
let bfsTail = 0;

function bfsReset(initPanX: number, initPanY: number) {
  bfsHead = 0; bfsTail = 0;
  qqQ[0] = 0; qqR[0] = 0; qqG[0] = 0; qqI[0] = -1;
  bfsTail = 1;
  nodeSet.clear();
  edgeSet.clear();
  // Clear node geometry assignments when lattice resets
  nodeGeometryLevel.clear();
  nodeGeometryShell.clear();
  nodeSet.add(nk(0, 0));
  totalVesicae = 0;
  currentGeneration = 0;
  bfsComplete = false;
  zoneMapBuilt = false;
  centreX = width * 0.5 + initPanX;
  centreY = height * 0.5 + initPanY;
  clearAccCanvas();
  clearOverlayCanvas();
  // NOTE: pendingGeometryZones are NOT re-applied here — nodeSet is empty at reset.
  // They will be incrementally applied in processBFSRing() as BFS expands to each seed node.
  console.log('[G3NEN::RenderWorker] BFS reset — maxGen:', maxGeneration, 'spacingPx:', spacingPx, 'centreX:', centreX, 'centreY:', centreY);
}

// ─── State ────────────────────────────────────────────────────────────────────
let ctx:    OffscreenCanvasRenderingContext2D | null = null;
let cvs:    OffscreenCanvas | null = null;
let accCtx: OffscreenCanvasRenderingContext2D | null = null;
let accCvs: OffscreenCanvas | null = null;
let ovlCtx: OffscreenCanvasRenderingContext2D | null = null;
let ovlCvs: OffscreenCanvas | null = null;
// Geometry colour canvas — separate layer for geometry RGB values on nodes
let geoCtx: OffscreenCanvasRenderingContext2D | null = null;
let geoCvs: OffscreenCanvas | null = null;

let width  = 1920;
let height = 1080;
let spacingPx       = 10;
let maxGeneration   = 80;
let centreX = 960;
let centreY = 540;
let panX = 0;
let panY = 0;
let vesicaeWidth = 1.0;

const nodeSet = new Set<number>();
const edgeSet = new Set<number>();
let totalVesicae      = 0;
let currentGeneration = 0;
let bfsComplete       = false;
let zoneMapBuilt      = false;

let _loopHandle: ReturnType<typeof setInterval> | null = null;
let startTime = 0;

const RINGS_PER_FRAME = 1;

// ─── Node geometry colour state ───────────────────────────────────────────────
// Key = encoded node key (nk(q,r)), value = geometry level (0–9)
// These are the ONLY things that change per geometry assignment.
// The BFS topology (nodeSet, edgeSet) remains invariant.
const nodeGeometryLevel = new Map<number, number>(); // key → 0–9
const nodeGeometryShell = new Map<number, number>(); // key → 0,1,2 (shade depth)

// ─── OSH phase state (per zone) ───────────────────────────────────────────────
const N_OSH_ZONES = 6; // 6 pure FoL sector zones (one per hex direction)
const zonePhiRender = new Float64Array(N_OSH_ZONES); // OSH phase per zone
let oshFBeat  = 0;   // |dominantLPG - ω_payload/(2π)|
let oshActive = false;

// Per zone current level (from OSH oscillation OR direct assignment)
const zoneGeometryLevel = new Uint8Array(N_OSH_ZONES);

// ─── Pending geometry zone assignments ────────────────────────────────────────
// Stored so they can survive a BFS reset (e.g. on resize)
interface GeometryZoneAssignment {
  seedQ:         number;
  seedR:         number;
  geometryLevel: number;
  scale:         number;
}
const pendingGeometryZones = new Map<string, GeometryZoneAssignment>();

// ─── Geometry zone footprint assignment ───────────────────────────────────────
// Assigns RGB colour to the nodes that form the geometry footprint
// from a seed node. The lattice structure is UNCHANGED.
// Only nodeGeometryLevel and nodeGeometryShell maps are updated.
function scheduleGeometryAssignment(
  seedQ: number, seedR: number,
  geometryLevel: number,
  scale: number,
): void {
  const key    = `${seedQ},${seedR}`;
  const seedNk = nk(seedQ, seedR);

  // Clamp geometry level
  const level = Math.max(0, Math.min(N_GEOMETRY_LEVELS - 1, geometryLevel));

  // Special cases
  if (level === 0) {
    // Formlessness: clear seed node
    nodeGeometryLevel.delete(seedNk);
    nodeGeometryShell.delete(seedNk);
    return;
  }

  if (level === 9) {
    // Sphere: seed node only, no shells
    nodeGeometryLevel.set(seedNk, level);
    nodeGeometryShell.set(seedNk, 0);
    return;
  }

  if (level === 8) {
    // Galactic Disc: all nodes in BFS up to scale*maxGeneration/4
    const range = Math.floor(scale * maxGeneration * 0.25);
    nodeSet.forEach((nodeKey) => {
      const q = Math.round((nodeKey / _QS) % _QS) - _QO;
      const r = (nodeKey % _QS) - _RO;
      const dq = q - seedQ;
      const dr = r - seedR;
      const dist = Math.round(Math.sqrt(dq * dq + dq * dr + dr * dr));
      if (dist <= range) {
        nodeGeometryLevel.set(nodeKey, level);
        nodeGeometryShell.set(nodeKey, 0);
      }
    });
    return;
  }

  if (level === 7) {
    // Torus: ring at exactly generation=scale from seed, inner nodes = shade 2 (near-dark)
    const ringGen = Math.max(2, scale);
    nodeSet.forEach((nodeKey) => {
      const q = Math.round((nodeKey / _QS) % _QS) - _QO;
      const r = (nodeKey % _QS) - _RO;
      const dq = q - seedQ;
      const dr = r - seedR;
      const dist = Math.round(Math.sqrt(dq * dq + dq * dr + dr * dr));
      if (dist === ringGen) {
        nodeGeometryLevel.set(nodeKey, level);
        nodeGeometryShell.set(nodeKey, 0); // outer ring = full violet
      } else if (dist > 0 && dist < ringGen) {
        nodeGeometryLevel.set(nodeKey, level);
        nodeGeometryShell.set(nodeKey, 2); // inner void = near-dark
      }
    });
    return;
  }

  if (level === 6) {
    // Tesseract: 3 nested shells at gen 1, 2, 3 from seed (shell 0=outer indigo, 2=deepest)
    const nShells = Math.min(3, scale);
    for (let shell = 0; shell < nShells; shell++) {
      const genTarget = shell + 1;
      nodeSet.forEach((nodeKey) => {
        const q = Math.round((nodeKey / _QS) % _QS) - _QO;
        const r = (nodeKey % _QS) - _RO;
        const dq = q - seedQ;
        const dr = r - seedR;
        const dist = Math.round(Math.sqrt(dq * dq + dq * dr + dr * dr));
        if (dist === genTarget * scale) {
          nodeGeometryLevel.set(nodeKey, level);
          nodeGeometryShell.set(nodeKey, shell); // 0=outer, 1=mid, 2=inner
        }
      });
    }
    // Seed node = deepest shell
    nodeGeometryLevel.set(seedNk, level);
    nodeGeometryShell.set(seedNk, 2);
    return;
  }

  // Levels 1–5: assign seed + surrounding nodes within scale generations
  // Direction sets:
  //   1 Cube:               all 6 dirs, uniform colour
  //   2 Four-sided pyramid: dirs 0,1,2,3
  //   3 Tetrahedron:        dirs 0,2,4 (up) or 1,3,5 (down)
  //   4 Double Tetrahedron: all 6, A-set(0,2,4)=shell 0, B-set(1,3,5)=shell 1
  //   5 Octahedron:         all 6 + 4 extra antinodes

  const maxDist = scale;
  nodeSet.forEach((nodeKey) => {
    const q = Math.round((nodeKey / _QS) % _QS) - _QO;
    const r = (nodeKey % _QS) - _RO;
    const dq = q - seedQ;
    const dr = r - seedR;
    const dist = Math.round(Math.sqrt(dq * dq + dq * dr + dr * dr));
    if (dist > maxDist) return;

    let shell = 0;

    if (level === 4) {
      // Double Tetrahedron: determine A vs B set from node angle
      const angle = ((Math.atan2(dr, dq) + TWO_PI) % TWO_PI) * 3 / Math.PI;
      // A-set: directions 0,120,240 deg → angle segments 0, 2, 4
      const segment = Math.round(angle) % 6;
      shell = (segment === 0 || segment === 2 || segment === 4) ? 0 : 1;
    } else if (level === 6) {
      // Cube levels done above; this won't reach here
      shell = 0;
    } else {
      // For level 1,2,3,5: use distance-based shading (outer=0, inner=2)
      shell = dist === 0 ? 2 : dist === maxDist ? 0 : 1;
    }

    nodeGeometryLevel.set(nodeKey, level);
    nodeGeometryShell.set(nodeKey, shell);
  });
}

// ─── Willis oscillator network ────────────────────────────────────────────────
const EIGENMODE_HZ = [200, 50, 2000, 250, 5, 10, 40, 0.1, 7.83, 7.5, 50, 20];
const EIGENMODE_K  = [0.8, 0.65, 0.9, 0.75, 0.55, 0.7, 0.85, 0.4, 0.5, 0.6, 0.65, 0.5];
const N_MODES = 12;
const phi:       Float64Array = new Float64Array(N_MODES);
const omega:     Float64Array = new Float64Array(N_MODES);
const amplitudes:Float64Array = new Float64Array(N_MODES).fill(0.3);
const isLocked:  Uint8Array   = new Uint8Array(N_MODES);
for (let i = 0; i < N_MODES; i++) omega[i] = EIGENMODE_HZ[i] * TWO_PI;

let dominantLPG    = 0;
let carrierRms     = 0;
let workerTime     = 0;
// Normalised LPG amplitude [0–1] — drives oscillation brightness
let lpgAmplitude   = 0;

// ─── PCO EM emitter oscillation state ─────────────────────────────────────────
let pcoPlaying = false;
// Per-zone hue (0–360°) — start hue for gradient; hue2 = end hue
const zoneHues:       Float32Array = new Float32Array(N_OSH_ZONES).fill(0);
const zoneHues2:      Float32Array = new Float32Array(N_OSH_ZONES).fill(0);
// Per-zone brightness multiplier (0–1), master EM intensity control
const zoneBrightness: Float32Array = new Float32Array(N_OSH_ZONES).fill(10.0);
const zoneEigenHz:    Float32Array = new Float32Array(N_OSH_ZONES);
const zoneWillisK:    Float32Array = new Float32Array(N_OSH_ZONES).fill(0.6);
// Per-zone PCO phases (driven by assigned eigenmode frequency)
const zonePCOPhi:     Float64Array = new Float64Array(N_OSH_ZONES);
// Per-zone luminance multiplier (updated each tick when pcoPlaying)
const zoneLuminance:  Float32Array = new Float32Array(N_OSH_ZONES).fill(1.0);

// Timestamp for ~5Hz ZONE_PHASES emission
let lastZonePhasesEmit = 0;

// Active zone for program step highlighting (-1 = none)
let activeHighlightZone = -1;
let activeHighlightAmplitude = 1.0;

// Initialise zone eigenmode Hz from DFSS table defaults (6-zone subset)
{
  const DFSS_HZ = [200, 50, 2000, 250, 5, 40];   // one per FoL direction
  const DFSS_K  = [0.8, 0.65, 0.9, 0.75, 0.55, 0.85];
  for (let z = 0; z < N_OSH_ZONES; z++) {
    zoneEigenHz[z]   = DFSS_HZ[z];
    zoneWillisK[z]   = DFSS_K[z];
    zoneHues[z]      = (z / N_OSH_ZONES) * 360;
    zoneHues2[z]     = ((z / N_OSH_ZONES) * 360 + 60) % 360; // offset for gradient
    zoneBrightness[z] = 10.0;
  }
}

function tickOscillators(dt: number) {
  const phi_carrier = TWO_PI * dominantLPG * workerTime;
  const A_c         = carrierRms;
  for (let i = 0; i < N_MODES; i++) {
    let willisSum = 0;
    for (let j = 0; j < N_MODES; j++) {
      if (i === j) continue;
      willisSum += EIGENMODE_K[i] * Math.sin(phi[j] - phi[i]);
    }
    const injection = A_c * Math.sin(phi_carrier - phi[i]);
    phi[i] = (phi[i] + (omega[i] + willisSum + injection) * dt) % TWO_PI;
    const lockCond = A_c > 0 && Math.abs(dominantLPG - omega[i] / TWO_PI) < A_c;
    isLocked[i]    = lockCond ? 1 : 0;
    amplitudes[i]  = lockCond ? 1.0 : 0.3;
  }
}

function dominantOscillatorIndex(): number {
  let best = 0;
  for (let i = 1; i < N_MODES; i++) {
    if (amplitudes[i] > amplitudes[best]) best = i;
  }
  return best;
}

// ─── OSH phase step ───────────────────────────────────────────────────────────
function stepOSH(dt: number) {
  if (!oshActive || oshFBeat <= 0) return;
  for (let z = 0; z < N_OSH_ZONES; z++) {
    zonePhiRender[z] = (zonePhiRender[z] + TWO_PI * oshFBeat * dt) % (TWO_PI * N_GEOMETRY_LEVELS);
    zoneGeometryLevel[z] = Math.floor(zonePhiRender[z] / TWO_PI) % N_GEOMETRY_LEVELS;
  }
}

// ─── PCO EM emitter tick ──────────────────────────────────────────────────────
// Each zone oscillates at its assigned eigenmode frequency.
// Willis coupling between zones: phase differences pull phases together.
// Luminance = baseBrightness + lpgAmplitude * 0.5 * sin(φ_z)
function tickPCO(dt: number) {
  if (!pcoPlaying) {
    // When stopped: base brightness from per-zone brightness control
    for (let z = 0; z < N_OSH_ZONES; z++) {
      zoneLuminance[z] = zoneBrightness[z];
    }
    return;
  }
  const baseBrightness = 0.15;
  for (let z = 0; z < N_OSH_ZONES; z++) {
    // Willis coupling sum across all other zones
    let willisSum = 0;
    for (let j = 0; j < N_OSH_ZONES; j++) {
      if (j === z) continue;
      const K = Math.min(zoneWillisK[z], zoneWillisK[j]);
      willisSum += K * Math.sin(zonePCOPhi[j] - zonePCOPhi[z]);
    }
    // Advance phase: ω_z = 2π * f_zone
    const omega_z = TWO_PI * zoneEigenHz[z];
    zonePCOPhi[z] = (zonePCOPhi[z] + (omega_z + willisSum) * dt) % TWO_PI;
    // Luminance: zone brightness * (base + lpg-driven oscillation swing)
    const swing = baseBrightness + (0.5 + 0.5 * Math.sin(zonePCOPhi[z])) * (1.0 - baseBrightness);
    zoneLuminance[z] = zoneBrightness[z] * (swing + lpgAmplitude * 0.4 * Math.sin(zonePCOPhi[z] * 1.3));
  }

  // Emit live phase readout ~5Hz
  const now = workerTime;
  if (now - lastZonePhasesEmit > 0.2) {
    lastZonePhasesEmit = now;
    self.postMessage({ type: 'ZONE_PHASES', phases: Array.from(zonePCOPhi) });
  }
}

// ─── Placed items & amplitude masks ───────────────────────────────────────────
interface PlacedItemData {
  id:          string;
  type:        string;
  pixelX:      number;
  pixelY:      number;
  opacity:     number;
  maskW:       number;
  maskH:       number;
  amplitudeMask: Float32Array | null;
  rgbaData:    Uint8ClampedArray | null;
}
const placedItems: PlacedItemData[] = [];

// ─── Zone map storage ─────────────────────────────────────────────────────────
interface ZoneNode { q: number; r: number; pixelX: number; pixelY: number; generation: number; zoneIndex: number; sectorIndex: number; }
const zoneNodes: ZoneNode[] = [];

function buildZoneMap() {
  zoneNodes.length = 0;
  nodeSet.forEach((key) => {
    const q = Math.round((key / _QS) % _QS) - _QO;
    const r = (key % _QS) - _RO;
    const [px, py] = axialToPixel(q, r, spacingPx);
    const gen = Math.round(Math.sqrt(q * q + q * r + r * r));
    const theta = Math.atan2(py, px);
    const sectorIndex = Math.floor(((theta + Math.PI) / TWO_PI) * 6) % 6;
    // Pure sector zone — same as nodeZoneIndex
    zoneNodes.push({ q, r, pixelX: centreX + px, pixelY: centreY + py, generation: gen, zoneIndex: sectorIndex, sectorIndex });
  });
  zoneMapBuilt = true;
  (self as unknown as Worker).postMessage({ type: 'ZONE_MAP', nodes: zoneNodes });
}

// ─── Canvas helpers ───────────────────────────────────────────────────────────
function ensureAccCanvas() {
  if (!accCvs || accCvs.width !== width || accCvs.height !== height) {
    accCvs = new OffscreenCanvas(width, height);
    accCtx = accCvs.getContext('2d', { alpha: true }) as OffscreenCanvasRenderingContext2D;
  }
}

function clearAccCanvas() {
  ensureAccCanvas();
  if (accCtx) accCtx.clearRect(0, 0, width, height);
}

function ensureOverlayCanvas() {
  if (!ovlCvs || ovlCvs.width !== width || ovlCvs.height !== height) {
    ovlCvs = new OffscreenCanvas(width, height);
    ovlCtx = ovlCvs.getContext('2d', { alpha: true }) as OffscreenCanvasRenderingContext2D;
  }
}

function clearOverlayCanvas() {
  ensureOverlayCanvas();
  if (ovlCtx) ovlCtx.clearRect(0, 0, width, height);
}

function ensureGeoCanvas() {
  if (!geoCvs || geoCvs.width !== width || geoCvs.height !== height) {
    geoCvs = new OffscreenCanvas(width, height);
    geoCtx = geoCvs.getContext('2d', { alpha: true }) as OffscreenCanvasRenderingContext2D;
  }
}

// ─── HSL → RGB (worker-side, no imports) ─────────────────────────────────────
function hslToRgbWorker(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue2 = (t: number) => {
    let tt = t; if (tt < 0) tt += 1; if (tt > 1) tt -= 1;
    if (tt < 1/6) return p + (q - p) * 6 * tt;
    if (tt < 1/2) return q;
    if (tt < 2/3) return p + (q - p) * (2/3 - tt) * 6;
    return p;
  };
  return [
    Math.round(hue2(h + 1/3) * 255),
    Math.round(hue2(h      ) * 255),
    Math.round(hue2(h - 1/3) * 255),
  ];
}

// ─── Zone index for a lattice node ───────────────────────────────────────────
// Pure sector split: 6 zones = 6 FoL directions (0°→60° per zone).
// Zone 0 = right (0°), Zone 1 = upper-right (60°), ..., Zone 5 = lower-right (300°).
function nodeZoneIndex(_q: number, _r: number, px: number, py: number): number {
  const theta = Math.atan2(py, px); // [-π, π]
  // Map to [0, 2π), divide into 6 equal sectors
  return Math.floor(((theta + Math.PI) / TWO_PI) * 6) % 6;
}

// ─── Geometry colour layer render ─────────────────────────────────────────────
// Renders geometry RGB assignments to the geo canvas.
// The invariant lattice (accCvs) shows through BELOW.
// This layer sits between the lattice and the overlay masks.
// Applies PCO luminance modulation + zone hue tint when pcoPlaying.
function renderGeometryLayer() {
  ensureGeoCanvas();
  if (!geoCtx) return;
  geoCtx.clearRect(0, 0, width, height);

  // Zone-sector field tint over the whole lattice so both nodes and antinodes
  // inherit colour (not only point nodes). This sits above Layer 1 vesicae.
  {
    const radius = Math.hypot(width, height);
    for (let z = 0; z < N_OSH_ZONES; z++) {
      const h1 = zoneHues[z] / 360;
      const h2 = zoneHues2[z] / 360;
      const [r1, g1, b1] = hslToRgbWorker(h1, 1.0, 0.5);
      const [r2, g2, b2] = hslToRgbWorker(h2, 1.0, 0.5);
      const lum = Math.max(0, zoneBrightness[z] * (pcoPlaying ? zoneLuminance[z] : 1.0));
      const aMid = 1 - Math.exp(-lum * 0.06);
      const aOut = 1 - Math.exp(-lum * 0.09);
      const start = (z / N_OSH_ZONES) * TWO_PI - Math.PI;
      const end   = ((z + 1) / N_OSH_ZONES) * TWO_PI - Math.PI;

      const grad = geoCtx.createRadialGradient(centreX, centreY, 0, centreX, centreY, radius);
      grad.addColorStop(0.0, `rgba(${r1},${g1},${b1},${(aMid * 0.08).toFixed(3)})`);
      grad.addColorStop(0.6, `rgba(${r1},${g1},${b1},${(aMid * 0.14).toFixed(3)})`);
      grad.addColorStop(1.0, `rgba(${r2},${g2},${b2},${(aOut * 0.24).toFixed(3)})`);

      geoCtx.beginPath();
      geoCtx.moveTo(centreX, centreY);
      geoCtx.arc(centreX, centreY, radius, start, end);
      geoCtx.closePath();
      geoCtx.fillStyle = grad;
      geoCtx.fill();
    }
  }

  const nodeRadius = Math.max(1.5, spacingPx * 0.38);

  nodeGeometryLevel.forEach((level, nodeKey) => {
    if (level === 0) return; // Formlessness = transparent

    const q = Math.round((nodeKey / _QS) % _QS) - _QO;
    const r = (nodeKey % _QS) - _RO;
    const [px, py] = axialToPixel(q, r, spacingPx);
    const screenX  = centreX + px;
    const screenY  = centreY + py;

    // Frustum cull
    if (screenX < -nodeRadius || screenX > width + nodeRadius) return;
    if (screenY < -nodeRadius || screenY > height + nodeRadius) return;

    const shell   = nodeGeometryShell.get(nodeKey) ?? 0;
    const shade   = SHADE_FACTORS[Math.min(2, shell)];

    // Determine zone for this node (used by both OSH and PCO)
    const zoneIdx = nodeZoneIndex(q, r, px, py);

    // OSH cross-fade: if oshActive, blend toward next level
    let [R, G, B] = GEOMETRY_RGB[level];

    if (oshActive && oshFBeat > 0) {
      const phiZ      = zonePhiRender[zoneIdx];
      const levelA    = Math.floor(phiZ / TWO_PI) % N_GEOMETRY_LEVELS;
      const levelB    = (levelA + 1) % N_GEOMETRY_LEVELS;
      const blend     = (phiZ / TWO_PI) - Math.floor(phiZ / TWO_PI);

      const [Ra, Ga, Ba] = GEOMETRY_RGB[levelA];
      const [Rb, Gb, Bb] = GEOMETRY_RGB[levelB];

      R = Math.round(Ra + (Rb - Ra) * blend);
      G = Math.round(Ga + (Gb - Ga) * blend);
      B = Math.round(Ba + (Bb - Ba) * blend);
    }

    // PCO luminance modulation + zone hue gradient tint
    let lum = shade;
    if (pcoPlaying || zoneBrightness[zoneIdx] > 0.05) {
      lum = shade * zoneLuminance[zoneIdx];
      // Gradient: inner nodes (low gen) → hue, outer nodes → hue2
      const gen2    = Math.round(Math.sqrt(q * q + q * r + r * r));
      const genFrac = maxGeneration > 0 ? Math.min(1, gen2 / maxGeneration) : 0;
      const h1      = zoneHues[zoneIdx]  / 360;
      const h2      = zoneHues2[zoneIdx] / 360;
      // Hue interpolation in [0,1] space
      let dh = h2 - h1;
      if (dh > 0.5) dh -= 1; if (dh < -0.5) dh += 1;
      const hue01 = ((h1 + dh * genFrac) + 1) % 1;
      const [hr, hg, hb] = hslToRgbWorker(hue01, 1.0, 0.5);
      const ts = Math.min(1, zoneBrightness[zoneIdx] * (pcoPlaying ? zoneLuminance[zoneIdx] : 0.5) * 0.9 + lpgAmplitude * 0.3);
      R = Math.round(R * (1 - ts) + hr * ts);
      G = Math.round(G * (1 - ts) + hg * ts);
      B = Math.round(B * (1 - ts) + hb * ts);
    }

    // Tone-map high brightness to preserve oscillation detail at 10x+
    const r_col = Math.round(255 * (1 - Math.exp(-((R / 255) * Math.max(0, lum)))));
    const g_col = Math.round(255 * (1 - Math.exp(-((G / 255) * Math.max(0, lum)))));
    const b_col = Math.round(255 * (1 - Math.exp(-((B / 255) * Math.max(0, lum)))));

    if (!geoCtx) return;
    geoCtx.fillStyle = `rgb(${r_col},${g_col},${b_col})`;
    geoCtx.beginPath();
    geoCtx.arc(screenX, screenY, nodeRadius, 0, TWO_PI);
    geoCtx.fill();
  });

  // Paint PCO zone hue glow on ALL base lattice nodes (including those without geometry)
  // Gradient: inner → hue, outer → hue2. Visible even when stopped if brightness > 0.
  {
    const glowRadius = Math.max(1, spacingPx * 0.26);
    nodeSet.forEach((nodeKey) => {
      if (nodeGeometryLevel.has(nodeKey)) return; // handled above with stronger tint
      const q = Math.round((nodeKey / _QS) % _QS) - _QO;
      const r = (nodeKey % _QS) - _RO;
      const [px, py] = axialToPixel(q, r, spacingPx);
      const screenX  = centreX + px;
      const screenY  = centreY + py;
      if (screenX < -glowRadius || screenX > width + glowRadius) return;
      if (screenY < -glowRadius || screenY > height + glowRadius) return;

      const zoneIdx = nodeZoneIndex(q, r, px, py);
      const brt     = zoneBrightness[zoneIdx];
      if (brt < 0.01) return;

      // Radial gradient interpolation hue→hue2
      const gen2    = Math.round(Math.sqrt(q * q + q * r + r * r));
      const genFrac = maxGeneration > 0 ? Math.min(1, gen2 / maxGeneration) : 0;
      const h1      = zoneHues[zoneIdx]  / 360;
      const h2      = zoneHues2[zoneIdx] / 360;
      let dh = h2 - h1;
      if (dh > 0.5) dh -= 1; if (dh < -0.5) dh += 1;
      const hue01 = ((h1 + dh * genFrac) + 1) % 1;
      const [hr, hg, hb] = hslToRgbWorker(hue01, 1.0, 0.5);

      // Boost active step zone with full EM amplitude
      const highlightBoost = (zoneIdx === activeHighlightZone) ? activeHighlightAmplitude * 0.8 : 0;
      const lum = pcoPlaying
        ? zoneLuminance[zoneIdx] * brt * (0.15 + lpgAmplitude * 0.4) + highlightBoost
        : brt * 0.12 + highlightBoost;
      if (lum < 0.01) return;

      const alpha = 1 - Math.exp(-Math.max(0, lum) * 0.45);
      geoCtx!.fillStyle = `rgba(${hr},${hg},${hb},${Math.min(1, alpha).toFixed(3)})`;
      geoCtx!.beginPath();
      geoCtx!.arc(screenX, screenY, glowRadius, 0, TWO_PI);
      geoCtx!.fill();
    });
  }
}

// ─── Point cloud RGBA rasteriser (worker-side, no import) ────────────────────
// Minimal port of the point cloud engine from CymaglyphField2D.ts.
// Used to fill adinkra/SCEP masks with the CYMAGLYPH field.
// NOTE: This is intentionally self-contained — no external imports in the worker.
function renderPointCloudIntoMask(
  maskRgba:  Uint8ClampedArray,
  maskW:     number,
  maskH:     number,
  t:         number,
  zoneLevel: number,
  hue360:    number,
): Uint8ClampedArray {
  // Sunflower disk (1600 points for speed in worker)
  const COUNT  = 1600;
  const golden = Math.PI * (3 - Math.sqrt(5));
  const cx = maskW * 0.5;
  const cy = maskH * 0.5;
  const Rscale = Math.min(cx, cy) * 0.9;
  // Result is a clone of the mask — only alpha from mask, RGB from point cloud
  const out = new Uint8ClampedArray(maskW * maskH * 4);

  // Simple Chladni-style pattern: ψ(r,θ,t) = sin(k_r * r) * cos(k_θ * θ + ω * t)
  // using zone level and hue to modulate. Efficient, bijective, no kernel required.
  const k_r = 4 + (zoneLevel % 6);
  const k_theta = 5 + (zoneLevel % 4) * 2;
  const omega = 0.8 + lpgAmplitude * 2.0;
  // Zone geometry RGB for tint
  const GR = [0,139,255,255,0,0,75,148,255,240];
  const GG = [0,0,140,215,201,0,0,0,255,240];
  const GB = [0,0,0,0,87,255,130,211,255,255];
  const zr = GR[Math.min(9, Math.max(0, zoneLevel))];
  const zg = GG[Math.min(9, Math.max(0, zoneLevel))];
  const zb = GB[Math.min(9, Math.max(0, zoneLevel))];
  // Hue to RGB (hue360)
  const h01 = (hue360 / 360) % 1;
  const [hr, hg, hb] = hslToRgbWorker(h01, 1.0, 0.5);

  // Paint point cloud directly into a temp offscreen (drawImage later)
  const tmp    = new OffscreenCanvas(maskW, maskH);
  const tmpCtx = tmp.getContext('2d') as OffscreenCanvasRenderingContext2D;
  tmpCtx.fillStyle = '#000';
  tmpCtx.fillRect(0, 0, maskW, maskH);
  tmpCtx.globalCompositeOperation = 'lighter';
  const ptR = Math.max(1.5, Math.min(maskW, maskH) * 0.011);

  for (let i = 0; i < COUNT; i++) {
    const r     = Math.sqrt((i + 0.5) / COUNT);
    const theta = i * golden;
    const psi   = Math.sin(k_r * Math.PI * r) * Math.cos(k_theta * theta + omega * t);
    if (Math.abs(psi) < 0.15) continue; // only paint near antinodes

    const warp  = 1 + psi * 0.18;
    const R2    = Rscale * (0.12 + r * 1.6) * warp;
    const px    = cx + Math.cos(theta) * R2;
    const py    = cy + Math.sin(theta) * R2 * 0.56;
    const bright = Math.abs(psi);
    // Blend geometry + hue colour
    const fr = Math.min(255, Math.round((zr * 0.4 + hr * 0.6) * bright * (0.4 + lpgAmplitude * 0.6) * 2));
    const fg = Math.min(255, Math.round((zg * 0.4 + hg * 0.6) * bright * (0.4 + lpgAmplitude * 0.6) * 2));
    const fb = Math.min(255, Math.round((zb * 0.4 + hb * 0.6) * bright * (0.4 + lpgAmplitude * 0.6) * 2));
    tmpCtx.fillStyle = `rgb(${fr},${fg},${fb})`;
    tmpCtx.beginPath();
    tmpCtx.arc(px, py, ptR, 0, Math.PI * 2);
    tmpCtx.fill();
  }

  // Now composite: CYMAGLYPH (tmpCanvas) destination-in mask alpha
  const maskTmp    = new OffscreenCanvas(maskW, maskH);
  const maskCtx    = maskTmp.getContext('2d') as OffscreenCanvasRenderingContext2D;
  // Draw cymaglyph field
  maskCtx.drawImage(tmp, 0, 0);
  // Apply mask alpha: destination-in clips to mask shape
  const maskCanvas = new OffscreenCanvas(maskW, maskH);
  const mc         = maskCanvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
  const id = mc.createImageData(maskW, maskH);
  id.data.set(maskRgba);
  mc.putImageData(id, 0, 0);
  maskCtx.globalCompositeOperation = 'destination-in';
  maskCtx.drawImage(maskCanvas, 0, 0);
  maskCtx.globalCompositeOperation = 'source-over';

  // Read result pixels
  const resultData = maskCtx.getImageData(0, 0, maskW, maskH).data;
  out.set(resultData);
  return out;
}

// ─── Overlay render (Adinkra / SCEP masks with CYMAGLYPH fill) ───────────────
function renderOverlay() {
  if (!ovlCtx) return;
  ovlCtx.clearRect(0, 0, width, height);
  for (const item of placedItems) {
    const drawW = item.maskW > 0 ? item.maskW : 96;
    const drawH = item.maskH > 0 ? item.maskH : 96;
    const dx    = item.pixelX - drawW / 2;
    const dy    = item.pixelY - drawH / 2;

    // Determine zone index at item's position for hue
    const relX    = item.pixelX - centreX;
    const relY    = item.pixelY - centreY;
    const theta   = Math.atan2(relY, relX);
    const sector  = Math.floor(((theta + Math.PI) / (Math.PI * 2)) * 6) % 6;
    const zIdx    = sector; // pure sector zone
    const hue360  = zoneHues[zIdx];

    // Determine geometry level at item's nearest node (default 4 = Double Tetra)
    // We approximate: find closest node key in nodeGeometryLevel
    const itemNk  = (() => {
      // Convert screen pixel to approx axial coords
      const sp = Math.max(1, spacingPx);
      const q_approx = Math.round((relX / sp) * (1 / Math.sqrt(3)) - relY / (1.5 * sp));
      const r_approx = Math.round(relY / (1.5 * sp));
      return (q_approx + _QO) * _QS + (r_approx + _RO);
    })();
    const geoLevel = nodeGeometryLevel.get(itemNk) ?? 4;

    let rgbaFinal: Uint8ClampedArray;
    if (item.amplitudeMask && item.amplitudeMask.length > 0) {
      // Convert amplitude mask → RGBA (alpha only, black body)
      const maskRgba = new Uint8ClampedArray(drawW * drawH * 4);
      for (let i = 0; i < drawW * drawH; i++) {
        maskRgba[i * 4 + 3] = Math.round(item.amplitudeMask[i] * 255);
      }
      // Fill with point cloud CYMAGLYPH through mask shape
      rgbaFinal = renderPointCloudIntoMask(maskRgba, drawW, drawH, workerTime, geoLevel, hue360);
    } else if (item.rgbaData) {
      rgbaFinal = item.rgbaData;
    } else if (item.type === 'CYMAGLYPH') {
      // Fallback so CYMAGLYPH entries dropped without pre-baked mask still render.
      const maskRgba = new Uint8ClampedArray(drawW * drawH * 4);
      const cx = drawW * 0.5;
      const cy = drawH * 0.5;
      const r  = Math.min(drawW, drawH) * 0.42;
      for (let y = 0; y < drawH; y++) {
        for (let x = 0; x < drawW; x++) {
          const dx2 = x - cx;
          const dy2 = y - cy;
          const d = Math.sqrt(dx2 * dx2 + dy2 * dy2);
          const t = Math.max(0, 1 - d / r);
          maskRgba[(y * drawW + x) * 4 + 3] = Math.round(t * t * 255);
        }
      }
      rgbaFinal = renderPointCloudIntoMask(maskRgba, drawW, drawH, workerTime, geoLevel, hue360);
    } else {
      continue;
    }

    const tmp    = new OffscreenCanvas(drawW, drawH);
    const tmpCtx = tmp.getContext('2d') as OffscreenCanvasRenderingContext2D;
    const id     = tmpCtx.createImageData(drawW, drawH);
    id.data.set(rgbaFinal);
    tmpCtx.putImageData(id, 0, 0);
    ovlCtx.globalAlpha = item.opacity;
    ovlCtx.drawImage(tmp, dx, dy);
    ovlCtx.globalAlpha = 1;
  }
}

// ─── BFS: process one ring ────────────────────────────────────────────────────
function processBFSRing(): number {
  if (bfsHead >= bfsTail) { bfsComplete = true; return -1; }
  const ringGen = qqG[bfsHead];
  if (ringGen >= maxGeneration) { bfsComplete = true; return -1; }
  currentGeneration = ringGen;

  const ringVesicae: number[] = [];

  while (bfsHead < bfsTail && qqG[bfsHead] === ringGen) {
    const q   = qqQ[bfsHead];
    const r   = qqR[bfsHead];
    const inD = qqI[bfsHead];
    bfsHead++;

    const [parentX, parentY] = axialToPixel(q, r, spacingPx);

    for (let d = 0; d < 6; d++) {
      if (inD !== -1 && d === (inD + 3) % 6) continue;
      const cq = q + DIR_Q[d];
      const cr = r + DIR_R[d];
      const childKey  = nk(cq, cr);
      const parentKey = nk(q, r);
      const edgeK     = ek(parentKey, childKey);
      if (!edgeSet.has(edgeK)) {
        edgeSet.add(edgeK);
        const [childX, childY] = axialToPixel(cq, cr, spacingPx);
        ringVesicae.push(parentX, parentY, childX, childY);
        totalVesicae++;
      }
      if (!nodeSet.has(childKey)) {
        nodeSet.add(childKey);
        if (bfsTail < MAX_Q) {
          qqQ[bfsTail] = cq;
          qqR[bfsTail] = cr;
          qqG[bfsTail] = ringGen + 1;
          qqI[bfsTail] = d;
          bfsTail++;
        }
      }
    }
  }

  // ── After each ring, check if any pending geometry footprint can now be applied ─
  // This fixes Bashar geometry disappearing on BFS reset: we re-apply assignments
  // incrementally as BFS expands, rather than all-at-once when nodeSet is empty.
  if (pendingGeometryZones.size > 0 && nodeSet.size > 0) {
    pendingGeometryZones.forEach((assignment) => {
      // Only attempt if the seed node is now in nodeSet (BFS has reached it)
      const seedKey = nk(assignment.seedQ, assignment.seedR);
      if (nodeSet.has(seedKey)) {
        scheduleGeometryAssignment(
          assignment.seedQ, assignment.seedR,
          assignment.geometryLevel, assignment.scale
        );
      }
    });
  }

  if (ringVesicae.length > 0 && accCtx) {
    ensureAccCanvas();
    const alpha = Math.max(0.3, 0.6 - ringGen * 0.002);

    // Willis oscillator sweep colour (base lattice appearance)
    const domIdx  = dominantOscillatorIndex();
    const hueShift = (phi[domIdx] / TWO_PI) * 60;
    const baseHue  = 220 + hueShift;
    accCtx.beginPath();
    accCtx.strokeStyle = `hsla(${baseHue.toFixed(0)}, 80%, 55%, ${alpha.toFixed(3)})`;
    accCtx.lineWidth = Math.max(0.3, 0.65 * vesicaeWidth);

    for (let i = 0; i < ringVesicae.length; i += 4) {
      const ax = centreX + ringVesicae[i];
      const ay = centreY + ringVesicae[i + 1];
      const bx = centreX + ringVesicae[i + 2];
      const by = centreY + ringVesicae[i + 3];

      if (ax < -8 && bx < -8) continue;
      if (ax > width + 8 && bx > width + 8) continue;
      if (ay < -8 && by < -8) continue;
      if (ay > height + 8 && by > height + 8) continue;

      const dx     = bx - ax;
      const dy     = by - ay;
      const lenSq  = dx * dx + dy * dy;
      if (lenSq < 0.01) continue;
      const inv    = 1 / Math.sqrt(lenSq);
      const nx     = -dy * inv;
      const ny     =  dx * inv;
      const bulge  = Math.sqrt(lenSq) * INV_SQRT3;
      const mx     = (ax + bx) * 0.5;
      const my     = (ay + by) * 0.5;

      accCtx.moveTo(ax, ay);
      accCtx.quadraticCurveTo(mx + nx * bulge, my + ny * bulge, bx, by);
      accCtx.quadraticCurveTo(mx - nx * bulge, my - ny * bulge, ax, ay);
    }
    accCtx.stroke();
  }

  return ringGen;
}

// ─── Main render frame ────────────────────────────────────────────────────────
function render() {
  if (!ctx) return;

  const now  = performance.now();
  const time = (now - startTime) * 0.001;
  const dt   = 1 / 60;
  workerTime = time;

  // Tick Willis oscillators
  tickOscillators(dt);

  // Advance OSH phase
  stepOSH(dt);

  // Tick PCO EM emitter oscillation
  tickPCO(dt);

  // Grow lattice
  if (!bfsComplete) {
    for (let n = 0; n < RINGS_PER_FRAME; n++) {
      processBFSRing();
      if (bfsComplete) break;
    }
    if (bfsComplete && !zoneMapBuilt) buildZoneMap();
  }

  // ── Composite to main canvas ─────────────────────────────────────────────
  ctx.fillStyle = '#020810';
  ctx.fillRect(0, 0, width, height);

  // Layer 1: invariant lattice vesicae (base)
  if (accCvs) ctx.drawImage(accCvs, 0, 0);

  // Layer 2: geometry RGB colour nodes + PCO zone glow
  // Always render when PCO is playing or any zone has brightness set,
  // so zone glow appears even without geometry assignments.
  const anyBrightness = zoneBrightness.some((b) => b > 0.02);
  if (nodeGeometryLevel.size > 0 || pcoPlaying || anyBrightness) {
    renderGeometryLayer();
    if (geoCvs) ctx.drawImage(geoCvs, 0, 0);
  }

  // Layer 3: Adinkra/SCEP amplitude+phase masks at 85% opacity
  if (ovlCvs && placedItems.length > 0) {
    renderOverlay();
    ctx.globalAlpha = 0.85;
    ctx.drawImage(ovlCvs, 0, 0);
    ctx.globalAlpha = 1;
  }

  // ── Growth frontier pulse ─────────────────────────────────────────────────
  if (!bfsComplete && currentGeneration > 0) {
    const frontierR = currentGeneration * spacingPx * SQRT3;
    const pulse     = 0.25 + 0.2 * Math.sin(time * 4.5);
    const grad      = ctx.createRadialGradient(centreX, centreY, Math.max(0, frontierR - 12), centreX, centreY, frontierR + 12);
    grad.addColorStop(0,   'rgba(72, 220, 255, 0)');
    grad.addColorStop(0.5, `rgba(72, 220, 255, ${pulse.toFixed(3)})`);
    grad.addColorStop(1,   'rgba(72, 220, 255, 0)');
    ctx.beginPath();
    ctx.arc(centreX, centreY, frontierR, 0, Math.PI * 2);
    ctx.strokeStyle = grad;
    ctx.lineWidth   = 18;
    ctx.stroke();
  }

  // ── Seed pulse ────────────────────────────────────────────────────────────
  const seedPulse = 0.65 + 0.35 * Math.sin(time * 2.4);
  ctx.beginPath();
  ctx.fillStyle = `rgba(200, 230, 255, ${seedPulse.toFixed(3)})`;
  ctx.arc(centreX, centreY, 3.5, 0, Math.PI * 2);
  ctx.fill();

  // ── Stats ─────────────────────────────────────────────────────────────────
  if (Math.round(time * 60) % 30 === 0) {
    const lockedIndices: number[] = [];
    const lockStrengths: number[] = [];
    for (let i = 0; i < N_MODES; i++) {
      if (isLocked[i]) {
        lockedIndices.push(i);
        const sideband = Math.abs(dominantLPG - omega[i] / TWO_PI);
        lockStrengths.push(carrierRms > 0 ? sideband / carrierRms : Infinity);
      }
    }
    (self as unknown as Worker).postMessage({
      type: 'STATS',
      totalVesicae,
      currentGeneration,
      maxGeneration,
      spacingPx,
      complete: bfsComplete,
    });
    if (lockedIndices.length > 0) {
      (self as unknown as Worker).postMessage({
        type: 'LOCK_STATE',
        lockedIndices,
        lockStrengths,
        phases: Array.from(phi),
      });
    }
  }
}

// ─── Start loop ───────────────────────────────────────────────────────────────
function startLoop() {
  if (_loopHandle !== null) return;
  startTime   = performance.now();
  _loopHandle = setInterval(render, 1000 / 60);
  console.log('[G3NEN::RenderWorker] Loop started — spacingPx:', spacingPx, 'maxGen:', maxGeneration);
}

// ─── Message handler ──────────────────────────────────────────────────────────
self.onmessage = (ev) => {
  const msg = ev.data;
  switch (msg.type) {

    case 'INIT': {
      cvs  = msg.canvas as OffscreenCanvas;
      ctx  = cvs.getContext('2d', { alpha: false }) as OffscreenCanvasRenderingContext2D;
      if (!ctx) { console.error('[G3NEN::RenderWorker] Failed to get 2D context'); return; }
      width  = cvs.width  || 1920;
      height = cvs.height || 1080;
      console.log('[G3NEN::RenderWorker] Canvas2D ctx ✓', width, '×', height);
      const p = deriveParams(width, height);
      spacingPx     = p.spacingPx;
      maxGeneration = p.maxGeneration;
      ensureAccCanvas();
      ensureOverlayCanvas();
      ensureGeoCanvas();
      bfsReset(panX, panY);
      startLoop();
      break;
    }

    case 'RESIZE': {
      const newW = Math.max(1, msg.width  as number);
      const newH = Math.max(1, msg.height as number);
      if (newW === width && newH === height) break;
      width = newW; height = newH;
      if (cvs) { cvs.width = width; cvs.height = height; }
      const p = deriveParams(width, height);
      spacingPx     = p.spacingPx;
      maxGeneration = p.maxGeneration;
      console.log('[G3NEN::RenderWorker] RESIZE →', width, '×', height, '| spacingPx:', spacingPx, 'maxGen:', maxGeneration);
      ensureAccCanvas();
      ensureOverlayCanvas();
      ensureGeoCanvas();
      bfsReset(panX, panY);
      break;
    }

    case 'PARAM': {
      const newPanX: number = msg.pan?.[0] ?? panX;
      const newPanY: number = msg.pan?.[1] ?? panY;
      // Pan update: shift the logical centreX/centreY — no BFS reset.
      // The acc canvas was drawn relative to (width/2 + oldPanX, height/2 + oldPanY).
      // We update centreX/centreY so subsequent rings + geometry layer use new centre.
      // Already-drawn rings stay in place — only new growth follows the new centre.
      // A full BFS reset (regrow) only happens on RESIZE.
      if (newPanX !== panX || newPanY !== panY) {
        panX = newPanX;
        panY = newPanY;
        centreX = width  * 0.5 + panX;
        centreY = height * 0.5 + panY;
        // Rebuild zone map so placed-item hit testing uses correct positions
        if (bfsComplete) buildZoneMap();
      }
      if (msg.vesicaeWidth !== undefined) vesicaeWidth = msg.vesicaeWidth as number;
      break;
    }

    case 'CARRIER_UPDATE': {
      // PHISUD-derived carrier parameters (dominantLPG replaces dominantHz)
      dominantLPG = (msg.dominantLPG as number) || (msg.dominantHz as number) || 0;
      carrierRms  = (msg.rms        as number) || 0;
      // Normalised LPG amplitude — clamp lpg / 1000 to [0,1]
      const rawLPG = (msg.lpg as number) || dominantLPG;
      lpgAmplitude = Math.min(1, Math.max(0, rawLPG / 1000));
      break;
    }

    case 'OSH_UPDATE': {
      // OSH resonance programmer parameters
      oshFBeat  = (msg.fBeat   as number)  || 0;
      oshActive = (msg.active  as boolean) ?? oshActive;
      if (msg.zonePhiRender) {
        const arr = msg.zonePhiRender as number[];
        for (let z = 0; z < Math.min(N_OSH_ZONES, arr.length); z++) {
          zonePhiRender[z] = arr[z];
        }
      }
      break;
    }

    case 'ASSIGN_GEOMETRY_ZONE': {
      // Operator dragged a geometry from Window 4 and dropped onto lattice node (seedQ, seedR).
      // The lattice structure is INVARIANT — only RGB values of nodes change.
      const seedQ         = msg.seedQ         as number;
      const seedR         = msg.seedR         as number;
      const geometryLevel = msg.geometryLevel as number;
      const scale         = Math.max(1, (msg.scale as number) || 1);
      const zoneKey       = `${seedQ},${seedR}`;

      // Store for post-reset replay
      if (geometryLevel === 0) {
        pendingGeometryZones.delete(zoneKey);
      } else {
        pendingGeometryZones.set(zoneKey, { seedQ, seedR, geometryLevel, scale });
      }

      // Clear all nodes from any prior assignment at this seed
      // (simple approach: clear all, then reassign all pending)
      nodeGeometryLevel.clear();
      nodeGeometryShell.clear();
      pendingGeometryZones.forEach((assignment) => {
        scheduleGeometryAssignment(
          assignment.seedQ, assignment.seedR,
          assignment.geometryLevel, assignment.scale
        );
      });
      break;
    }

    case 'CLEAR_GEOMETRY': {
      nodeGeometryLevel.clear();
      nodeGeometryShell.clear();
      pendingGeometryZones.clear();
      break;
    }

    case 'PLACE_ITEM': {
      const item: PlacedItemData = {
        id:            msg.id as string,
        type:          msg.itemType as string,
        pixelX:        msg.pixelX   as number,
        pixelY:        msg.pixelY   as number,
        opacity:       (msg.opacity as number) ?? 0.85,
        maskW:         (msg.maskW   as number) ?? 0,
        maskH:         (msg.maskH   as number) ?? 0,
        amplitudeMask: msg.amplitudeMask ? new Float32Array(msg.amplitudeMask as ArrayBuffer) : null,
        rgbaData:      null,
      };
      if (item.amplitudeMask && item.maskW > 0 && item.maskH > 0) {
        const rgba = new Uint8ClampedArray(item.maskW * item.maskH * 4);
        for (let i = 0; i < item.maskW * item.maskH; i++) {
          const a = Math.round(item.amplitudeMask[i] * 255);
          rgba[i * 4]     = 0;
          rgba[i * 4 + 1] = 0;
          rgba[i * 4 + 2] = 0;
          rgba[i * 4 + 3] = a; // black mask, alpha from amplitude
        }
        item.rgbaData = rgba;
      }
      const idx = placedItems.findIndex((p) => p.id === item.id);
      if (idx >= 0) placedItems.splice(idx, 1);
      placedItems.push(item);
      break;
    }

    case 'REMOVE_ITEM': {
      const idx = placedItems.findIndex((p) => p.id === (msg.id as string));
      if (idx >= 0) placedItems.splice(idx, 1);
      break;
    }

    case 'MOVE_ITEM': {
      // Drag-move a placed item on the overlay canvas
      const itemId = msg.id as string;
      const newX   = msg.pixelX as number;
      const newY   = msg.pixelY as number;
      const item   = placedItems.find((p) => p.id === itemId);
      if (item) {
        item.pixelX = newX;
        item.pixelY = newY;
      }
      break;
    }

    case 'PCO_PLAY': {
      pcoPlaying = true;
      console.log('[G3NEN::RenderWorker] PCO oscillation STARTED — zones:', N_OSH_ZONES, 'lpgAmp:', lpgAmplitude);
      break;
    }

    case 'PCO_STOP': {
      pcoPlaying = false;
      zoneLuminance.fill(1.0);
      console.log('[G3NEN::RenderWorker] PCO oscillation STOPPED');
      break;
    }

    case 'HIGHLIGHT_ZONE': {
      // Program step sequencer: illuminate a specific zone with a given EM amplitude
      activeHighlightZone      = typeof msg.zoneIndex  === 'number' ? msg.zoneIndex  : -1;
      activeHighlightAmplitude = typeof msg.emAmplitude === 'number' ? Math.min(1, Math.max(0, msg.emAmplitude)) : 1.0;
      break;
    }

    case 'PCO_ZONE_UPDATE': {
      // Update per-zone hue, gradient hue2, brightness, eigenmode frequency, Willis coupling
      const z = Math.max(0, Math.min(N_OSH_ZONES - 1, msg.zoneIndex as number));
      if (typeof msg.hue        === 'number') zoneHues[z]       = ((msg.hue % 360) + 360) % 360;
      if (typeof msg.hue2       === 'number') zoneHues2[z]      = ((msg.hue2 % 360) + 360) % 360;
      if (typeof msg.brightness === 'number') zoneBrightness[z] = Math.min(10, Math.max(0, msg.brightness as number));
      if (typeof msg.eigenHz    === 'number') zoneEigenHz[z]    = Math.max(0.01, msg.eigenHz as number);
      if (typeof msg.willisK    === 'number') zoneWillisK[z]    = Math.min(1, Math.max(0, msg.willisK as number));
      // Always re-render geometry layer so colour change is immediate
      renderGeometryLayer();
      break;
    }
  }
};
