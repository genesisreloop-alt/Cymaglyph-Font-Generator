/**
 * Core Signal Kernel (C-Kernel) for CYMAGYPH Font Generator
 * Shared DSP kernel ensuring mathematical identity between audio engine and font transpiler
 * 
 * Signal Contract:
 * c(t) = sin((φc(t) + PMeff·E(t) + φmodal)·H) · T(t)
 * csat(t) = tanh(c(t) · magneticSaturation)
 * cam(t) = csat(t) · (1 + amDepth·E(t)) · ρ · (1 + 0.5·ampereTension)
 * cnorm(t) = tanh(cam(t))
 */

export interface SignalKernelParams {
  carrierHz: number;
  payloadHz: number;
  amDepth: number;
  pmDepth: number;
  resonanceQ: number;
  scalar: number;
  bivector: number;
  trivector: number;
  magneticSaturation: number;
  ampereTension: number;
  symmetryOrder: number;
  radialLayers: number;
}

export interface SpatialPoint {
  x: number;
  y: number;
}

/**
 * Temporal carrier wave with phase modulation
 */
export function computeCarrierWave(
  t: number,
  params: SignalKernelParams,
  envelope: number = 1.0,
  modalPhase: number = 0
): number {
  const { carrierHz, payloadHz, pmDepth, resonanceQ } = params;
  
  // Phase accumulation from carrier
  const phiC = 2 * Math.PI * carrierHz * t;
  
  // Phase modulation from payload envelope
  const pmEff = pmDepth * 0.01; // Normalize to 0-1 range
  const phaseModulation = pmEff * envelope * Math.sin(2 * Math.PI * payloadHz * t);
  
  // Harmonic scaling from resonance Q
  const H = 1 + resonanceQ * 0.01;
  
  // Temporal envelope (decay/growth)
  const T = Math.exp(-t * 0.1);
  
  // Full carrier equation
  const carrier = Math.sin((phiC + phaseModulation + modalPhase) * H) * T;
  
  return carrier;
}

/**
 * Magnetic saturation via tanh nonlinearity
 */
export function applyMagneticSaturation(signal: number, saturation: number): number {
  return Math.tanh(signal * saturation);
}

/**
 * Amplitude modulation with tensor corrections
 */
export function applyAmplitudeModulation(
  signal: number,
  params: SignalKernelParams,
  envelope: number = 1.0
): number {
  const { amDepth, scalar, bivector, trivector } = params;
  
  // AM depth normalization
  const amNorm = amDepth * 0.01;
  
  // Density proxy from scalar
  const rho = 0.4 + (scalar / 200) * 1.6;
  
  // Tensor corrections
  const tensorMod = 1 + (bivector * 0.25 + trivector * 0.18 + scalar / 400);
  const ampereCorrection = 1 + 0.5 * params.ampereTension * 0.01;
  
  // Full AM equation
  const modulated = signal * (1 + amNorm * envelope) * rho * ampereCorrection * tensorMod;
  
  return modulated;
}

/**
 * Final normalization stage
 */
export function normalizeSignal(signal: number): number {
  return Math.tanh(signal);
}

/**
 * Complete signal chain: c(t) → csat(t) → cam(t) → cnorm(t)
 */
export function computeFullSignalChain(
  t: number,
  params: SignalKernelParams,
  envelope: number = 1.0,
  modalPhase: number = 0
): number {
  const c = computeCarrierWave(t, params, envelope, modalPhase);
  const csat = applyMagneticSaturation(c, params.magneticSaturation);
  const cam = applyAmplitudeModulation(csat, params, envelope);
  const cnorm = normalizeSignal(cam);
  
  return cnorm;
}

/**
 * Spatial field mapping: converts temporal signal to 2D spatial field ψ(x,y)
 * Maps carrier phase to angular position, envelope to radial propagation
 */
export function computeSpatialField(
  point: SpatialPoint,
  params: SignalKernelParams,
  center: SpatialPoint = { x: 0, y: 0 },
  scale: number = 1.0
): number {
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  
  // Polar coordinates
  const r = Math.sqrt(dx * dx + dy * dy) * scale;
  const theta = Math.atan2(dy, dx);
  
  // Angular phase from symmetry order
  const phiSpatial = theta * params.symmetryOrder;
  
  // Radial envelope from layer count
  const radialEnvelope = Math.sin(r * params.radialLayers * 0.1);
  
  // Temporal parameter substitution (t → r for spatial field)
  const t = r * 0.01;
  
  // Compute signal at this spatial location
  const signal = computeFullSignalChain(t, params, radialEnvelope, phiSpatial);
  
  return signal;
}

/**
 * Bijective field function for font generation
 * Combines spatial field with glyph mask for legibility
 */
export function computeGlyphField(
  point: SpatialPoint,
  params: SignalKernelParams,
  glyphMask: number,
  center: SpatialPoint = { x: 0, y: 0 },
  scale: number = 1.0
): number {
  const field = computeSpatialField(point, params, center, scale);
  
  // Multiply by glyph mask to constrain resonance to letterform
  const maskedField = field * glyphMask;
  
  return maskedField;
}

/**
 * Hash function for deterministic frame generation
 */
export function hashSignalParams(params: SignalKernelParams): string {
  const str = JSON.stringify(params);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}
