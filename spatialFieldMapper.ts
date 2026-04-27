/**
 * Spatial Field Mapper
 * Maps temporal DSP signal to 2D spatial field ψ(x,y) for font generation
 * Uses polar coordinate transformation with symmetry order and radial layer mapping
 */

import type { SignalKernelParams, SpatialPoint } from './coreSignalKernel';
import { computeSpatialField } from './coreSignalKernel';

export interface FieldGridOptions {
  width: number;
  height: number;
  sampleRate: number; // samples per unit distance
  threshold: number;  // contour extraction threshold
}

export interface ContourPoint {
  x: number;
  y: number;
  value: number;
}

export interface ContourPath {
  closed: boolean;
  points: ContourPoint[];
}

/**
 * Creates a scalar field grid by sampling the spatial field function
 */
export function createScalarFieldGrid(
  params: SignalKernelParams,
  bounds: { xMin: number; yMin: number; xMax: number; yMax: number },
  options: FieldGridOptions
): Float32Array {
  const { width, height, sampleRate } = options;
  const field = new Float32Array(width * height);
  
  const cellWidth = (bounds.xMax - bounds.xMin) / width;
  const cellHeight = (bounds.yMax - bounds.yMin) / height;
  
  const centerX = (bounds.xMin + bounds.xMax) * 0.5;
  const centerY = (bounds.yMin + bounds.yMax) * 0.5;
  const scale = Math.max(bounds.xMax - bounds.xMin, bounds.yMax - bounds.yMin);
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const px = bounds.xMin + x * cellWidth;
      const py = bounds.yMin + y * cellHeight;
      
      const point: SpatialPoint = { x: px, y: py };
      const value = computeSpatialField(point, params, { x: centerX, y: centerY }, 1 / scale);
      
      // Normalize to 0-1 range for contouring
      const normalizedValue = (value + 1) * 0.5;
      field[y * width + x] = normalizedValue;
    }
  }
  
  return field;
}

/**
 * Marching Squares contour extraction algorithm
 * Extracts isocontours from scalar field at specified threshold
 */
