import type { GlyphSignature, ParsedGlyph } from "@/lib/fontTranspiler/types";

const EPS = 1e-6;

function segmentAngle(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.atan2(b.y - a.y, b.x - a.x);
}

function polyArea(points: Array<{ x: number; y: number }>): number {
  if (points.length < 3) return 0;
  let acc = 0;
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    acc += p.x * q.y - q.x * p.y;
  }
  return Math.abs(acc) * 0.5;
}

function pointKey(x: number, y: number): string {
  return `${x.toFixed(2)}:${y.toFixed(2)}`;
}

export function computeGlyphSignature(glyph: ParsedGlyph): GlyphSignature {
  const width = Math.max(EPS, glyph.bounds.xMax - glyph.bounds.xMin);
  const height = Math.max(EPS, glyph.bounds.yMax - glyph.bounds.yMin);
  const aspectRatio = width / height;
  const strokeCount = glyph.paths.length;
  const openCurveCount = glyph.paths.filter((p) => !p.closed).length;

  const angles: number[] = [];
  const segmentLengths: number[] = [];
  const endpointMap = new Map<string, { x: number; y: number; count: number }>();
  const areaSum = glyph.paths.reduce((acc, p) => acc + (p.closed ? polyArea(p.points) : 0), 0);

  glyph.paths.forEach((path) => {
    if (path.points.length > 1) {
      const first = path.points[0];
      const last = path.points[path.points.length - 1];
      [first, last].forEach((p) => {
        const key = pointKey(p.x, p.y);
        const existing = endpointMap.get(key);
        if (existing) existing.count += 1;
        else endpointMap.set(key, { x: p.x, y: p.y, count: 1 });
      });
    }
    for (let i = 1; i < path.points.length; i += 1) {
      const a = path.points[i - 1];
      const b = path.points[i];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len < EPS) continue;
      segmentLengths.push(len);
      angles.push(segmentAngle(a, b));
    }
  });

  const endpoints = [...endpointMap.values()].filter((p) => p.count === 1).map((p) => ({ x: p.x, y: p.y }));
  const junctions = [...endpointMap.values()].filter((p) => p.count >= 3).map((p) => ({ x: p.x, y: p.y }));
  const bboxArea = Math.max(EPS, width * height);
  const solidity = Math.max(0, Math.min(1, areaSum / bboxArea));

  const avgLen = segmentLengths.length > 0 ? segmentLengths.reduce((a, b) => a + b, 0) / segmentLengths.length : 1;
  const strokeWidth = Math.max(0.02, Math.min(0.4, avgLen / Math.max(width, height)));

  const centerX = (glyph.bounds.xMin + glyph.bounds.xMax) * 0.5;
  let symmetryScore = 0;
  let symmetryN = 0;
  glyph.paths.forEach((path) => {
    path.points.forEach((p) => {
      const mirrorX = 2 * centerX - p.x;
      const nearest = path.points.reduce((best, q) => {
        const d = Math.hypot(q.x - mirrorX, q.y - p.y);
        return d < best ? d : best;
      }, Number.POSITIVE_INFINITY);
      symmetryScore += nearest / width;
      symmetryN += 1;
    });
  });
  const hasVerticalSymmetry = symmetryN > 0 ? symmetryScore / symmetryN < 0.08 : false;

  const buckets = new Array<number>(8).fill(0);
  angles.forEach((a) => {
    const normalized = (a + Math.PI) / (2 * Math.PI);
    const idx = Math.max(0, Math.min(7, Math.floor(normalized * 8)));
    buckets[idx] += 1;
  });
  const strokeAngles = buckets
    .map((count, i) => ({ count, angle: ((i + 0.5) / 8) * 2 * Math.PI - Math.PI }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 4)
    .map((x) => x.angle);

  return {
    aspectRatio,
    strokeCount,
    strokeAngles,
    hasVerticalSymmetry,
    openCurveCount,
    junctions,
    endpoints,
    solidity,
    strokeWidth,
  };
}

