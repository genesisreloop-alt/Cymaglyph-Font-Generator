/**
 * 4K Mandala Geometry Generator
 * High-resolution mandala generation with harmonic ratios and sacred geometry
 * Supports export-ready vector paths at 4096x4096 resolution
 */

import type { SignalKernelParams } from './coreSignalKernel';

export interface MandalaOptions {
  symmetryOrder: number;
  radialLayers: number;
  innerRadius: number;
  outerRadius: number;
  detailLevel: 'low' | 'medium' | 'high' | 'ultra' | '4k';
  includeSeedOfLife: boolean;
  includeFlowerOfLife: boolean;
  includeMetatronsCube: boolean;
  includeSriYantra: boolean;
  goldenRatioSubdivisions: boolean;
}

export interface VectorPoint {
  x: number;
  y: number;
}

export interface VectorPath {
  closed: boolean;
  points: VectorPoint[];
  type: 'circle' | 'arc' | 'line' | 'polygon' | 'petal' | 'triangle' | 'custom';
}

export interface MandalaGeometry {
  paths: VectorPath[];
  centerX: number;
  centerY: number;
  boundingBox: { xMin: number; yMin: number; xMax: number; yMax: number };
}

const PHI = 1.618033988749895;
const SQRT2 = 1.4142135623730951;
const SQRT3 = 1.7320508075688772;
const SQRT5 = 2.23606797749979;

/**
 * Generates basic circle path
 */
function createCircle(
  cx: number,
  cy: number,
  radius: number,
  segments: number = 64
): VectorPath {
  const points: VectorPoint[] = [];
  
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    points.push({
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle)
    });
  }
  
  return { closed: true, points, type: 'circle' };
}

/**
 * Generates arc path
 */
function createArc(
  cx: number,
  cy: number,
  radius: number,
  startAngle: number,
  endAngle: number,
  segments: number = 32
): VectorPath {
  const points: VectorPoint[] = [];
  const span = endAngle - startAngle;
  
  for (let i = 0; i <= segments; i++) {
    const angle = startAngle + (i / segments) * span;
    points.push({
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle)
    });
  }
  
  return { closed: false, points, type: 'arc' };
}

/**
 * Generates regular polygon
 */
function createPolygon(
  cx: number,
  cy: number,
  radius: number,
  sides: number,
  rotation: number = 0
): VectorPath {
  const points: VectorPoint[] = [];
  
  for (let i = 0; i < sides; i++) {
    const angle = rotation + (i / sides) * Math.PI * 2;
    points.push({
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle)
    });
  }
  
  return { closed: true, points, type: 'polygon' };
}

/**
 * Generates petal shape using vesica piscis geometry
 */
function createPetal(
  cx: number,
  cy: number,
  length: number,
  width: number,
  angle: number
): VectorPath {
  const points: VectorPoint[] = [];
  const segments = 16;
  
  // Left side of petal
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const r = width * Math.sin(Math.PI * t);
    const theta = angle + (t - 0.5) * Math.PI * 0.3;
    const d = t * length;
    
    points.push({
      x: cx + d * Math.cos(theta) - r * Math.sin(theta),
      y: cy + d * Math.sin(theta) + r * Math.cos(theta)
    });
  }
  
  // Right side of petal
  for (let i = segments; i >= 0; i--) {
    const t = i / segments;
    const r = width * Math.sin(Math.PI * t);
    const theta = angle - (t - 0.5) * Math.PI * 0.3;
    const d = t * length;
    
    points.push({
      x: cx + d * Math.cos(theta) + r * Math.sin(theta),
      y: cy + d * Math.sin(theta) - r * Math.cos(theta)
    });
  }
  
  return { closed: true, points, type: 'petal' };
}

/**
 * Generates Seed of Life pattern (7 circles)
 */
function createSeedOfLife(cx: number, cy: number, radius: number): VectorPath[] {
  const paths: VectorPath[] = [];
  
  // Central circle
  paths.push(createCircle(cx, cy, radius));
  
  // Six surrounding circles
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    const ox = cx + radius * Math.cos(angle);
    const oy = cy + radius * Math.sin(angle);
    paths.push(createCircle(ox, oy, radius));
  }
  
  return paths;
}

/**
 * Generates Flower of Life pattern
 */
function createFlowerOfLife(
  cx: number,
  cy: number,
  radius: number,
  rings: number = 3
): VectorPath[] {
  const paths: VectorPath[] = [];
  
  // Start with Seed of Life
  paths.push(...createSeedOfLife(cx, cy, radius));
  
  // Add additional rings
  for (let ring = 2; ring <= rings; ring++) {
    const count = ring * 6;
    const ringRadius = ring * radius;
    
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const ox = cx + ringRadius * Math.cos(angle);
      const oy = cy + ringRadius * Math.sin(angle);
      
      // Only add if not already covered by inner rings
      const distFromCenter = Math.sqrt(ox * ox + oy * oy);
      if (distFromCenter > radius * 0.5) {
        paths.push(createCircle(ox, oy, radius));
      }
    }
  }
  
  return paths;
}

