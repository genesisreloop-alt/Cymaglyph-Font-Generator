/**
 * Core Signal Kernel for CYMAGYPH Font Generation
 * Implements the DSP equations from the Signal Contract
 * Provides bijective mapping from temporal signal to spatial field
 */

import type { SignalKernelParams } from './types';

const TAU = Math.PI * 2;
const PHI = 1.618033988749895;

/**
 * Primary carrier wave c(t) - base oscillation
 */
export function carrierWave(t: number, params: SignalKernelParams): number {
  const { sourceMorph, modeMorph, mediumMorph, carrierWaveCycles } = params;
  
  const sourceComponent = Math.sin(TAU * carrierWaveCycles * t + sourceMorph * TAU * 0.25);
  const modeComponent = Math.cos(TAU * carrierWaveCycles * t * 1.5 + modeMorph * TAU * 0.3);
  const mediumComponent = Math.sin(TAU * carrierWaveCycles * t * 0.75 + mediumMorph * TAU * 0.15);
  
  return (sourceComponent * 0.5 + modeComponent * 0.3 + mediumComponent * 0.2);
}

/**
 * Saturation envelope csat(t) - amplitude modulation
 */
export function saturationEnvelope(t: number, params: SignalKernelParams): number {
  const { depth, symmetryOrder } = params;
  
  const baseEnv = Math.sin(TAU * t);
  const harmonicMod = Math.sin(TAU * symmetryOrder * t * 0.5);
  const depthMod = 1.0 + depth * 0.3;
  
  return (0.5 + 0.5 * baseEnv * harmonicMod) * depthMod;
}

/**
 * Angular modulation cam(t) - phase distortion
 */
export function angularModulation(t: number, params: SignalKernelParams): number {
  const { lotusPetals, mandalaMix, lotusMix } = params;
  
  const lotusWave = Math.cos(TAU * lotusPetals * t + mandalaMix * TAU * 0.2);
  const mandalaWave = Math.sin(TAU * (lotusPetals * 0.5) * t + lotusMix * TAU * 0.15);
  
  return (lotusWave * 0.6 + mandalaWave * 0.4) * 0.15;
}

/**
 * Normalized output cnorm(t) - final signal normalization
 */
export function normalizedOutput(t: number, params: SignalKernelParams): number {
  const carrier = carrierWave(t, params);
  const saturation = saturationEnvelope(t, params);
  const angular = angularModulation(t, params);
  
  const modulated = carrier * saturation;
  const distorted = modulated + angular * modulated;
  
  // Normalize to [-1, 1]
  const maxAmplitude = 1.5;
  return Math.max(-1, Math.min(1, distorted / maxAmplitude));
}

/**
 * Sample the signal across time domain
 */
export function sampleSignal(
  params: SignalKernelParams,
  sampleCount: number = 1024
): Float32Array {
  const samples = new Float32Array(sampleCount);
  
  for (let i = 0; i < sampleCount; i++) {
    const t = i / sampleCount;
    samples[i] = normalizedOutput(t, params);
  }
  
  return samples;
}

/**
 * Compute frequency spectrum via DFT (for harmonic analysis)
 */
export function computeSpectrum(samples: Float32Array, maxHarmonics: number = 32): Float32Array {
  const N = samples.length;
  const spectrum = new Float32Array(maxHarmonics);
  
  for (let k = 0; k < maxHarmonics; k++) {
    let real = 0;
    let imag = 0;
    
    for (let n = 0; n < N; n++) {
      const angle = (TAU * k * n) / N;
      real += samples[n] * Math.cos(angle);
      imag -= samples[n] * Math.sin(angle);
    }
    
    spectrum[k] = Math.sqrt(real * real + imag * imag) / N;
  }
  
  return spectrum;
}

/**
 * Generate kernel parameters with harmonic ratios
 */
export function createHarmonicParams(baseParams: Partial<SignalKernelParams>): SignalKernelParams {
  return {
    t: 0,
    sourceMorph: baseParams.sourceMorph ?? 0.5,
    modeMorph: baseParams.modeMorph ?? 0.5,
    mediumMorph: baseParams.mediumMorph ?? 0.5,
    symmetryOrder: baseParams.symmetryOrder ?? 12,
    radialLayers: baseParams.radialLayers ?? 7,
    depth: baseParams.depth ?? 0.5,
    carrierWaveCycles: baseParams.carrierWaveCycles ?? 3,
    carrierWaveStrength: baseParams.carrierWaveStrength ?? 0.5,
    lotusPetals: baseParams.lotusPetals ?? 8,
    mandalaMix: baseParams.mandalaMix ?? 0.5,
    lotusMix: baseParams.lotusMix ?? 0.5,
    cymaticMix: baseParams.cymaticMix ?? 0.5,
  };
}
