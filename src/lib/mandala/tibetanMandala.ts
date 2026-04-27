/**
 * Tibetan Mandala Geometry Generator
 * Implements traditional Tibetan mandala structures with harmonic ratios
 * Based on Kalachakra, Medicine Buddha, and Chenrezig mandala patterns
 */

import type { VectorPoint, VectorPath, MandalaGeometry } from '../../types';

const TAU = Math.PI * 2;
const PHI = 1.618033988749895;
const SQRT2 = 1.4142135623730951;
const SQRT3 = 1.7320508075688772;

interface TibetanMandalaOptions {
  centerX: number;
  centerY: number;
  outerRadius: number;
  layerCount: number;
  gateCount: 4 | 8;
  detailLevel: number;
  includeDeityPalace: boolean;
  includeFireRing: boolean;
  includeLotusRing: boolean;
  includeVajraRing: boolean;
  colorScheme?: 'traditional' | 'monochrome';
}

/**
 * Create a circle path
 */
function createCircle(cx: number, cy: number, radius: number, segments: number = 64): VectorPath {
  const points: VectorPoint[] = [];
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * TAU;
    points.push({
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle)
    });
  }
  return { closed: true, points, type: 'circle' };
}

/**
 * Create an arc path
 */
function createArc(
  cx: number, cy: number, radius: number,
  startAngle: number, endAngle: number, segments: number = 32
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
 * Create a petal shape (lotus petal)
 */
function createLotusPetal(
  cx: number, cy: number, length: number, width: number, angle: number
): VectorPath {
  const points: VectorPoint[] = [];
  const segments = 24;
  
  // Left curve
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const r = width * Math.sin(Math.PI * t);
    const theta = angle + (t - 0.5) * Math.PI * 0.4;
    const d = t * length;
    points.push({
      x: cx + d * Math.cos(theta) - r * Math.sin(theta),
      y: cy + d * Math.sin(theta) + r * Math.cos(theta)
    });
  }
  
  // Right curve
  for (let i = segments; i >= 0; i--) {
    const t = i / segments;
    const r = width * Math.sin(Math.PI * t);
    const theta = angle - (t - 0.5) * Math.PI * 0.4;
    const d = t * length;
    points.push({
      x: cx + d * Math.cos(theta) + r * Math.sin(theta),
      y: cy + d * Math.sin(theta) - r * Math.cos(theta)
    });
  }
  
  return { closed: true, points, type: 'petal' };
}

/**
 * Create a vajra (thunderbolt) symbol
 */
function createVajra(cx: number, cy: number, size: number, angle: number): VectorPath {
  const points: VectorPoint[] = [];
  const prongs = 5;
  const prongLength = size * 0.4;
  const prongSpread = Math.PI * 0.3;
  
  // Central prong
  points.push({ x: cx, y: cy });
  points.push({
    x: cx + prongLength * Math.cos(angle),
    y: cy + prongLength * Math.sin(angle)
  });
  
  // Side prongs
  for (let i = 0; i < prongs; i++) {
    const prongAngle = angle - prongSpread / 2 + (i / (prongs - 1)) * prongSpread;
    const tipX = cx + prongLength * 0.7 * Math.cos(prongAngle);
    const tipY = cy + prongLength * 0.7 * Math.sin(prongAngle);
    
    if (i === 0) {
      points.push({ x: tipX, y: tipY });
    } else {
      points.push({ x: tipX, y: tipY });
    }
  }
  
  return { closed: false, points, type: 'custom' };
}

/**
 * Create the central deity palace (square with gates)
 */
