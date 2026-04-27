import * as opentype from "opentype.js";
import type { GlyphPolylinePath, ParsedGlyph } from "@/lib/fontTranspiler/types";

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function quadPoint(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  t: number,
) {
  const mt = 1 - t;
  return {
    x: mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x,
    y: mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y,
  };
}

function cubicPoint(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  t: number,
) {
  const mt = 1 - t;
  return {
    x:
      mt * mt * mt * p0.x +
      3 * mt * mt * t * p1.x +
      3 * mt * t * t * p2.x +
      t * t * t * p3.x,
    y:
      mt * mt * mt * p0.y +
      3 * mt * mt * t * p1.y +
      3 * mt * t * t * p2.y +
      t * t * t * p3.y,
  };
}

function flattenPath(path: opentype.Path, subdivisions = 10): GlyphPolylinePath[] {
  const out: GlyphPolylinePath[] = [];
  let current: GlyphPolylinePath | null = null;
  let cursor = { x: 0, y: 0 };
  let start = { x: 0, y: 0 };
  path.commands.forEach((cmd) => {
    if (cmd.type === "M") {
      if (current && current.points.length > 1) out.push(current);
      current = { closed: false, points: [{ x: cmd.x ?? 0, y: cmd.y ?? 0 }] };
      cursor = { x: cmd.x ?? 0, y: cmd.y ?? 0 };
      start = { ...cursor };
      return;
    }
    if (!current) {
      current = { closed: false, points: [{ x: cursor.x, y: cursor.y }] };
    }
    if (cmd.type === "L") {
      cursor = { x: cmd.x ?? cursor.x, y: cmd.y ?? cursor.y };
      current.points.push({ ...cursor });
      return;
    }
    if (cmd.type === "Q") {
      const p0 = { ...cursor };
      const p1 = { x: cmd.x1 ?? p0.x, y: cmd.y1 ?? p0.y };
      const p2 = { x: cmd.x ?? p0.x, y: cmd.y ?? p0.y };
      for (let i = 1; i <= subdivisions; i += 1) {
        current.points.push(quadPoint(p0, p1, p2, i / subdivisions));
      }
      cursor = p2;
      return;
    }
    if (cmd.type === "C") {
      const p0 = { ...cursor };
      const p1 = { x: cmd.x1 ?? p0.x, y: cmd.y1 ?? p0.y };
      const p2 = { x: cmd.x2 ?? p1.x, y: cmd.y2 ?? p1.y };
      const p3 = { x: cmd.x ?? p0.x, y: cmd.y ?? p0.y };
      for (let i = 1; i <= subdivisions; i += 1) {
        current.points.push(cubicPoint(p0, p1, p2, p3, i / subdivisions));
      }
      cursor = p3;
      return;
    }
    if (cmd.type === "Z") {
      current.closed = true;
      if (current.points.length > 0) {
        const first = current.points[0];
        const last = current.points[current.points.length - 1];
        const dx = first.x - last.x;
        const dy = first.y - last.y;
        if (dx * dx + dy * dy > 1e-4) {
          for (let i = 1; i <= 2; i += 1) {
            const t = i / 2;
            current.points.push({
              x: lerp(last.x, start.x, t),
              y: lerp(last.y, start.y, t),
            });
          }
        }
      }
      out.push(current);
      current = null;
      cursor = { ...start };
    }
  });
  const pending = current as GlyphPolylinePath | null;
  if (pending && pending.points.length > 1) out.push(pending);
  return out;
}

function getGlyphBounds(paths: GlyphPolylinePath[]) {
  let xMin = Number.POSITIVE_INFINITY;
  let yMin = Number.POSITIVE_INFINITY;
  let xMax = Number.NEGATIVE_INFINITY;
  let yMax = Number.NEGATIVE_INFINITY;
  paths.forEach((p) => {
    p.points.forEach((pt) => {
      xMin = Math.min(xMin, pt.x);
      yMin = Math.min(yMin, pt.y);
      xMax = Math.max(xMax, pt.x);
      yMax = Math.max(yMax, pt.y);
    });
  });
  if (!Number.isFinite(xMin)) return { xMin: 0, yMin: 0, xMax: 0, yMax: 0 };
  return { xMin, yMin, xMax, yMax };
}

export async function parseFont(arrayBuffer: ArrayBuffer): Promise<opentype.Font> {
  const font = opentype.parse(arrayBuffer);
  return font;
}

export function parseGlyph(font: opentype.Font, char: string, unitsPerEm = 1000): ParsedGlyph | null {
  const glyph = font.charToGlyph(char);
  if (!glyph || glyph.unicode == null) return null;
  const path = glyph.getPath(0, 0, unitsPerEm);
  // `getPath` returns canvas-oriented Y (down). Font glyph space is Y-up.
  // Normalize to Y-up so exported font outlines are not vertically inverted.
  const paths = flattenPath(path, 10).map((poly) => ({
    ...poly,
    points: poly.points.map((pt) => ({ x: pt.x, y: -pt.y })),
  }));
  const bounds = getGlyphBounds(paths);
  return {
    char,
    unicode: glyph.unicode,
    advanceWidth: glyph.advanceWidth ?? unitsPerEm,
    bounds,
    paths,
  };
}
