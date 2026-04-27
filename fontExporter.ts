/**
 * Font Exporter for CYMAGYPH Font Generator
 * Handles TTF and OTF export with proper metadata embedding
 */

import * as opentype from 'opentype.js';
import type { SignalKernelParams } from './coreSignalKernel';

export interface FontExportOptions {
  familyName: string;
  styleName: string;
  version: string;
  description: string;
  copyright: string;
  manufacturer: string;
  designer: string;
  license: string;
  embedSignalParams: boolean;
}

export interface GlyphDefinition {
  unicode: number;
  name: string;
  advanceWidth: number;
  path: opentype.Path;
}

export interface FontExportResult {
  buffer: ArrayBuffer;
  format: 'ttf' | 'otf';
  fileName: string;
  metadata: Record<string, string>;
}

/**
 * Creates OpenType font with proper metadata
 */
export function createOpenTypeFont(
  glyphs: GlyphDefinition[],
  options: FontExportOptions,
  unitsPerEm: number = 1000
): opentype.Font {
  const opentypeGlyphs: opentype.Glyph[] = [];
  
  // Add .notdef glyph
  const notdefPath = new opentype.Path();
  notdefPath.moveTo(0, 0);
  notdefPath.lineTo(unitsPerEm * 0.6, 0);
  notdefPath.lineTo(unitsPerEm * 0.6, unitsPerEm * 0.9);
  notdefPath.lineTo(0, unitsPerEm * 0.9);
  notdefPath.close();
  
  opentypeGlyphs.push(new opentype.Glyph({
    name: '.notdef',
    unicode: 0,
    advanceWidth: Math.round(unitsPerEm * 0.7),
    path: notdefPath
  }));
  
  // Add user glyphs
  for (const glyph of glyphs) {
    opentypeGlyphs.push(new opentype.Glyph({
      name: glyph.name,
      unicode: glyph.unicode,
      advanceWidth: glyph.advanceWidth,
      path: glyph.path
    }));
  }
  
  // Create font with metadata
  const font = new opentype.Font({
    familyName: options.familyName,
    styleName: options.styleName,
    unitsPerEm,
    ascender: Math.round(unitsPerEm * 0.8),
    descender: -Math.round(unitsPerEm * 0.2),
    glyphs: opentypeGlyphs,
    
    // Metadata fields
    version: options.version,
    description: options.description,
    copyright: options.copyright,
    manufacturer: options.manufacturer,
    designer: options.designer,
    license: options.license,
    
    // Additional naming table entries
    fullName: `${options.familyName} ${options.styleName}`,
    psName: `${options.familyName.replace(/\s+/g, '')}-${options.styleName.replace(/\s+/g, '')}`,
    
    // OpenType-specific fields
    weightClassName: options.styleName.includes('Bold') ? 'Bold' : 
                     options.styleName.includes('Medium') ? 'Medium' : 'Regular',
    widthName: 'Normal'
  });
  
  return font;
}

/**
 * Exports font as TTF (TrueType Format)
 */
export function exportAsTTF(font: opentype.Font): ArrayBuffer {
  return font.toArrayBuffer();
}

/**
 * Exports font as OTF (OpenType CFF Format)
 * Note: opentype.js primarily supports TTF output
 * For true CFF/OTF, additional conversion may be needed
 */
export function exportAsOTF(font: opentype.Font): ArrayBuffer {
  // opentype.js outputs OTF-compatible format when using CFF paths
  // For now, we use the same output but with .otf extension
  // True CFF conversion would require additional library
  return font.toArrayBuffer();
}

/**
 * Embeds signal parameters into font metadata
 */
export function embedSignalParams(
  font: opentype.Font,
  params: SignalKernelParams
): void {
  // Store signal parameters in font's private data
  // These can be retrieved when the font is loaded
  const paramData = JSON.stringify(params);
  
  // In a full implementation, this would use OpenType tables:
  // - name table for human-readable info
  // - meta table for XML metadata
  // - Custom table for binary data
  
  // For now, we append to description field
  if (font.names && font.names.description) {
    for (const key in font.names.description) {
      const original = font.names.description[key];
      font.names.description[key] = `${original}\n[CYMAGYPH_PARAMS:${paramData}]`;
    }
  }
}

/**
 * Main export function with format selection
 */
export function exportFont(
  glyphs: GlyphDefinition[],
  options: FontExportOptions,
  format: 'ttf' | 'otf' = 'ttf',
  signalParams?: SignalKernelParams
): FontExportResult {
  const font = createOpenTypeFont(glyphs, options);
  
  // Embed signal parameters if requested
  if (options.embedSignalParams && signalParams) {
    embedSignalParams(font, signalParams);
  }
  
  // Export in selected format
  const buffer = format === 'ttf' ? exportAsTTF(font) : exportAsOTF(font);
  
  // Generate filename
  const ext = format === 'ttf' ? 'ttf' : 'otf';
  const fileName = `${options.familyName.replace(/\s+/g, '_')}-${options.styleName.replace(/\s+/g, '_')}.${ext}`;
  
  // Build metadata record
  const metadata: Record<string, string> = {
    familyName: options.familyName,
    styleName: options.styleName,
    version: options.version,
    format,
    glyphCount: String(glyphs.length + 1), // +1 for .notdef
    exportDate: new Date().toISOString()
  };
  
  if (signalParams) {
    metadata.signalParams = JSON.stringify(signalParams);
  }
  
  return {
    buffer,
    format,
    fileName,
    metadata
  };
}

/**
 * Downloads font file in browser environment
 */
export function downloadFont(result: FontExportResult): void {
  if (typeof window === 'undefined') {
    throw new Error('downloadFont is only available in browser environment');
  }
  
  const mimeType = result.format === 'ttf' ? 'font/ttf' : 'font/otf';
  const blob = new Blob([result.buffer], { type: mimeType });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = result.fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  
  URL.revokeObjectURL(url);
}

/**
 * Validates font for installation compatibility
 */
export function validateFontForInstallation(font: opentype.Font): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  // Check required fields
  if (!font.familyName || font.familyName.length === 0) {
    errors.push('Missing family name');
  }
  
  if (!font.styleName || font.styleName.length === 0) {
    errors.push('Missing style name');
  }
  
  // Check units per em (should be power of 2 for best compatibility)
  const upem = font.unitsPerEm || 1000;
  if (upem < 16 || upem > 16384) {
    errors.push(`Invalid units per em: ${upem} (must be 16-16384)`);
  }
  
  if ((upem & (upem - 1)) !== 0) {
    warnings.push(`Units per em (${upem}) is not a power of 2, which may cause issues on some platforms`);
  }
  
  // Check glyph count
  const glyphCount = font.glyphs.length;
  if (glyphCount < 2) {
    errors.push('Font must contain at least .notdef and one character glyph');
  }
  
  if (glyphCount > 65535) {
    errors.push('Too many glyphs (max 65535 for BMP fonts)');
  }
  
  // Check advance widths
  font.glyphs.forEach((glyph, idx) => {
    if (glyph.advanceWidth < 0) {
      warnings.push(`Glyph ${idx} has negative advance width`);
    }
    if (glyph.advanceWidth > upem * 2) {
      warnings.push(`Glyph ${idx} has very large advance width`);
    }
  });
  
  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}
