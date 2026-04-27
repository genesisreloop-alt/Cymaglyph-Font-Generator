import * as opentype from "opentype.js";
import type { ConditionedPoint, ParsedGlyph, SacredGlyphParams } from "@/lib/fontTranspiler/types";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function sampleDisplacement(
  p: { x: number; y: number },
  cloud: ConditionedPoint[],
  radius: number,
): { x: number; y: number } {
  let wx = 0;
  let wy = 0;
  let w = 0;
  const invR2 = 1 / Math.max(1, radius * radius);
  for (let i = 0; i < cloud.length; i += 13) {
    const q = cloud[i];
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const d2 = dx * dx + dy * dy;
    const ww = Math.exp(-d2 * invR2 * 1.6);
    wx += dx * ww;
    wy += dy * ww;
    w += ww;
  }
  if (w < 1e-6) return { x: 0, y: 0 };
  return { x: wx / w, y: wy / w };
}

function buildNormals(points: Array<{ x: number; y: number }>, closed: boolean): Array<{ x: number; y: number }> {
  if (points.length < 2) return points.map(() => ({ x: 0, y: 1 }));
  const out: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < points.length; i += 1) {
    const prev = points[(i - 1 + points.length) % points.length];
    const next = points[(i + 1) % points.length];
    const a = closed ? prev : (i === 0 ? points[i] : prev);
    const b = closed ? next : (i === points.length - 1 ? points[i] : next);
    const tx = b.x - a.x;
    const ty = b.y - a.y;
    const mag = Math.hypot(tx, ty) || 1;
    out.push({ x: -ty / mag, y: tx / mag });
  }
  return out;
}

function emitSmoothPath(path: opentype.Path, points: Array<{ x: number; y: number }>, closed: boolean) {
  if (points.length < 2) return;
  path.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const cx = (a.x + b.x) * 0.5;
    const cy = (a.y + b.y) * 0.5;
    path.quadTo(cx, cy, b.x, b.y);
  }
  if (closed) path.close();
}

export function buildCymaglyphGlyphPath(
  glyph: ParsedGlyph,
  points: ConditionedPoint[],
  params: SacredGlyphParams,
): opentype.Path {
  const width = Math.max(1, glyph.bounds.xMax - glyph.bounds.xMin);
  const height = Math.max(1, glyph.bounds.yMax - glyph.bounds.yMin);
  const radius = Math.max(width, height) * (0.14 + params.fieldMediumDensity * 0.2);
  const amp = (0.02 + params.depth * 0.05 + params.cymaticMix * 0.05) * Math.max(width, height);

  const path = new opentype.Path();
  glyph.paths.forEach((poly) => {
    if (poly.points.length < 2) return;
    const transformed = poly.points.map((p, i) => {
      const d = sampleDisplacement(p, points, radius);
      const phase = (i / Math.max(1, poly.points.length - 1)) * Math.PI * 2;
      const ring = Math.sin(phase * (1 + params.symmetryOrder * 0.25));
      const carrierWave = Math.sin(phase * Math.max(1, params.carrierWaveCycles)) * params.carrierWaveStrength;
      const mixGain = params.alpha * (0.45 + params.mandalaMix * 0.35 + params.lotusMix * 0.2);
      const gain = mixGain * (params.fieldMode === "traveling" ? 0.92 : 1);
      return {
        x: p.x + (d.x * gain + ring * 0.06 * amp + carrierWave * 0.08 * amp),
        y: p.y + (d.y * gain + ring * 0.04 * amp - carrierWave * 0.05 * amp),
      };
    });

    if (params.noGapFullForm && transformed.length > 2) {
      const end = transformed[transformed.length - 1];
      const first = transformed[0];
      const dx = first.x - end.x;
      const dy = first.y - end.y;
      if (Math.hypot(dx, dy) > Math.max(width, height) * 0.01) {
        transformed.push({
          x: end.x + dx * 0.5,
          y: end.y + dy * 0.5,
        });
      }
    }

    emitSmoothPath(path, transformed, poly.closed);

    const normals = buildNormals(transformed, poly.closed);
    const shellCount = clamp(Math.round(params.radialLayers * 0.4), 1, 4);
    const shellAmpBase = Math.max(width, height) * (0.005 + params.cymaticMix * 0.018 + params.sourceMorph * 0.008);
    for (let shell = 1; shell <= shellCount; shell += 1) {
      const shellScale = shellAmpBase * shell * (0.68 + params.modeMorph * 0.22);
      const shellPoints = transformed.map((p, i) => {
        const n = normals[i];
        const phase = (i / Math.max(1, transformed.length - 1)) * Math.PI * 2;
        const pulse =
          0.75 +
          0.25 * Math.sin(phase * Math.max(2, params.symmetryOrder) + shell * 0.65) +
          Math.sin(phase * Math.max(1, params.carrierWaveCycles) - shell * 0.42) * params.carrierWaveStrength * 0.2;
        const sign = shell % 2 === 0 ? -1 : 1;
        return {
          x: p.x + n.x * shellScale * pulse * sign,
          y: p.y + n.y * shellScale * pulse * sign,
        };
      });
      emitSmoothPath(path, shellPoints, poly.closed);
    }
  });
  return path;
}

export function toSvgPathData(path: opentype.Path): string {
  return path.toPathData(2);
}

export function buildPreviewScalar(points: ConditionedPoint[], w: number, h: number, bounds: ParsedGlyph["bounds"]): Float32Array {
  const out = new Float32Array(w * h);
  const invW = 1 / Math.max(1, w - 1);
  const invH = 1 / Math.max(1, h - 1);
  const sx = bounds.xMax - bounds.xMin;
  const sy = bounds.yMax - bounds.yMin;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const px = bounds.xMin + x * invW * sx;
      const py = bounds.yMin + (1 - y * invH) * sy;
      let v = 0;
      for (let i = 0; i < points.length; i += 16) {
        const q = points[i];
        const d2 = (q.x - px) ** 2 + (q.y - py) ** 2;
        v += Math.exp(-d2 / (Math.max(sx, sy) * 0.03 + 1));
      }
      out[y * w + x] = clamp(v * 0.35, 0, 1);
    }
  }
  return out;
}
