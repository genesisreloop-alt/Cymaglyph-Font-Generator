import type opentype from 'opentype.js';

export interface VectorPoint {
  x: number;
  y: number;
}

export interface VectorPath {
  closed: boolean;
  points: VectorPoint[];
  type: 'circle' | 'arc' | 'line' | 'polygon' | 'petal' | 'triangle' | 'custom' | 'stroke';
}

export interface ParsedGlyph {
  unicode: string;
  name: string;
  paths: VectorPath[];
  bounds: { xMin: number; yMin: number; xMax: number; yMax: number };
  advanceWidth: number;
}

export interface SacredGlyphParams {
  symmetryOrder: number;
  radialLayers: number;
  sourceMorph: number;
  modeMorph: number;
  mediumMorph: number;
  depth: number;
  sampleDensity: number;
  mandalaMix: number;
  lotusMix: number;
  cymaticMix: number;
  carrierWaveCycles: number;
  carrierWaveStrength: number;
  lotusPetals: number;
  fieldBoundary: 'circle' | 'ellipse';
  radialRatioFunction: 'linear' | 'phi' | 'exp' | 'log';
  primitiveSet: string[];
  strictSacredMapping: boolean;
  noGapFullForm: boolean;
}

export interface SignalKernelParams {
  t: number;
  sourceMorph: number;
  modeMorph: number;
  mediumMorph: number;
  symmetryOrder: number;
  radialLayers: number;
  depth: number;
  carrierWaveCycles: number;
  carrierWaveStrength: number;
  lotusPetals: number;
  mandalaMix: number;
  lotusMix: number;
  cymaticMix: number;
}

export interface ConditionedPoint {
  x: number;
  y: number;
}

export interface MandalaOptions {
  symmetryOrder: number;
  radialLayers: number;
  innerRadius: number;
  outerRadius: number;
  detailLevel: 'low' | 'medium' | 'high' | 'ultra' | '4k';
  includeSeedOfLife: boolean;
  includeFlowerOfLife: boolean;
  includeTibetanMandala: boolean;
  includeSriYantra: boolean;
  goldenRatioSubdivisions: boolean;
  tibetanLayerCount: number;
  tibetanGateCount: number;
}

export interface MandalaGeometry {
  paths: VectorPath[];
  centerX: number;
  centerY: number;
  boundingBox: { xMin: number; yMin: number; xMax: number; yMax: number };
}

export interface FontExportOptions {
  format: 'ttf' | 'otf';
  familyName: string;
  styleName: string;
  unitsPerEm: number;
  ascender: number;
  descender: number;
  glyphs: ParsedGlyph[];
  metadata: {
    version: string;
    description: string;
    designer: string;
    dspParameters?: Partial<SacredGlyphParams>;
  };
}
