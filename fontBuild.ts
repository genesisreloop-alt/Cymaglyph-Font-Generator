import * as opentype from "opentype.js";
import { hashObject } from "@/lib/cymaglyphicCause/hash";
import { computeGlyphSignature } from "@/lib/fontTranspiler/glyphSignature";
import { parseGlyph } from "@/lib/fontTranspiler/glyphParser";
import { generateConditionedPointCloud } from "@/lib/fontTranspiler/conditionalIFS";
import { buildCymaglyphGlyphPath, toSvgPathData } from "@/lib/fontTranspiler/vectorizeGlyph";
import { glyphSignatureToSacredParams } from "@/lib/fontTranspiler/signatureToSacredParams";
import type { FontTranspileBuildRequest, GlyphCymaglyphArtifact } from "@/lib/fontTranspiler/types";

export interface FontBuildOutput {
  font: opentype.Font;
  artifacts: GlyphCymaglyphArtifact[];
  hash: string;
  buffer: ArrayBuffer;
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