/**
 * Generates Metatron's Cube geometry
 */
function createMetatronsCube(cx: number, cy: number, radius: number): VectorPath[] {
  const paths: VectorPath[] = [];
  
  // 13 points of Metatron's Cube (from Flower of Life)
  const points: VectorPoint[] = [
    { x: cx, y: cy }, // Center
  ];
  
  // First ring (6 points)
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    points.push({
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle)
    });
  }
  
  // Second ring (6 points)
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2 + Math.PI / 6;
    points.push({
      x: cx + radius * SQRT3 * Math.cos(angle),
      y: cy + radius * SQRT3 * Math.sin(angle)
    });
  }
  
  // Connect all points with lines
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      paths.push({
        closed: false,
        points: [points[i], points[j]],
        type: 'line'
      });
    }
  }
  
  return paths;
}

/**
 * Generates Sri Yantra geometry
 */
function createSriYantra(cx: number, cy: number, size: number): VectorPath[] {
  const paths: VectorPath[] = [];
  
  // 9 interlocking triangles (4 upward, 5 downward)
  const triangles = [
    // Downward triangles (Shakti)
    { up: false, scale: 1.0 },
    { up: false, scale: 0.85 },
    { up: false, scale: 0.7 },
    { up: false, scale: 0.55 },
    { up: false, scale: 0.4 },
    // Upward triangles (Shiva)
    { up: true, scale: 0.9 },
    { up: true, scale: 0.75 },
    { up: true, scale: 0.6 },
    { up: true, scale: 0.45 },
  ];
  
  for (const tri of triangles) {
    const s = size * tri.scale;
    const h = s * SQRT3 / 2;
    const points: VectorPoint[] = [];
    
    if (tri.up) {
      // Upward triangle
      points.push({ x: cx, y: cy - h * 0.667 });
      points.push({ x: cx - s / 2, y: cy + h * 0.333 });
      points.push({ x: cx + s / 2, y: cy + h * 0.333 });
    } else {
      // Downward triangle
      points.push({ x: cx - s / 2, y: cy - h * 0.333 });
      points.push({ x: cx + s / 2, y: cy - h * 0.333 });
      points.push({ x: cx, y: cy + h * 0.667 });
    }
    
    paths.push({ closed: true, points, type: 'triangle' });
  }
  
  // Add enclosing circles
  paths.push(createCircle(cx, cy, size * 0.6));
  paths.push(createCircle(cx, cy, size * 0.8));
  paths.push(createCircle(cx, cy, size));
  
  return paths;
}

/**
 * Generates harmonic radial layers based on golden ratio
 */
function createHarmonicLayers(
  cx: number,
  cy: number,
  innerRadius: number,
  outerRadius: number,
  layerCount: number,
  useGoldenRatio: boolean
): VectorPath[] {
  const paths: VectorPath[] = [];
  
  for (let i = 0; i <= layerCount; i++) {
    const t = i / layerCount;
    let radius: number;
    
    if (useGoldenRatio) {
      // Golden ratio spacing
      radius = innerRadius * Math.pow(PHI, t * Math.log(outerRadius / innerRadius) / Math.log(PHI));
    } else {
      // Linear spacing
      radius = innerRadius + t * (outerRadius - innerRadius);
    }
    
    paths.push(createCircle(cx, cy, radius));
  }
  
  return paths;
}

/**
 * Generates angular divisions with symmetry order
 */
function createAngularDivisions(
  cx: number,
  cy: number,
  innerRadius: number,
  outerRadius: number,
  symmetryOrder: number
): VectorPath[] {
  const paths: VectorPath[] = [];
  
  for (let i = 0; i < symmetryOrder; i++) {
    const angle = (i / symmetryOrder) * Math.PI * 2;
    const x1 = cx + innerRadius * Math.cos(angle);
    const y1 = cy + innerRadius * Math.sin(angle);
    const x2 = cx + outerRadius * Math.cos(angle);
    const y2 = cy + outerRadius * Math.sin(angle);
    
    paths.push({
      closed: false,
      points: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
      type: 'line'
    });
  }
  
  return paths;
}

/**
 * Generates petal ring based on symmetry order
 */
function createPetalRing(
  cx: number,
  cy: number,
  radius: number,
  petalCount: number,
  petalLength: number,
  petalWidth: number
): VectorPath[] {
  const paths: VectorPath[] = [];
  
  for (let i = 0; i < petalCount; i++) {
    const angle = (i / petalCount) * Math.PI * 2;
    paths.push(createPetal(cx, cy, petalLength, petalWidth, angle));
  }
  
  return paths;
}

/**
 * Main mandala generation function with 4K output support
 */
