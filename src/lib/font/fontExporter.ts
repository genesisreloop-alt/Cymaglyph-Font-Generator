/**
 * Font Exporter - TTF/OTF Generation
 * Converts stroke-based glyph paths to installable font files
 */

import opentype from 'opentype.js';
import type { ParsedGlyph, FontExportOptions, VectorPath, VectorPoint } from '../../types';

interface OpenTypeGlyph {
  name: string;
  unicode: number;
  advanceWidth: number;
  path: opentype.Path;
}

/**
 * Convert vector path to OpenType path commands
 */
function vectorPathToOpenType(path: VectorPath): opentype.Path {
  const otPath = new opentype.Path();
  
  if (path.points.length < 2) return otPath;
  
  // Start at first point
  otPath.moveTo(path.points[0].x, path.points[0].y);
  
  if (path.type === 'circle' || path.type === 'arc') {
    // Use curves for circular shapes
    for (let i = 1; i < path.points.length; i++) {
      const p = path.points[i];
      
      if (i < path.points.length - 1) {
        const next = path.points[i + 1];
        const cpX = p.x + (next.x - p.x) * 0.55;
        const cpY = p.y + (next.y - p.y) * 0.55;
        otPath.quadraticCurveTo(cpX, cpY, next.x, next.y);
      } else {
        otPath.lineTo(p.x, p.y);
      }
    }
  } else {
    // Simple line-to for other path types
    for (let i = 1; i < path.points.length; i++) {
      otPath.lineTo(path.points[i].x, path.points[i].y);
    }
  }
  
  if (path.closed) {
    otPath.close();
  }
  
  return otPath;
}

/**
 * Merge multiple vector paths into a single OpenType path
 */
function mergePathsToGlyph(paths: VectorPath[]): opentype.Path {
  const merged = new opentype.Path();
  
  for (const path of paths) {
    const otPath = vectorPathToOpenType(path);
    
    // Append all commands from this path
    for (const cmd of otPath.commands) {
      if (cmd.type === 'M') {
        merged.moveTo((cmd as any).x ?? 0, (cmd as any).y ?? 0);
      } else if (cmd.type === 'L') {
        merged.lineTo((cmd as any).x ?? 0, (cmd as any).y ?? 0);
      } else if (cmd.type === 'Q') {
        merged.quadraticCurveTo(
          (cmd as any).x1 ?? 0, (cmd as any).y1 ?? 0,
          (cmd as any).x ?? 0, (cmd as any).y ?? 0
        );
      } else if (cmd.type === 'C') {
        merged.curveTo(
          (cmd as any).x1 ?? 0, (cmd as any).y1 ?? 0,
          (cmd as any).x2 ?? 0, (cmd as any).y2 ?? 0,
          (cmd as any).x ?? 0, (cmd as any).y ?? 0
        );
      } else if (cmd.type === 'Z') {
        merged.close();
      }
    }
  }
  
  return merged;
}

/**
 * Create OpenType glyph from parsed glyph
 */
function createOpenTypeGlyph(glyph: ParsedGlyph, unitsPerEm: number): OpenTypeGlyph {
  const mergedPath = mergePathsToGlyph(glyph.paths);
  
  // Scale to units per em
  const bounds = glyph.bounds;
  const glyphWidth = Math.max(1, bounds.xMax - bounds.xMin);
  const scale = (unitsPerEm * 0.7) / glyphWidth;
  
  // Center and scale the path
  const offsetX = -bounds.xMin * scale + (unitsPerEm * 0.15);
  const offsetY = -bounds.yMin * scale;
  
  for (const cmd of mergedPath.commands) {
    if ((cmd as any).x !== undefined) (cmd as any).x = (cmd as any).x * scale + offsetX;
    if ((cmd as any).y !== undefined) (cmd as any).y = (cmd as any).y * scale + offsetY;
    if ((cmd as any).x1 !== undefined) (cmd as any).x1 = (cmd as any).x1 * scale + offsetX;
    if ((cmd as any).y1 !== undefined) (cmd as any).y1 = (cmd as any).y1 * scale + offsetY;
    if ((cmd as any).x2 !== undefined) (cmd as any).x2 = (cmd as any).x2 * scale + offsetX;
    if ((cmd as any).y2 !== undefined) (cmd as any).y2 = (cmd as any).y2 * scale + offsetY;
  }
  
  return {
    name: glyph.name || `glyph${glyph.unicode}`,
    unicode: glyph.unicode.codePointAt(0) ?? 0,
    advanceWidth: unitsPerEm * 0.6,
    path: mergedPath
  };
}

/**
 * Export font as TTF or OTF
 */
export function exportFont(options: FontExportOptions): ArrayBuffer {
  const {
    format,
    familyName,
    styleName,
    unitsPerEm,
    ascender,
    descender,
    glyphs,
    metadata
  } = options;
  
  // Convert glyphs to OpenType format
  const otGlyphs: opentype.Glyph[] = [
    // .notdef glyph (required)
    new opentype.Glyph({
      name: '.notdef',
      unicode: 0,
      advanceWidth: unitsPerEm * 0.5,
      path: new opentype.Path()
    })
  ];
  
  // Add actual glyphs
  for (const glyph of glyphs) {
    const otGlyph = createOpenTypeGlyph(glyph, unitsPerEm);
    otGlyphs.push(
      new opentype.Glyph({
        name: otGlyph.name,
        unicode: otGlyph.unicode,
        advanceWidth: otGlyph.advanceWidth,
        path: otGlyph.path
      })
    );
  }
  
  // Create font object
  const font = new opentype.Font({
    familyName,
    styleName,
    unitsPerEm,
    ascender,
    descender,
    glyphs: otGlyphs,
    version: metadata.version,
    description: metadata.description
  });
  
  // Export based on format
  return font.toArrayBuffer();
}

/**
 * Download font file to browser
 */
export function downloadFont(buffer: ArrayBuffer, filename: string): void {
  const blob = new Blob([buffer], { 
    type: 'font/opentype' 
  });
  
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  
  URL.revokeObjectURL(url);
}

/**
 * Validate glyph paths for font export
 */
export function validateGlyphPaths(glyphs: ParsedGlyph[]): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  for (const glyph of glyphs) {
    if (!glyph.unicode || glyph.unicode.length === 0) {
      errors.push(`Glyph missing unicode: ${glyph.name}`);
    }
    
    if (glyph.paths.length === 0) {
      errors.push(`Glyph has no paths: ${glyph.name}`);
    }
    
    for (const path of glyph.paths) {
      if (path.points.length < 2) {
        errors.push(`Path in ${glyph.name} has insufficient points`);
      }
    }
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}
