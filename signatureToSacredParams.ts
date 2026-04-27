import type { GlyphSignature, SacredGlyphParams } from "@/lib/fontTranspiler/types";

function normalizeAngle(a: number): number {
  const twoPi = Math.PI * 2;
  let x = a;
  while (x < 0) x += twoPi;
  while (x >= twoPi) x -= twoPi;
  return x;
}

function buildAngularWeights(strokeAngles: number[], distribution: "uniform" | "golden" | "fol"): number[] {
  const bins = new Array<number>(12).fill(0.2);
  if (distribution === "uniform") {
    return bins.map(() => 1 / bins.length);
  }
  if (distribution === "golden") {
    const golden = (1 + Math.sqrt(5)) / 2;
    for (let i = 0; i < bins.length; i += 1) {
      const t = (i / bins.length) * Math.PI * 2;
      bins[i] = 0.4 + 0.8 * Math.abs(Math.sin(t * golden));
    }
  }
  if (distribution === "fol") {
    const folAngles = [0, Math.PI / 3, (2 * Math.PI) / 3, Math.PI, (4 * Math.PI) / 3, (5 * Math.PI) / 3];
    for (const a of folAngles) {
      const idx = Math.floor((normalizeAngle(a) / (2 * Math.PI)) * bins.length) % bins.length;
      bins[idx] += 1.2;
    }
  }
  strokeAngles.forEach((angle) => {
    const idx = Math.floor((normalizeAngle(angle) / (2 * Math.PI)) * bins.length) % bins.length;
    bins[idx] += 1.3;
  });
  const total = bins.reduce((a, b) => a + b, 0) || 1;
  return bins.map((x) => x / total);
}

