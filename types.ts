export interface GlyphPolylinePath {
  closed: boolean;
  points: Array<{ x: number; y: number }>;
}

export interface ParsedGlyph {
  char: string;
  unicode: number;
  advanceWidth: number;
  bounds: { xMin: number; yMin: number; xMax: number; yMax: number };
  paths: GlyphPolylinePath[];
}

export interface GlyphSignature {
  aspectRatio: number;
  strokeCount: number;
  strokeAngles: number[];
  hasVerticalSymmetry: boolean;
  openCurveCount: number;
  junctions: Array<{ x: number; y: number }>;
  endpoints: Array<{ x: number; y: number }>;
  solidity: number;
  strokeWidth: number;
}

export interface SacredGlyphParams {
  symmetryOrder: number;
  radialLayers: number;
  radialRatioFunction: "phi" | "exp" | "log" | "pow2";
  angularDistribution: "uniform" | "golden" | "fol";
  primitiveSet: Array<"circle" | "arc" | "petal">;
  fieldBoundary: "ellipse" | "circle";
  angularWeights: number[];
  sampleDensity: number;
  layerDensityFalloff: number;
  centerDensityBoost: number;
  deformationField: "woven";
  fieldMode: string;
  zRule: string;
  fieldMediumDensity: number;
  gridOverlaySize: number;
  lotusPetals: number;
  carrierWaveCycles: number;
  carrierWaveStrength: number;
  mandalaMix: number;
  lotusMix: number;
  cymaticMix: number;
  strictSacredMapping: boolean;
  noGapFullForm: boolean;
  gapFillRules: "none" | "midpoint";
  depth: number;
  scale: number;
  alpha: number;
  renderSource: string;
  renderMode: string;
  propagationMedium: string;
  sourceMorph: number;
  modeMorph: number;
  mediumMorph: number;
}

export interface ConditionedPoint {
  x: number;
  y: number;
}

export interface GlyphCymaglyphArtifact {
  glyph: ParsedGlyph;
  signature: GlyphSignature;
  params: SacredGlyphParams;
  points: ConditionedPoint[];
  pointHash: string;
}

export interface FontTranspileBuildRequest {
  sourceFontName: string;
  familyName: string;
  styleName: string;
  chars: string[];
  mode: "cymatic" | "mandala" | "bijective";
  alpha: number;
  modulation: {
    carrierHz: number;
    payloadHz: number;
    amDepth: number;
    pmDepth: number;
    resonanceQ: number;
    scalar: number;
    bivector: number;
    trivector: number;
    sampleDensity: number;
    layerDensityFalloff: number;
    centerDensityBoost: number;
    depth: number;
    scale: number;
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
  };
  monochrome: boolean;
}
