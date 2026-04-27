import { stableStringify } from "@/lib/cymaglyphicCause/hash";
import type { ConditionedPoint, ParsedGlyph, SacredGlyphParams } from "@/lib/fontTranspiler/types";

const TAU = Math.PI * 2;
const PHI = 1.618033988749895;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function hash32(text: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1000000) / 1000000;
  };
}

function normalize(vx: number, vy: number): { x: number; y: number } {
  const mag = Math.hypot(vx, vy) || 1;
  return { x: vx / mag, y: vy / mag };
}

function radialRatio(layer: number, layers: number, mode: SacredGlyphParams["radialRatioFunction"]): number {
  const t = clamp(layer / Math.max(1, layers), 0, 1);
  if (mode === "phi") return clamp(Math.pow(t, 1 / PHI), 0, 1);
  if (mode === "exp") return clamp((Math.exp(1.8 * t) - 1) / (Math.exp(1.8) - 1), 0, 1);
  if (mode === "log") return clamp(Math.log(1 + 7 * t) / Math.log(8), 0, 1);
  return t * t;
}

function buildBoundarySamples(glyph: ParsedGlyph): Array<{ x: number; y: number; tx: number; ty: number; nx: number; ny: number; u: number }> {
  const out: Array<{ x: number; y: number; tx: number; ty: number; nx: number; ny: number; u: number }> = [];
  glyph.paths.forEach((path) => {
    if (path.points.length < 2) return;
    for (let i = 1; i < path.points.length; i += 1) {
      const a = path.points[i - 1];
      const b = path.points[i];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const segLen = Math.max(1e-6, Math.hypot(dx, dy));
      const steps = Math.max(2, Math.ceil(segLen / 14));
      for (let s = 0; s < steps; s += 1) {
        const t = s / steps;
        const x = a.x + dx * t;
        const y = a.y + dy * t;
        const tn = normalize(dx, dy);
        // Left-hand normal keeps a stable direction per segment.
        const nn = normalize(-tn.y, tn.x);
        out.push({ x, y, tx: tn.x, ty: tn.y, nx: nn.x, ny: nn.y, u: t });
      }
    }
  });
  return out;
}

export function generateConditionedPointCloud(
  glyph: ParsedGlyph,
  params: SacredGlyphParams,
  iterations: number,
): ConditionedPoint[] {
  const seed = hash32(stableStringify({ unicode: glyph.unicode, params, bounds: glyph.bounds }));
  const rng = makeRng(seed);
  const width = Math.max(1e-4, glyph.bounds.xMax - glyph.bounds.xMin);
  const height = Math.max(1e-4, glyph.bounds.yMax - glyph.bounds.yMin);
  const span = Math.max(width, height);
  const baseSamples = buildBoundarySamples(glyph);
  if (baseSamples.length === 0) return [];

  const sourceAmp = 0.032 * params.sourceMorph;
  const modeAmp = 0.028 * params.modeMorph;
  const mediumAmp = 0.026 * params.mediumMorph;
  const primitiveBias =
    (params.primitiveSet.includes("petal") ? 0.9 : 0.6) +
    (params.primitiveSet.includes("arc") ? 0.22 : 0) +
    (params.primitiveSet.includes("circle") ? 0.18 : 0);
  const jitterAmp = params.strictSacredMapping ? 0.0025 : 0.011;
  const out: ConditionedPoint[] = [];

  const ringCount = Math.max(3, params.radialLayers);
  const target = Math.max(iterations, Math.floor(iterations * (0.68 + params.sampleDensity * 0.38)));
  const stride = Math.max(1, Math.floor(baseSamples.length / Math.max(120, Math.floor(target / ringCount))));

  for (let layer = 1; layer <= ringCount; layer += 1) {
    const layerNorm = radialRatio(layer, ringCount, params.radialRatioFunction);
    const ringRadius = span * (0.011 + layerNorm * (0.022 + params.depth * 0.024));
    for (let i = 0; i < baseSamples.length; i += stride) {
      if (out.length >= target) break;
      const s = baseSamples[i];
      const theta = (i / Math.max(1, baseSamples.length - 1)) * TAU;
      const symmetryWave = Math.sin(theta * Math.max(2, params.symmetryOrder));
      const lotusWave = Math.cos(theta * Math.max(2, params.lotusPetals) + layerNorm * Math.PI * 0.6);
      const carrierWave = Math.sin(theta * Math.max(1, params.carrierWaveCycles) + layerNorm * TAU * 0.4);
      const renderWaveA = Math.sin(theta * (2.8 + params.sourceMorph * 0.8) + layerNorm * TAU);
      const renderWaveB = Math.cos(theta * (3.2 + params.modeMorph * 0.9) - layerNorm * TAU * 0.75);

      const fieldMix =
        params.mandalaMix * symmetryWave * 0.7 +
        params.lotusMix * lotusWave * 0.6 +
        params.cymaticMix * carrierWave * 0.55;
      const renderMix = renderWaveA * sourceAmp + renderWaveB * modeAmp + Math.sin(theta * 5.5) * mediumAmp;
      const morph = ringRadius * (1 + fieldMix * primitiveBias * 0.45 + renderMix);

      const tangentWarp = Math.sin(theta * 2 + layerNorm * TAU * 0.5) * ringRadius * params.carrierWaveStrength * 0.42;
      const n = params.fieldBoundary === "ellipse"
        ? normalize(s.nx * (width / span), s.ny * (height / span))
        : { x: s.nx, y: s.ny };
      const offsetX = n.x * morph + s.tx * tangentWarp;
      const offsetY = n.y * morph + s.ty * tangentWarp;

      // Alternate signed shells so glyph receives inward/outward cymaglyph structure.
      const shellSign = layer % 2 === 0 ? -1 : 1;
      const x = s.x + offsetX * shellSign + (rng() - 0.5) * jitterAmp * span;
      const y = s.y + offsetY * shellSign + (rng() - 0.5) * jitterAmp * span;
      out.push({ x, y });

      // No-gap mode injects midpoint continuation to keep ring continuity.
      if (params.noGapFullForm && out.length < target) {
        const bend = 0.5 + 0.5 * Math.sin(theta * 1.5 + layerNorm * Math.PI);
        out.push({
          x: s.x + offsetX * shellSign * (0.55 + bend * 0.22),
          y: s.y + offsetY * shellSign * (0.55 - bend * 0.12),
        });
      }
    }
    if (out.length >= target) break;
  }

  // Deterministic top-up to exact target size.
  for (let i = 0; out.length < target; i += 1) {
    const s = baseSamples[i % baseSamples.length];
    out.push({
      x: s.x + (rng() - 0.5) * jitterAmp * span,
      y: s.y + (rng() - 0.5) * jitterAmp * span,
    });
  }

  return out;
}
