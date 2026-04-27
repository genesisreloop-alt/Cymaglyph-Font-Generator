/**
 * Density Contour Engine
 * Converts scalar field density maps to stroke-based vector paths for font generation
 * Implements Marching Squares with smoothing and mandalic geometry overlay
 */

import type { SignalKernelParams } from './coreSignalKernel';
import { createScalarFieldGrid, extractContours, contourToOpenTypePath, type ContourPath } from './spatialFieldMapper';
import * as opentype from 'opentype.js';

export interface ContourEngineOptions {
  threshold: number;
  smoothIterations: number;
  minContourPoints: number;
  simplifyTolerance: number;
}

export interface StrokePath {
  closed: boolean;
  points: Array<{ x: number; y: number }>;
  innerContours?: StrokePath[]; // For mandalic internal geometries
}

/**
 * Smooths contour points using Chaikin's corner cutting algorithm
 */
function smoothContour(points: Array<{ x: number; y: number }>, iterations: number = 2): Array<{ x: number; y: number }> {
  let current = points;
  
  for (let iter = 0; iter < iterations; iter++) {
    const smoothed: Array<{ x: number; y: number }> = [];
    const n = current.length;
    
    for (let i = 0; i < n; i++) {
      const p0 = current[i];
      const p1 = current[(i + 1) % n];
      
      // Quarter point
      smoothed.push({
        x: p0.x * 0.75 + p1.x * 0.25,
        y: p0.y * 0.75 + p1.y * 0.25
      });
      
      // Three-quarter point
      smoothed.push({
        x: p0.x * 0.25 + p1.x * 0.75,
        y: p0.y * 0.25 + p1.y * 0.75
      });
    }
    
    current = smoothed;
  }
  
  return current;
}

/**
 * Simplifies contour using Douglas-Peucker algorithm
 */
function simplifyContour(
  points: Array<{ x: number; y: number }>,
  tolerance: number
): Array<{ x: number; y: number }> {
  if (points.length < 3) return points;
  
  const douglasPeucker = (pts: Array<{ x: number; y: number }>, tol: number): Array<{ x: number; y: number }> => {
    if (pts.length < 3) return pts;
    
    let maxDist = 0;
    let maxIdx = 0;
    const first = pts[0];
    const last = pts[pts.length - 1];
    
    for (let i = 1; i < pts.length - 1; i++) {
      const dist = perpendicularDistance(pts[i], first, last);
      if (dist > maxDist) {
        maxDist = dist;
        maxIdx = i;
      }
    }
    
    if (maxDist > tol) {
      const left = douglasPeucker(pts.slice(0, maxIdx + 1), tol);
      const right = douglasPeucker(pts.slice(maxIdx), tol);
      return [...left.slice(0, -1), ...right];
    } else {
      return [first, last];
    }
  };
  
  return douglasPeucker(points, tolerance);
}

function perpendicularDistance(
  point: { x: number; y: number },
  lineStart: { x: number; y: number },
  lineEnd: { x: number; y: number }
): number {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  const mag = Math.sqrt(dx * dx + dy * dy);
  
  if (mag === 0) return Math.sqrt((point.x - lineStart.x) ** 2 + (point.y - lineStart.y) ** 2);
  
  return Math.abs(dy * point.x - dx * point.y + lineEnd.x * lineStart.y - lineEnd.y * lineStart.x) / mag;
}

/**
 * Generates inner mandalic contours within a primary stroke path
 * Creates concentric harmonic geometries based on golden ratio subdivisions
 */
function generateMandalicInnerContours(
  outerPath: StrokePath,
  params: SignalKernelParams,
  layerCount: number = 3
): StrokePath[] {
  const innerContours: StrokePath[] = [];
  const PHI = 1.618033988749895;
  
  // Calculate centroid of outer path
  const centroid = outerPath.points.reduce(
    (acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }),
    { x: 0, y: 0 }
  );
  centroid.x /= outerPath.points.length;
  centroid.y /= outerPath.points.length;
  
  // Generate inner layers with phi-based scaling
  for (let layer = 1; layer <= layerCount; layer++) {
    const scale = Math.pow(1 / PHI, layer);
    const innerPoints = outerPath.points.map(p => ({
      x: centroid.x + (p.x - centroid.x) * scale,
      y: centroid.y + (p.y - centroid.y) * scale
    }));
    
    // Apply angular modulation based on symmetry order
    const modulatedPoints = innerPoints.map((p, i) => {
      const angle = (i / innerPoints.length) * Math.PI * 2;
      const modulation = Math.sin(angle * params.symmetryOrder) * 0.05 * layer;
      const r = Math.sqrt((p.x - centroid.x) ** 2 + (p.y - centroid.y) ** 2);
      const theta = Math.atan2(p.y - centroid.y, p.x - centroid.x);
      
      return {
        x: centroid.x + r * (1 + modulation) * Math.cos(theta),
        y: centroid.y + r * (1 + modulation) * Math.sin(theta)
      };
    });
    
    innerContours.push({
      closed: true,
      points: modulatedPoints
    });
  }
  
  return innerContours;
}

