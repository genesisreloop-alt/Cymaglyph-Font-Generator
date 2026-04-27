import * as opentype from "opentype.js";
import { hashObject } from "@/lib/cymaglyphicCause/hash";
import { computeGlyphSignature } from "@/lib/fontTranspiler/glyphSignature";
import { parseGlyph } from "@/lib/fontTranspiler/glyphParser";
import { generateConditionedPointCloud } from "@/lib/fontTranspiler/conditionalIFS";
import { buildCymaglyphGlyphPath, toSvgPathData } from "@/lib/fontTranspiler/vectorizeGlyph";
import { glyphSignatureToSacredParams } from "@/lib/fontTranspiler/signatureToSacredParams";
import { buildGlyphPathFromDSP } from "./densityContourEngine";
import { exportFont, validateFontForInstallation } from "./fontExporter";
import type { SignalKernelParams } from "./coreSignalKernel";
import type { FontTranspileBuildRequest, GlyphCymaglyphArtifact, DspFontExportOptions } from "@/lib/fontTranspiler/types";

export interface FontBuildOutput {
  font: opentype.Font;
  artifacts: GlyphCymaglyphArtifact[];
  hash: string;
  buffer: ArrayBuffer;
}

export interface StrokeBasedFontBuildOutput {
  font: opentype.Font;
  buffer: ArrayBuffer;
  format: 'ttf' | 'otf';
  fileName: string;
  validation: { valid: boolean; errors: string[]; warnings: string[] };
  metadata: Record<string, string>;
}

function makeNotdefGlyph(unitsPerEm: number): opentype.Glyph {
  const p = new opentype.Path();
  const w = unitsPerEm * 0.6;
  const h = unitsPerEm * 0.9;
  p.moveTo(0, 0);
  p.lineTo(w, 0);
  p.lineTo(w, h);
  p.lineTo(0, h);
  p.close();
  return new opentype.Glyph({
    name: ".notdef",
    unicode: 0,
    advanceWidth: Math.round(w + unitsPerEm * 0.1),
    path: p,
  });
}

export async function buildCymaglyphFontFromSource(
  sourceFont: opentype.Font,
  request: FontTranspileBuildRequest,
): Promise<FontBuildOutput> {
  const unitsPerEm = sourceFont.unitsPerEm || 1000;
  const glyphs: opentype.Glyph[] = [makeNotdefGlyph(unitsPerEm)];
  const artifacts: GlyphCymaglyphArtifact[] = [];

  for (const ch of request.chars) {
    const parsed = parseGlyph(sourceFont, ch, unitsPerEm);
    if (!parsed) continue;
    const sig = computeGlyphSignature(parsed);
    const params = glyphSignatureToSacredParams(sig, request.mode, request.modulation);
    params.alpha = request.alpha;
    const pointCount = Math.max(6000, Math.floor(9000 * params.sampleDensity));
    const points = generateConditionedPointCloud(parsed, params, pointCount);
    const newPath = buildCymaglyphGlyphPath(parsed, points, params);
    const glyph = new opentype.Glyph({
      name: `uni${parsed.unicode.toString(16).toUpperCase().padStart(4, "0")}`,
      unicode: parsed.unicode,
      advanceWidth: parsed.advanceWidth,
      path: newPath,
    });
    glyphs.push(glyph);

    const pointHash = await hashObject({
      char: ch,
      signature: sig,
      params,
      pathData: toSvgPathData(newPath),
      pointCount: points.length,
    });

    artifacts.push({
      glyph: parsed,
      signature: sig,
      params,
      points,
      pointHash,
    });
  }

  const font = new opentype.Font({
    familyName: request.familyName,
    styleName: request.styleName,
    unitsPerEm,
    ascender: sourceFont.ascender || Math.round(unitsPerEm * 0.8),
    descender: sourceFont.descender || -Math.round(unitsPerEm * 0.2),
    glyphs,
  });

  const hash = await hashObject({
    sourceFontName: request.sourceFontName,
    familyName: request.familyName,
    styleName: request.styleName,
    chars: request.chars.join(""),
    mode: request.mode,
    alpha: request.alpha,
    glyphCount: glyphs.length,
    glyphHashes: artifacts.map((a) => a.pointHash),
  });
  const buffer = font.toArrayBuffer();
  return { font, artifacts, hash, buffer };
}

export function downloadBuiltFont(font: opentype.Font, fileName: string, mimeType: string = "font/ttf") {
  const buf = font.toArrayBuffer();
  const blob = new Blob([buf], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Build font using stroke-based DSP generation (new method)
 * Replaces point cloud displacement with density contour extraction
 */
export async function buildStrokeBasedCymaglyphFont(
  request: FontTranspileBuildRequest,
  exportFormat: 'ttf' | 'otf' = 'ttf'
): Promise<StrokeBasedFontBuildOutput> {
  const unitsPerEm = 1000;
  const glyphs: Array<{ unicode: number; name: string; advanceWidth: number; path: opentype.Path }> = [];
  
  // Convert modulation params to SignalKernelParams
  const signalParams: SignalKernelParams = {
    carrierHz: request.modulation.carrierHz,
    payloadHz: request.modulation.payloadHz,
    amDepth: request.modulation.amDepth,
    pmDepth: request.modulation.pmDepth,
    resonanceQ: request.modulation.resonanceQ,
    scalar: request.modulation.scalar,
    bivector: request.modulation.bivector,
    trivector: request.modulation.trivector,
    magneticSaturation: request.modulation.magneticSaturation ?? 1.5,
    ampereTension: request.modulation.ampereTension ?? 0.8,
    symmetryOrder: request.modulation.symmetryOrder ?? 12,
    radialLayers: request.modulation.radialLayers ?? 7
  };
  
  // Generate each glyph using DSP-based stroke extraction
  for (const char of request.chars) {
    const charCode = char.charCodeAt(0);
    const bounds = { xMin: 50, yMin: 100, xMax: 550, yMax: 900 };
    const advanceWidth = unitsPerEm * 0.6;
    
    const path = buildGlyphPathFromDSP(signalParams, bounds, advanceWidth);
    
    glyphs.push({
      unicode: charCode,
      name: `uni${charCode.toString(16).toUpperCase().padStart(4, '0')}`,
      advanceWidth,
      path
    });
  }
  
  // Export options
  const exportOptions: DspFontExportOptions = {
    familyName: request.familyName,
    styleName: request.styleName,
    version: '1.0.0',
    description: 'CYMAGYPH - DSP-generated sacred geometry font',
    copyright: '© 2024 CYMAGYPH Project',
    manufacturer: 'CYMAGYPH Generator',
    designer: 'DSP Engine',
    license: 'MIT',
    embedSignalParams: true
  };
  
  // Use font exporter
  const result = exportFont(
    glyphs,
    exportOptions,
    exportFormat,
    signalParams
  );
  
  // Create opentype font for validation
  const font = new opentype.Font({
    familyName: request.familyName,
    styleName: request.styleName,
    unitsPerEm,
    ascender: Math.round(unitsPerEm * 0.8),
    descender: -Math.round(unitsPerEm * 0.2),
    glyphs: glyphs.map(g => new opentype.Glyph(g))
  });
  
  // Validate for installation
  const validation = validateFontForInstallation(font);
  
  return {
    font,
    buffer: result.buffer,
    format: result.format,
    fileName: result.fileName,
    validation,
    metadata: result.metadata
  };
}