export function glyphSignatureToSacredParams(
  sig: GlyphSignature,
  mode: "cymatic" | "mandala" | "bijective",
  modulation?: {
    carrierHz?: number;
    payloadHz?: number;
    amDepth?: number;
    pmDepth?: number;
    resonanceQ?: number;
    scalar?: number;
    bivector?: number;
    trivector?: number;
    sampleDensity?: number;
    layerDensityFalloff?: number;
    centerDensityBoost?: number;
    depth?: number;
    scale?: number;
    symmetryOrder?: number;
    radialLayers?: number;
    radialRatioFunction?: string;
    angularDistribution?: string;
    primitiveSet?: Array<"circle" | "arc" | "petal">;
    gapFillRules?: "none" | "midpoint";
    deformationField?: "woven";
    fieldMode?: string;
    zRule?: string;
    fieldBoundary?: "ellipse" | "circle";
    fieldMediumDensity?: number;
    gridOverlaySize?: number;
    lotusPetals?: number;
    carrierWaveCycles?: number;
    carrierWaveStrength?: number;
    mandalaMix?: number;
    lotusMix?: number;
    cymaticMix?: number;
    strictSacredMapping?: boolean;
    noGapFullForm?: boolean;
    renderSource?: string;
    renderMode?: string;
    propagationMedium?: string;
  },
): SacredGlyphParams {
  const symmetryOrder = Math.max(
    2,
    Math.min(
      18,
      Math.round(
        modulation?.symmetryOrder ??
          (sig.hasVerticalSymmetry ? sig.strokeCount * 2 : sig.strokeCount + 1),
      ),
    ),
  );
  const radialLayers = Math.max(
    3,
    Math.min(18, Math.round(modulation?.radialLayers ?? (3 + Math.round((1 - sig.solidity) * 10)))),
  );
  const primitiveSet: Array<"circle" | "arc" | "petal"> = modulation?.primitiveSet?.length
    ? [...modulation.primitiveSet]
    : ["circle", "arc"];
  if (sig.openCurveCount > 0 || sig.endpoints.length > 0) primitiveSet.push("petal");

  const modeScale = mode === "mandala" ? 1.1 : mode === "bijective" ? 1.0 : 0.92;
  const alphaBase = mode === "bijective" ? 0.46 : mode === "mandala" ? 0.36 : 0.30;

  const carrierHz = Math.max(20, modulation?.carrierHz ?? 16000);
  const payloadHz = Math.max(20, modulation?.payloadHz ?? 220);
  const amDepth = Math.max(0, Math.min(100, modulation?.amDepth ?? 18));
  const pmDepth = Math.max(0, Math.min(100, modulation?.pmDepth ?? 14));
  const resonanceQ = Math.max(0.1, Math.min(120, modulation?.resonanceQ ?? 12));
  const scalar = Math.max(0, Math.min(200, modulation?.scalar ?? 50));
  const bivector = Math.max(0, Math.min(2, modulation?.bivector ?? 0.5));
  const trivector = Math.max(0, Math.min(2, modulation?.trivector ?? 0.62));

  const signalMod = 1 + (payloadHz / carrierHz) * 0.45;
  const tensorMod = 1 + (bivector * 0.25 + trivector * 0.18 + scalar / 400);
  const resonanceMod = 1 + Math.min(0.35, resonanceQ / 200);
  const angularDistribution =
    modulation?.angularDistribution === "uniform" || modulation?.angularDistribution === "golden" || modulation?.angularDistribution === "fol"
      ? modulation.angularDistribution
      : "fol";
  const radialRatioFunction =
    modulation?.radialRatioFunction === "phi" || modulation?.radialRatioFunction === "exp" || modulation?.radialRatioFunction === "log" || modulation?.radialRatioFunction === "pow2"
      ? modulation.radialRatioFunction
      : "exp";
  const renderSource = modulation?.renderSource ?? "DSP_ESTIMATE";
  const renderMode = modulation?.renderMode ?? "POINT_CLOUD";
  const propagationMedium = modulation?.propagationMedium ?? "air";
  const sourceMorph =
    renderSource === "DSP_ESTIMATE"
      ? 1
      : renderSource.startsWith("AIR_")
        ? 1.15
        : renderSource.startsWith("BIOPLASMA_")
          ? 1.3
          : 1.1;
  const modeMorph =
    renderMode === "POINT_CLOUD"
      ? 1
      : renderMode === "RHOTORSE_FLUID"
        ? 1.22
        : renderMode.includes("SDF")
          ? 1.12
          : 1.08;
  const mediumMorph =
    propagationMedium === "air"
      ? 1
      : propagationMedium === "bioplasma"
        ? 1.2
        : propagationMedium === "ionized_plasma"
          ? 1.28
          : 1.1;

  return {
    symmetryOrder,
    radialLayers,
    radialRatioFunction,
    angularDistribution,
    primitiveSet,
    fieldBoundary: modulation?.fieldBoundary ?? (Math.abs(sig.aspectRatio - 1) > 0.08 ? "ellipse" : "circle"),
    angularWeights: buildAngularWeights(sig.strokeAngles, angularDistribution),
    sampleDensity: Math.max(
      0.8,
      Math.min(6.0, (modulation?.sampleDensity ?? 1 / Math.max(0.05, sig.strokeWidth)) * signalMod),
    ),
    layerDensityFalloff: Math.max(
      1.0,
      Math.min(3.2, (modulation?.layerDensityFalloff ?? (1.15 + (1 - sig.solidity) * 0.7)) * (1 + pmDepth / 300)),
    ),
    centerDensityBoost: Math.max(
      1.0,
      Math.min(4.0, (modulation?.centerDensityBoost ?? (1.3 + sig.solidity * 0.7)) * tensorMod),
    ),
    deformationField: modulation?.deformationField ?? "woven",
    fieldMode: modulation?.fieldMode ?? "standing",
    zRule: modulation?.zRule ?? "field",
    fieldMediumDensity: Math.max(0.05, Math.min(1.5, modulation?.fieldMediumDensity ?? 0.35)),
    gridOverlaySize: Math.max(1, Math.min(32, modulation?.gridOverlaySize ?? 5)),
    lotusPetals: Math.max(2, Math.min(24, modulation?.lotusPetals ?? 5)),
    carrierWaveCycles: Math.max(1, Math.min(24, modulation?.carrierWaveCycles ?? 6)),
    carrierWaveStrength: Math.max(0, Math.min(1.5, modulation?.carrierWaveStrength ?? 0.29)),
    mandalaMix: Math.max(0, Math.min(1, modulation?.mandalaMix ?? 0.54)),
    lotusMix: Math.max(0, Math.min(1, modulation?.lotusMix ?? 0.48)),
    cymaticMix: Math.max(0, Math.min(1, modulation?.cymaticMix ?? 0.6)),
    strictSacredMapping: modulation?.strictSacredMapping ?? true,
    noGapFullForm: modulation?.noGapFullForm ?? true,
    gapFillRules: modulation?.gapFillRules ?? (sig.openCurveCount > 0 ? "midpoint" : "none"),
    depth: Math.max(
      0.2,
      Math.min(2.2, (modulation?.depth ?? (0.5 + sig.solidity * 0.4) * modeScale) * resonanceMod * sourceMorph * 0.9),
    ),
    scale: Math.max(1.2, Math.min(6, (modulation?.scale ?? 3) * modeMorph * 0.92)),
    alpha: Math.max(0.16, Math.min(0.8, alphaBase * (1 + amDepth / 250))),
    renderSource,
    renderMode,
    propagationMedium,
    sourceMorph,
    modeMorph,
    mediumMorph,
  };
}