export function generateMandala4K(
  params: SignalKernelParams,
  options: Partial<MandalaOptions> = {}
): MandalaGeometry {
  const opts: MandalaOptions = {
    symmetryOrder: params.symmetryOrder || 12,
    radialLayers: params.radialLayers || 7,
    innerRadius: 50,
    outerRadius: 2000,
    detailLevel: '4k',
    includeSeedOfLife: true,
    includeFlowerOfLife: false,
    includeMetatronsCube: false,
    includeSriYantra: false,
    goldenRatioSubdivisions: true,
    ...options
  };
  
  const centerX = 2048;
  const centerY = 2048;
  const paths: VectorPath[] = [];
  
  // Determine segment count based on detail level
  const segmentMap = {
    low: 32,
    medium: 64,
    high: 128,
    ultra: 256,
    '4k': 512
  };
  const segments = segmentMap[opts.detailLevel];
  
  // Generate harmonic radial layers
  const layers = createHarmonicLayers(
    centerX,
    centerY,
    opts.innerRadius,
    opts.outerRadius,
    opts.radialLayers,
    opts.goldenRatioSubdivisions
  );
  paths.push(...layers);
  
  // Generate angular divisions
  const divisions = createAngularDivisions(
    centerX,
    centerY,
    opts.innerRadius * 0.1,
    opts.outerRadius,
    opts.symmetryOrder
  );
  paths.push(...divisions);
  
  // Generate petal rings at harmonic intervals
  const petalRadii = [0.3, 0.5, 0.7];
  for (const ratio of petalRadii) {
    const radius = opts.innerRadius + ratio * (opts.outerRadius - opts.innerRadius);
    const petals = createPetalRing(
      centerX,
      centerY,
      radius,
      opts.symmetryOrder,
      (opts.outerRadius - opts.innerRadius) * 0.15,
      (opts.outerRadius - opts.innerRadius) * 0.05
    );
    paths.push(...petals);
  }
  
  // Add sacred geometry overlays
  if (opts.includeSeedOfLife) {
    const seedRadius = (opts.outerRadius - opts.innerRadius) * 0.3;
    const seedPaths = createSeedOfLife(centerX, centerY, seedRadius);
    paths.push(...seedPaths);
  }
  
  if (opts.includeFlowerOfLife) {
    const flowerRadius = (opts.outerRadius - opts.innerRadius) * 0.25;
    const flowerPaths = createFlowerOfLife(centerX, centerY, flowerRadius, 2);
    paths.push(...flowerPaths);
  }
  
  if (opts.includeMetatronsCube) {
    const cubeRadius = (opts.outerRadius - opts.innerRadius) * 0.35;
    const cubePaths = createMetatronsCube(centerX, centerY, cubeRadius);
    paths.push(...cubePaths);
  }
  
  if (opts.includeSriYantra) {
    const yantraSize = (opts.outerRadius - opts.innerRadius) * 0.4;
    const yantraPaths = createSriYantra(centerX, centerY, yantraSize);
    paths.push(...yantraPaths);
  }
  
  // Calculate bounding box
  let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity;
  for (const path of paths) {
    for (const point of path.points) {
      xMin = Math.min(xMin, point.x);
      yMin = Math.min(yMin, point.y);
      xMax = Math.max(xMax, point.x);
      yMax = Math.max(yMax, point.y);
    }
  }
  
  return {
    paths,
    centerX,
    centerY,
    boundingBox: { xMin, yMin, xMax, yMax }
  };
}

/**
 * Converts mandala geometry to OpenType path commands
 */
export function mandalaToOpenTypeCommands(mandala: MandalaGeometry): Array<{ command: string; args: number[] }> {
  const commands: Array<{ command: string; args: number[] }> = [];
  
  for (const path of mandala.paths) {
    if (path.points.length < 2) continue;
    
    if (path.type === 'line') {
      // Simple line
      commands.push({
        command: 'M',
        args: [path.points[0].x, path.points[0].y]
      });
      commands.push({
        command: 'L',
        args: [path.points[1].x, path.points[1].y]
      });
    } else if (path.closed && path.type === 'circle') {
      // Circle as quadratic bezier curves
      const p = path.points;
      const n = p.length - 1; // Exclude duplicate end point
      
      if (n >= 4) {
        commands.push({ command: 'M', args: [p[0].x, p[0].y] });
        
        // Use quadratic curves for circle approximation
        for (let i = 0; i < n; i += Math.floor(n / 4)) {
          const i1 = (i + Math.floor(n / 8)) % n;
          const i2 = (i + Math.floor(n / 4)) % n;
          commands.push({
            command: 'Q',
            args: [p[i1].x, p[i1].y, p[i2].x, p[i2].y]
          });
        }
        commands.push({ command: 'Z', args: [] });
      }
    } else {
      // General path
      commands.push({ command: 'M', args: [path.points[0].x, path.points[0].y] });
      
      for (let i = 1; i < path.points.length; i++) {
        commands.push({
          command: 'L',
          args: [path.points[i].x, path.points[i].y]
        });
      }
      
      if (path.closed) {
        commands.push({ command: 'Z', args: [] });
      }
    }
  }
  
  return commands;
}
