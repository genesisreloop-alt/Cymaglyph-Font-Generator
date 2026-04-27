export type HexDirIndex = 0 | 1 | 2 | 3 | 4 | 5;

export interface PixelPhaseNode {
  id: string;
  q: number;
  r: number;
  x: number;
  y: number;
  generation: number;
  incomingDirection: HexDirIndex | null;
}

export interface PixelPhaseAntinode {
  id: string;
  a: string;
  b: string;
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

export interface PixelPhasedArrayStats {
  viewportWidth: number;
  viewportHeight: number;
  authorityPixelNodes: number;
  groupingFactor: number;
  spacingPx: number;
  generationDepth: number;
  renderedNodeCount: number;
  renderedAntinodeCount: number;
  ratioError: number;
  noBackPropagation: boolean;
  antinodeTermination: boolean;
}

export interface PixelPhasedArrayResult {
  vesicaeBuffer: Float32Array; // Layout: [ax, ay, bx, by, generation] per Vesicae
  stats: PixelPhasedArrayStats;
}

export interface PixelPhasedArrayConfig {
  viewportWidth: number;
  viewportHeight: number;
  zoom: number;
  maxRenderNodes?: number;
  maxGenerationCap?: number;
}

const SQRT3 = Math.sqrt(3);

// ─── Integer key encoding — zero string allocations in hot BFS path ───────────
// Supports q, r in range [-200, 799]. Safe for depth ≤ 96.
const _QOFF = 200, _ROFF = 200, _QSTR = 1000, _ESTR = 500_000;
const nodeKeyOf = (q: number, r: number): number => (q + _QOFF) * _QSTR + (r + _ROFF);
// Symmetric edge key — same regardless of a/b ordering
const edgeKeyOf = (ka: number, kb: number): number =>
  ka < kb ? ka * _ESTR + kb : kb * _ESTR + ka;

const HEX_DIRECTIONS: readonly [number, number][] = [
  [0, -1],  // 0 — up
  [1, -1],  // 1 — up-right
  [1, 0],   // 2 — down-right
  [0, 1],   // 3 — down
  [-1, 1],  // 4 — down-left
  [-1, 0],  // 5 — up-left
] as const;

const dirOpposite = (d: number): number => (d + 3) % 6;

function axialToPixel(q: number, r: number, spacingPx: number): { x: number; y: number } {
  // Pointy-top axial hex mapping.
  const x = spacingPx * SQRT3 * (q + r / 2);
  const y = spacingPx * 1.5 * r;
  return { x, y };
}

function estimateGroupingFactor(viewportWidth: number, viewportHeight: number, zoom: number, maxRenderNodes: number): number {
  const authorityNodes = Math.max(1, viewportWidth * viewportHeight);
  const zoomBoost = Math.max(0.08, Math.min(32, zoom));
  const desired = Math.max(8_000, Math.floor(maxRenderNodes * zoomBoost));
  if (authorityNodes <= desired) return 1;
  const ratio = authorityNodes / desired;
  const g = Math.ceil(Math.sqrt(ratio));
  return Math.max(1, g);
}

function computeGenerationDepth(viewportWidth: number, viewportHeight: number, spacingPx: number, maxGenerationCap: number): number {
  const radiusPx = Math.hypot(viewportWidth, viewportHeight) * 0.75;
  const step = Math.max(1, spacingPx * SQRT3);
  const depth = Math.ceil(radiusPx / step);
  return Math.max(1, Math.min(maxGenerationCap, depth));
}

export function buildFoLPixelPhasedArray(config: PixelPhasedArrayConfig): PixelPhasedArrayResult {
  const viewportWidth = Math.max(1, Math.floor(config.viewportWidth));
  const viewportHeight = Math.max(1, Math.floor(config.viewportHeight));
  const zoom = Math.max(0.08, Number.isFinite(config.zoom) ? config.zoom : 1);
  const maxRenderNodes = Math.max(10_000, config.maxRenderNodes ?? 120_000);
  const maxGenerationCap = Math.max(8, config.maxGenerationCap ?? 350);
  const groupingFactor = estimateGroupingFactor(viewportWidth, viewportHeight, zoom, maxRenderNodes);
  const spacingPx = groupingFactor;
  const generationDepth = computeGenerationDepth(viewportWidth, viewportHeight, spacingPx, maxGenerationCap);

  const nodeByAxial = new Map<number, PixelPhaseNode>(); // integer keys — no string alloc
  const edgeSet = new Set<number>();                      // integer edge keys
  const noBackPropagation = true;
  const antinodeTermination = true;

  const addNode = (q: number, r: number, generation: number, incomingDirection: HexDirIndex | null): PixelPhaseNode => {
    const key = nodeKeyOf(q, r); // integer key — no string allocation
    const existing = nodeByAxial.get(key);
    if (existing) return existing;
    const p = axialToPixel(q, r, spacingPx);
    const node: PixelPhaseNode = {
      id: `${q},${r}`, // kept for interface compatibility
      q, r, x: p.x, y: p.y,
      generation, incomingDirection,
    };
    nodeByAxial.set(key, node);
    // No nodes[] push — array removed, use nodeByAxial.size for count
    return node;
  };

  const maxEdgesEst = generationDepth * generationDepth * 4 + 6;
  const vesicae = new Float32Array(Math.min(maxEdgesEst * 5, 1_000_000 * 5)); // generous pre-allocation
  let vesicaCount = 0;

  const addVesica = (a: PixelPhaseNode, b: PixelPhaseNode): void => {
    const ek = edgeKeyOf(nodeKeyOf(a.q, a.r), nodeKeyOf(b.q, b.r)); // integer edge key
    if (edgeSet.has(ek)) return;
    edgeSet.add(ek);
    if (vesicaCount * 5 + 4 < vesicae.length) {
      const idx = vesicaCount * 5;
      vesicae[idx + 0] = a.x;
      vesicae[idx + 1] = a.y;
      vesicae[idx + 2] = b.x;
      vesicae[idx + 3] = b.y;
      vesicae[idx + 4] = b.generation;
      vesicaCount++;
    }
  };

  const seed = addNode(0, 0, 0, null);
  const queue: PixelPhaseNode[] = [seed];
  let cursor = 0;

  // Level-order queue processing
  while (cursor < queue.length) {
    const parent = queue[cursor];
    cursor += 1;
    if (parent.generation >= generationDepth) continue;

    // Seed generates 6. Nodes >= 1 generate 5 (skipping incoming opposite).
    for (let d = 0; d < 6; d += 1) {
      if (parent.incomingDirection !== null && d === dirOpposite(parent.incomingDirection)) {
        continue; // Strict no-back-propagation
      }
      const vec = HEX_DIRECTIONS[d];
      const child = addNode(
        parent.q + vec[0],
        parent.r + vec[1],
        parent.generation + 1,
        d as HexDirIndex,
      );
      addVesica(parent, child);
      
      // Node is now generated by this path
      if (child.generation === parent.generation + 1) {
        queue.push(child);
      }
    }
  }

  const finalVesicaeBuffer = vesicae.slice(0, vesicaCount * 5);

  // Check the FoL 1:sqrt(3) ratio
  let ratioError = 0;
  if (vesicaCount > 0) {
    const dx = vesicae[2] - vesicae[0];
    const dy = vesicae[3] - vesicae[1];
    const length = Math.hypot(dx, dy);
    const ratio = length > 0 ? Math.abs(dx) / length : 0;
    ratioError = Math.abs(ratio - 1 / SQRT3);
  }

  return {
    vesicaeBuffer: finalVesicaeBuffer,
    stats: {
      viewportWidth,
      viewportHeight,
      authorityPixelNodes: viewportWidth * viewportHeight,
      groupingFactor,
      spacingPx,
      generationDepth,
      renderedNodeCount: nodeByAxial.size,
      renderedAntinodeCount: vesicaCount,
      ratioError,
      noBackPropagation,
      antinodeTermination,
    },
  };
}

export function buildVesicaPath(ax: number, ay: number, bx: number, by: number): string {
  const dx = bx - ax;
  const dy = by - ay;
  const d = Math.hypot(dx, dy);
  if (d <= 1e-6) return "";
  const mx = (ax + bx) * 0.5;
  const my = (ay + by) * 0.5;
  const nx = -dy / d;
  const ny = dx / d;
  const bulge = d * 0.42;
  const c1x = mx + nx * bulge;
  const c1y = my + ny * bulge;
  const c2x = mx - nx * bulge;
  const c2y = my - ny * bulge;
  return `M ${ax} ${ay} Q ${c1x} ${c1y} ${bx} ${by} Q ${c2x} ${c2y} ${ax} ${ay} Z`;
}