/**
 * Builds stroke paths from density field using Marching Squares
 */
export function buildStrokePathsFromDensityField(
  params: SignalKernelParams,
  bounds: { xMin: number; yMin: number; xMax: number; yMax: number },
  options: ContourEngineOptions = {
    threshold: 0.5,
    smoothIterations: 2,
    minContourPoints: 4,
    simplifyTolerance: 0.5
  }
): StrokePath[] {
  // Create scalar field at working resolution
  const workingRes = 512; // Working resolution for contour extraction
  const field = createScalarFieldGrid(params, bounds, {
    width: workingRes,
    height: workingRes,
    sampleRate: 1.0,
    threshold: options.threshold
  });
  
  // Extract contours
  const rawContours = extractContours(field, workingRes, workingRes, options.threshold);
  
  // Convert to stroke paths with smoothing
  const scaleX = (bounds.xMax - bounds.xMin) / workingRes;
  const scaleY = (bounds.yMax - bounds.yMin) / workingRes;
  const offsetX = bounds.xMin;
  const offsetY = bounds.yMin;
  
  const strokePaths: StrokePath[] = [];
  
  for (const contour of rawContours) {
    // Scale contour points to glyph coordinates
    const scaledPoints = contour.points.map(p => ({
      x: p.x * scaleX + offsetX,
      y: p.y * scaleY + offsetY
    }));
    
    // Skip if too few points
    if (scaledPoints.length < options.minContourPoints) continue;
    
    // Smooth the contour
    const smoothedPoints = smoothContour(scaledPoints, options.smoothIterations);
    
    // Simplify to reduce point count while preserving shape
    const simplifiedPoints = simplifyContour(smoothedPoints, options.simplifyTolerance);
    
    // Create stroke path
    const strokePath: StrokePath = {
      closed: contour.closed,
      points: simplifiedPoints
    };
    
    // Generate inner mandalic contours for larger strokes
    const area = calculatePathArea(simplifiedPoints);
    if (area > 100 && params.radialLayers > 2) {
      strokePath.innerContours = generateMandalicInnerContours(
        strokePath,
        params,
        Math.min(params.radialLayers, 4)
      );
    }
    
    strokePaths.push(strokePath);
  }
  
  return strokePaths;
}

/**
 * Calculates approximate area of a closed path using shoelace formula
 */
function calculatePathArea(points: Array<{ x: number; y: number }>): number {
  if (points.length < 3) return 0;
  
  let area = 0;
  const n = points.length;
  
  for (let i = 0; i < n; i++) {
    const p = points[i];
    const q = points[(i + 1) % n];
    area += p.x * q.y - q.x * p.y;
  }
  
  return Math.abs(area) * 0.5;
}

/**
 * Converts stroke paths to OpenType Path object
 */
export function strokePathsToOpenTypePath(strokePaths: StrokePath[]): opentype.Path {
  const path = new opentype.Path();
  
  for (const stroke of strokePaths) {
    if (stroke.points.length < 2) continue;
    
    // Draw outer contour
    path.moveTo(stroke.points[0].x, stroke.points[0].y);
    
    for (let i = 1; i < stroke.points.length; i++) {
      const prev = stroke.points[i - 1];
      const curr = stroke.points[i];
      
      // Use quadratic curves for smoother output
      const cx = (prev.x + curr.x) * 0.5;
      const cy = (prev.y + curr.y) * 0.5;
      path.quadTo(cx, cy, curr.x, curr.y);
    }
    
    if (stroke.closed) {
      path.close();
    }
    
    // Draw inner contours (holes/mandalic details)
    if (stroke.innerContours) {
      for (const inner of stroke.innerContours) {
        if (inner.points.length < 2) continue;
        
        path.moveTo(inner.points[0].x, inner.points[0].y);
        
        for (let i = 1; i < inner.points.length; i++) {
          const prev = inner.points[i - 1];
          const curr = inner.points[i];
          const cx = (prev.x + curr.x) * 0.5;
          const cy = (prev.y + curr.y) * 0.5;
          path.quadTo(cx, cy, curr.x, curr.y);
        }
        
        if (inner.closed) {
          path.close();
        }
      }
    }
  }
  
  return path;
}

/**
 * Main entry point: builds complete glyph path from DSP parameters
 */
export function buildGlyphPathFromDSP(
  params: SignalKernelParams,
  bounds: { xMin: number; yMin: number; xMax: number; yMax: number },
  advanceWidth: number
): opentype.Path {
  const strokePaths = buildStrokePathsFromDensityField(params, bounds);
  const path = strokePathsToOpenTypePath(strokePaths);
  
  return path;
}