function createDeityPalace(
  cx: number, cy: number, size: number, gateCount: 4 | 8
): VectorPath[] {
  const paths: VectorPath[] = [];
  const halfSize = size / 2;
  
  // Main square palace walls
  const corners = [
    { x: cx - halfSize, y: cy - halfSize },
    { x: cx + halfSize, y: cy - halfSize },
    { x: cx + halfSize, y: cy + halfSize },
    { x: cx - halfSize, y: cy + halfSize }
  ];
  
  // Create walls with gaps for gates
  const gateWidth = size * 0.15;
  
  // Top wall (with gate if 4 gates)
  if (gateCount === 4) {
    paths.push({
      closed: false,
      points: [corners[0], { x: cx - gateWidth / 2, y: cy - halfSize }],
      type: 'line'
    });
    paths.push({
      closed: false,
      points: [{ x: cx + gateWidth / 2, y: cy - halfSize }, corners[1]],
      type: 'line'
    });
  } else {
    paths.push({ closed: true, points: corners, type: 'polygon' });
  }
  
  // Inner concentric squares
  for (let i = 1; i <= 3; i++) {
    const innerSize = size * (1 - i * 0.2);
    const innerHalf = innerSize / 2;
    const innerCorners = [
      { x: cx - innerHalf, y: cy - innerHalf },
      { x: cx + innerHalf, y: cy - innerHalf },
      { x: cx + innerHalf, y: cy + innerHalf },
      { x: cx - innerHalf, y: cy + innerHalf }
    ];
    paths.push({ closed: true, points: innerCorners, type: 'polygon' });
  }
  
  // Gates (T-shaped structures)
  const gateAngles = gateCount === 4 ? [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2] 
                                      : [0, Math.PI / 4, Math.PI / 2, 3 * Math.PI / 4, Math.PI, 5 * Math.PI / 4, 3 * Math.PI / 2, 7 * Math.PI / 4];
  
  for (const angle of gateAngles) {
    const gateX = cx + (halfSize + size * 0.1) * Math.cos(angle);
    const gateY = cy + (halfSize + size * 0.1) * Math.sin(angle);
    
    // Gate arch
    paths.push(createArc(gateX, gateY, size * 0.1, angle - Math.PI / 4, angle + Math.PI / 4));
  }
  
  return paths;
}

/**
 * Create fire ring pattern (flames around the mandala)
 */
function createFireRing(cx: number, cy: number, radius: number, flameCount: number): VectorPath[] {
  const paths: VectorPath[] = [];
  
  for (let i = 0; i < flameCount; i++) {
    const angle = (i / flameCount) * TAU;
    const flameLength = radius * 0.15;
    const flameWidth = radius * 0.05;
    
    // Flame shape using curved petals
    const points: VectorPoint[] = [];
    const baseAngle = angle - Math.PI / 2;
    
    // Base of flame
    points.push({
      x: cx + (radius - flameLength * 0.3) * Math.cos(angle),
      y: cy + (radius - flameLength * 0.3) * Math.sin(angle)
    });
    
    // Left curve
    for (let j = 1; j <= 8; j++) {
      const t = j / 8;
      const r = flameWidth * Math.sin(Math.PI * t);
      const theta = baseAngle + (t - 0.5) * Math.PI * 0.3;
      const d = t * flameLength;
      points.push({
        x: cx + (radius + d) * Math.cos(angle + theta) - r * Math.sin(angle),
        y: cy + (radius + d) * Math.sin(angle + theta) + r * Math.cos(angle)
      });
    }
    
    // Tip
    points.push({
      x: cx + (radius + flameLength) * Math.cos(angle),
      y: cy + (radius + flameLength) * Math.sin(angle)
    });
    
    // Right curve
    for (let j = 8; j >= 0; j--) {
      const t = j / 8;
      const r = flameWidth * Math.sin(Math.PI * t);
      const theta = baseAngle - (t - 0.5) * Math.PI * 0.3;
      const d = t * flameLength;
      points.push({
        x: cx + (radius + d) * Math.cos(angle + theta) + r * Math.sin(angle),
        y: cy + (radius + d) * Math.sin(angle + theta) - r * Math.cos(angle)
      });
    }
    
    paths.push({ closed: true, points, type: 'custom' });
  }
  
  return paths;
}

/**
 * Create lotus petal ring
 */
function createLotusRing(cx: number, cy: number, radius: number, petalCount: number): VectorPath[] {
  const paths: VectorPath[] = [];
  const petalLength = radius * 0.12;
  const petalWidth = radius * 0.04;
  
  for (let i = 0; i < petalCount; i++) {
    const angle = (i / petalCount) * TAU;
    paths.push(createLotusPetal(cx, cy, petalLength, petalWidth, angle));
  }
  
  return paths;
}

