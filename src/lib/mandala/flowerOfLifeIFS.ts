/**
 * Flower of Life - Iterated Function System Generator
 * Based on the uploaded FOL pixel array worker specification
 * Generates precise hexagonal circle packing using IFS transformations
 */

import type { VectorPoint, VectorPath, MandalaGeometry } from '../../types';

const TAU = Math.PI * 2;
const SQRT3 = 1.7320508075688772;

interface IFSPoint {
  x: number;
  y: number;
  iteration: number;
}

interface FlowerOfLifeOptions {
  centerX: number;
  centerY: number;
  radius: number;
  rings: number;
  segmentsPerCircle: number;
}

/**
 * Create a circle path with specified segments
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
 * Generate hexagonal lattice points using IFS
 * Each point represents the center of a circle in the Flower of Life
 */
function generateHexagonalLattice(
  centerX: number,
  centerY: number,
  radius: number,
  rings: number
): VectorPoint[] {
  const points: VectorPoint[] = [{ x: centerX, y: centerY }];
  
  // Hexagonal grid spacing
  const spacing = radius;
  const rowHeight = radius * SQRT3;
  
  // Generate points ring by ring
  for (let ring = 1; ring <= rings; ring++) {
    const ringRadius = ring * spacing;
    const pointsInRing = ring * 6;
    
    for (let i = 0; i < pointsInRing; i++) {
      const angle = (i / pointsInRing) * TAU;
      points.push({
        x: centerX + ringRadius * Math.cos(angle),
        y: centerY + ringRadius * Math.sin(angle)
      });
    }
  }
  
  return points;
}

/**
 * IFS transformation for Flower of Life
 * Uses 7 contraction mappings (central + 6 surrounding)
 */
function applyIFSTransformations(
  points: IFSPoint[],
  centerX: number,
  centerY: number,
  radius: number,
  iterations: number
): IFSPoint[] {
  const results: IFSPoint[] = [...points];
  
  // Seven IFS functions for Flower of Life
  const transforms = [
    // Central (identity)
    (x: number, y: number) => ({ x, y }),
    // Six surrounding circles
    (x: number, y: number) => ({ x: x + radius, y }),
    (x: number, y: number) => ({ x: x + radius * 0.5, y: y + radius * SQRT3 / 2 }),
    (x: number, y: number) => ({ x: x - radius * 0.5, y: y + radius * SQRT3 / 2 }),
    (x: number, y: number) => ({ x: x - radius, y }),
    (x: number, y: number) => ({ x: x - radius * 0.5, y: y - radius * SQRT3 / 2 }),
    (x: number, y: number) => ({ x: x + radius * 0.5, y: y - radius * SQRT3 / 2 }),
  ];
  
  for (let iter = 0; iter < iterations; iter++) {
    const newPoints: IFSPoint[] = [];
    
    for (const point of points) {
      for (const transform of transforms) {
        const transformed = transform(point.x, point.y);
        newPoints.push({
          ...transformed,
          iteration: iter + 1
        });
      }
    }
    
    // Deduplicate points within tolerance
    const tolerance = radius * 0.001;
    const unique: IFSPoint[] = [];
    
    for (const point of newPoints) {
      const isDuplicate = unique.some(p => 
        Math.abs(p.x - point.x) < tolerance && 
        Math.abs(p.y - point.y) < tolerance
      );
      
      if (!isDuplicate) {
        unique.push(point);
      }
    }
    
    results.push(...unique);
    points = unique;
  }
  
  return results;
}

/**
 * Generate complete Flower of Life pattern
 */
export function generateFlowerOfLife(options: FlowerOfLifeOptions): MandalaGeometry {
  const { centerX, centerY, radius, rings, segmentsPerCircle } = options;
  
  const paths: VectorPath[] = [];
  
  // Generate lattice points
  const latticePoints = generateHexagonalLattice(centerX, centerY, radius, rings);
  
  // Create circle at each lattice point
  for (const point of latticePoints) {
    paths.push(createCircle(point.x, point.y, radius, segmentsPerCircle));
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
 * Generate Seed of Life (first ring only - 7 circles)
 */
export function generateSeedOfLife(
  centerX: number = 2048,
  centerY: number = 2048,
  radius: number = 500,
  segments: number = 64
): MandalaGeometry {
  return generateFlowerOfLife({
    centerX,
    centerY,
    radius,
    rings: 1,
    segmentsPerCircle: segments
  });
}

/**
 * Generate Fruit of Life (3 rings - 19 circles)
 */
export function generateFruitOfLife(
  centerX: number = 2048,
  centerY: number = 2048,
  radius: number = 400,
  segments: number = 64
): MandalaGeometry {
  return generateFlowerOfLife({
    centerX,
    centerY,
    radius,
    rings: 2,
    segmentsPerCircle: segments
  });
}

/**
 * Convert Flower of Life to stroke-based glyph paths
 * Extracts the overlapping regions as continuous strokes
 */
export function flowerOfLifeToStrokes(
  geometry: MandalaGeometry,
  strokeWidth: number = 10
): VectorPath[] {
  const strokePaths: VectorPath[] = [];
  
  // For each circle, create an inner and outer offset for stroke
  for (const path of geometry.paths) {
    if (path.type !== 'circle') continue;
    
    const avgX = path.points.reduce((sum, p) => sum + p.x, 0) / path.points.length;
    const avgY = path.points.reduce((sum, p) => sum + p.y, 0) / path.points.length;
    
    // Calculate actual radius from points
    const firstPoint = path.points[0];
    const actualRadius = Math.sqrt(
      Math.pow(firstPoint.x - avgX, 2) + Math.pow(firstPoint.y - avgY, 2)
    );
    
    // Create outer stroke boundary
    const outerRadius = actualRadius + strokeWidth / 2;
    const innerRadius = Math.max(0, actualRadius - strokeWidth / 2);
    
    // Create stroke as two concentric circles connected
    const segments = path.points.length - 1;
    const strokePoints: VectorPoint[] = [];
    
    // Outer circle clockwise
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * TAU;
      strokePoints.push({
        x: avgX + outerRadius * Math.cos(angle),
        y: avgY + outerRadius * Math.sin(angle)
      });
    }
    
    // Inner circle counter-clockwise
    for (let i = segments; i >= 0; i--) {
      const angle = (i / segments) * TAU;
      strokePoints.push({
        x: avgX + innerRadius * Math.cos(angle),
        y: avgY + innerRadius * Math.sin(angle)
      });
    }
    
    strokePaths.push({
      closed: true,
      points: strokePoints,
      type: 'stroke'
    });
  }
  
  return strokePaths;
}