export function extractContours(
  field: Float32Array,
  width: number,
  height: number,
  threshold: number = 0.5
): ContourPath[] {
  const contours: ContourPath[] = [];
  const visited = new Set<string>();
  
  // Edge table for marching squares cases
  const edgeTable = [
    0x00, 0x09, 0x06, 0x0F, 0x0C, 0x05, 0x0A, 0x03,
    0x03, 0x0A, 0x05, 0x0C, 0x0F, 0x06, 0x09, 0x00
  ];
  
  // Interpolate point along edge
  const interpolate = (
    x0: number, y0: number, v0: number,
    x1: number, y1: number, v1: number
  ): ContourPoint => {
    const t = (threshold - v0) / (v1 - v0 + 1e-10);
    return {
      x: x0 + t * (x1 - x0),
      y: y0 + t * (y1 - y0),
      value: threshold
    };
  };
  
  // Get cell value (0 or 1 based on threshold)
  const getCellValue = (x: number, y: number): number => {
    if (x < 0 || x >= width || y < 0 || y >= height) return 0;
    return field[y * width + x] > threshold ? 1 : 0;
  };
  
  // Get cell value from field
  const getValue = (x: number, y: number): number => {
    if (x < 0 || x >= width || y < 0 || y >= height) return 0;
    return field[y * width + x];
  };
  
  // Trace contour from starting edge
  const traceContour = (startX: number, startY: number, edge: number): ContourPath | null => {
    const points: ContourPoint[] = [];
    let x = startX;
    let y = startY;
    let currentEdge = edge;
    const startKey = `${startX},${startY},${currentEdge}`;
    
    do {
      const key = `${x},${y},${currentEdge}`;
      if (visited.has(key)) break;
      visited.add(key);
      
      // Get corner values
      const v00 = getValue(x, y);
      const v10 = getValue(x + 1, y);
      const v11 = getValue(x + 1, y + 1);
      const v01 = getValue(x, y + 1);
      
      // Interpolate based on edge
      let point: ContourPoint;
      switch (currentEdge) {
        case 0: // Top edge
          point = interpolate(x, y, v00, x + 1, y, v10);
          break;
        case 1: // Right edge
          point = interpolate(x + 1, y, v10, x + 1, y + 1, v11);
          break;
        case 2: // Bottom edge
          point = interpolate(x + 1, y + 1, v11, x, y + 1, v01);
          break;
        case 3: // Left edge
          point = interpolate(x, y + 1, v01, x, y, v00);
          break;
        default:
          return null;
      }
      
      points.push(point);
      
      // Determine next edge based on case
      const caseIndex = (getCellValue(x, y) << 0) |
                       (getCellValue(x + 1, y) << 1) |
                       (getCellValue(x + 1, y + 1) << 2) |
                       (getCellValue(x, y + 1) << 3);
      
      const nextEdges = [
        [1],           // 0000
        [1, 3],        // 0001
        [2, 1],        // 0010
        [2, 3],        // 0011
        [3, 2],        // 0100
        [3, 1],        // 0101
        [3, 2, 1, 3],  // 0110 (ambiguous)
        [2, 1],        // 0111
        [0, 3],        // 1000
        [0, 1],        // 1001
        [0, 1, 3, 2],  // 1010 (ambiguous)
        [0, 3],        // 1011
        [0, 2],        // 1100
        [1, 0],        // 1101
        [2, 0],        // 1110
        []             // 1111
      ];
      
      const edges = nextEdges[caseIndex];
      if (!edges || edges.length === 0) break;
      
      // Find next edge in sequence
      const edgeIdx = edges.indexOf(currentEdge);
      if (edgeIdx === -1 || edgeIdx === edges.length - 1) {
        currentEdge = edges[0];
      } else {
        currentEdge = edges[edgeIdx + 1];
      }
      
      // Move to next cell based on edge direction
      switch (currentEdge) {
        case 0: x--; break;
        case 1: y++; break;
        case 2: x++; break;
        case 3: y--; break;
      }
      
    } while ((x !== startX || y !== startY) && points.length < 1000);
    
    return points.length > 2 ? { closed: true, points } : null;
  };
  
  // Scan for contour seeds
  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      const caseIndex = (getCellValue(x, y) << 0) |
                       (getCellValue(x + 1, y) << 1) |
                       (getCellValue(x + 1, y + 1) << 2) |
                       (getCellValue(x, y + 1) << 3);
      
      if (caseIndex !== 0 && caseIndex !== 15) {
        // Check if this cell has an unvisited edge
        for (let edge = 0; edge < 4; edge++) {
          const key = `${x},${y},${edge}`;
          if (!visited.has(key)) {
            const contour = traceContour(x, y, edge);
            if (contour && contour.points.length > 2) {
              contours.push(contour);
            }
          }
        }
      }
    }
  }
  
  return contours;
}

/**
 * Converts contour paths to OpenType path commands
 */
export function contourToOpenTypePath(
  contour: ContourPath,
  scaleX: number = 1,
  scaleY: number = 1,
  offsetX: number = 0,
  offsetY: number = 0
): Array<{ command: string; args: number[] }> {
  const commands: Array<{ command: string; args: number[] }> = [];
  
  if (contour.points.length < 2) return commands;
  
  const first = contour.points[0];
  commands.push({
    command: 'M',
    args: [first.x * scaleX + offsetX, first.y * scaleY + offsetY]
  });
  
  for (let i = 1; i < contour.points.length; i++) {
    const p = contour.points[i];
    commands.push({
      command: 'L',
      args: [p.x * scaleX + offsetX, p.y * scaleY + offsetY]
    });
  }
  
  if (contour.closed) {
    commands.push({ command: 'Z', args: [] });
  }
  
  return commands;
}

/**
 * High-resolution field sampling for 4K output
 */
export function create4KScalarField(
  params: SignalKernelParams,
  bounds: { xMin: number; yMin: number; xMax: number; yMax: number }
): Float32Array {
  const resolution = 4096;
  return createScalarFieldGrid(params, bounds, {
    width: resolution,
    height: resolution,
    sampleRate: 1.0,
    threshold: 0.5
  });
}