/**
 * Create harmonically spaced concentric rings
 */
function createHarmonicRings(
  cx: number, cy: number, innerRadius: number, outerRadius: number, layerCount: number
): VectorPath[] {
  const paths: VectorPath[] = [];
  
  for (let i = 0; i <= layerCount; i++) {
    const t = i / layerCount;
    // Use golden ratio spacing
    const radius = innerRadius * Math.pow(PHI, t * Math.log(outerRadius / innerRadius) / Math.log(PHI));
    paths.push(createCircle(cx, cy, radius));
  }
  
  return paths;
}

/**
 * Create angular divisions (spokes)
 */
function createAngularDivisions(
  cx: number, cy: number, innerRadius: number, outerRadius: number, divisionCount: number
): VectorPath[] {
  const paths: VectorPath[] = [];
  
  for (let i = 0; i < divisionCount; i++) {
    const angle = (i / divisionCount) * TAU;
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
 * Generate complete Tibetan mandala
 */
export function generateTibetanMandala(options: TibetanMandalaOptions): MandalaGeometry {
  const {
    centerX, centerY, outerRadius, layerCount, gateCount,
    includeDeityPalace, includeFireRing, includeLotusRing, includeVajraRing
  } = options;
  
  const paths: VectorPath[] = [];
  
  // Calculate harmonic layer radii
  const innerRadius = outerRadius * 0.05;
  const palaceSize = outerRadius * 0.3;
  
  // 1. Outer fire ring (if enabled)
  if (includeFireRing) {
    const fireRadius = outerRadius * 0.95;
    const firePaths = createFireRing(centerX, centerY, fireRadius, 108); // Traditional 108 flames
    paths.push(...firePaths);
  }
  
  // 2. Harmonic concentric rings
  const ringPaths = createHarmonicRings(centerX, centerY, innerRadius, outerRadius * 0.9, layerCount);
  paths.push(...ringPaths);
  
  // 3. Angular divisions (typically 8 or 16)
  const divisionPaths = createAngularDivisions(
    centerX, centerY, innerRadius, outerRadius * 0.85, gateCount * 2
  );
  paths.push(...divisionPaths);
  
  // 4. Deity palace at center
  if (includeDeityPalace) {
    const palacePaths = createDeityPalace(centerX, centerY, palaceSize, gateCount);
    paths.push(...palacePaths);
  }
  
  // 5. Lotus petal rings
  if (includeLotusRing) {
    const lotusRadius1 = outerRadius * 0.5;
    const lotusRadius2 = outerRadius * 0.7;
    const lotusPaths1 = createLotusRing(centerX, centerY, lotusRadius1, 8 * gateCount);
    const lotusPaths2 = createLotusRing(centerX, centerY, lotusRadius2, 8 * gateCount);
    paths.push(...lotusPaths1, ...lotusPaths2);
  }
  
  // 6. Vajra ring (if enabled)
  if (includeVajraRing) {
    const vajraRadius = outerRadius * 0.88;
    const vajraCount = gateCount * 4;
    for (let i = 0; i < vajraCount; i++) {
      const angle = (i / vajraCount) * TAU;
      const vx = centerX + vajraRadius * Math.cos(angle);
      const vy = centerY + vajraRadius * Math.sin(angle);
      paths.push(createVajra(vx, vy, outerRadius * 0.03, angle + Math.PI / 2));
    }
  }
  
  // 7. Central bindu (dot)
  paths.push(createCircle(centerX, centerY, outerRadius * 0.02, 16));
  
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
 * Generate traditional Tibetan mandala with default parameters
 */
export function createTraditionalTibetanMandala(
  centerX: number = 2048,
  centerY: number = 2048,
  radius: number = 2000
): MandalaGeometry {
  return generateTibetanMandala({
    centerX,
    centerY,
    outerRadius: radius,
    layerCount: 8,
    gateCount: 4,
    detailLevel: 1,
    includeDeityPalace: true,
    includeFireRing: true,
    includeLotusRing: true,
    includeVajraRing: true,
    colorScheme: 'traditional'
  });
}
