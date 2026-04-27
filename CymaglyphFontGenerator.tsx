/**
 * CYMAGYPH Font Generator UI Component
 * Complete interface for stroke-based font generation with TTF/OTF export
 */

"use client";

import React, { useState, useMemo, useRef, useEffect } from 'react';
import * as opentype from 'opentype.js';
import { buildGlyphPathFromDSP } from './densityContourEngine';
import { generateMandala4K, mandalaToOpenTypeCommands } from './mandalaGeometry4K';
import { exportFont, downloadFont, validateFontForInstallation, type FontExportOptions, type GlyphDefinition } from './fontExporter';
import type { SignalKernelParams } from './coreSignalKernel';

interface FontGeneratorState {
  // Font metadata
  familyName: string;
  styleName: string;
  
  // Character set
  characters: string;
  
  // DSP parameters
  carrierHz: number;
  payloadHz: number;
  amDepth: number;
  pmDepth: number;
  resonanceQ: number;
  scalar: number;
  bivector: number;
  trivector: number;
  
  // Geometry parameters
  symmetryOrder: number;
  radialLayers: number;
  magneticSaturation: number;
  ampereTension: number;
  
  // Mandala options
  includeSeedOfLife: boolean;
  includeFlowerOfLife: boolean;
  includeMetatronsCube: boolean;
  includeSriYantra: boolean;
  
  // Export settings
  exportFormat: 'ttf' | 'otf';
  unitsPerEm: number;
  
  // Preview
  previewChar: string;
  zoom: number;
}

const DEFAULT_STATE: FontGeneratorState = {
  familyName: 'CYMAGYPH',
  styleName: 'Regular',
  characters: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
  
  carrierHz: 16000,
  payloadHz: 220,
  amDepth: 18,
  pmDepth: 14,
  resonanceQ: 12,
  scalar: 50,
  bivector: 0.5,
  trivector: 0.62,
  
  symmetryOrder: 12,
  radialLayers: 7,
  magneticSaturation: 1.5,
  ampereTension: 0.8,
  
  includeSeedOfLife: true,
  includeFlowerOfLife: false,
  includeMetatronsCube: false,
  includeSriYantra: false,
  
  exportFormat: 'ttf',
  unitsPerEm: 1000,
  
  previewChar: 'A',
  zoom: 1.0
};

export function CymaglyphFontGenerator() {
  const [state, setState] = useState<FontGeneratorState>(DEFAULT_STATE);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedGlyphs, setGeneratedGlyphs] = useState<GlyphDefinition[]>([]);
  const [previewPath, setPreviewPath] = useState<string>('');
  const [validationResults, setValidationResults] = useState<{ valid: boolean; errors: string[]; warnings: string[] } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // Build signal params from state
  const signalParams: SignalKernelParams = useMemo(() => ({
    carrierHz: state.carrierHz,
    payloadHz: state.payloadHz,
    amDepth: state.amDepth,
    pmDepth: state.pmDepth,
    resonanceQ: state.resonanceQ,
    scalar: state.scalar,
    bivector: state.bivector,
    trivector: state.trivector,
    symmetryOrder: state.symmetryOrder,
    radialLayers: state.radialLayers,
    magneticSaturation: state.magneticSaturation,
    ampereTension: state.ampereTension
  }), [state]);
  
  // Generate preview glyph
  useEffect(() => {
    const charCode = state.previewChar.charCodeAt(0);
    const bounds = { xMin: 50, yMin: 100, xMax: 550, yMax: 900 };
    
    try {
      const path = buildGlyphPathFromDSP(signalParams, bounds, state.unitsPerEm * 0.6);
      setPreviewPath(path.toPathData(2));
      
      // Draw on canvas
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          
          // Draw background
          ctx.fillStyle = '#0a0e1a';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          
          // Draw grid
          ctx.strokeStyle = 'rgba(100, 150, 255, 0.1)';
          ctx.lineWidth = 1;
          for (let i = 0; i <= 10; i++) {
            const x = (i / 10) * canvas.width;
            const y = (i / 10) * canvas.height;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, canvas.height);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(canvas.width, y);
            ctx.stroke();
          }
          
          // Draw glyph path
          const svgPath = new Path2D(path.toPathData(2));
          ctx.fillStyle = '#4ade80';
          ctx.fill(svgPath);
          ctx.strokeStyle = '#22c55e';
          ctx.lineWidth = 2;
          ctx.stroke(svgPath);
        }
      }
    } catch (error) {
      console.error('Error generating preview:', error);
    }
  }, [signalParams, state.previewChar, state.unitsPerEm]);
  
  // Generate full font
  const handleGenerateFont = async () => {
    setIsGenerating(true);
    
    try {
      const glyphs: GlyphDefinition[] = [];
      
      for (const char of state.characters) {
        const charCode = char.charCodeAt(0);
        const bounds = { xMin: 50, yMin: 100, xMax: 550, yMax: 900 };
        
        const path = buildGlyphPathFromDSP(signalParams, bounds, state.unitsPerEm * 0.6);
        
        glyphs.push({
          unicode: charCode,
          name: `uni${charCode.toString(16).toUpperCase().padStart(4, '0')}`,
          advanceWidth: state.unitsPerEm * 0.6,
          path
        });
      }
      
      setGeneratedGlyphs(glyphs);
      
      // Validate
      const testFont = new opentype.Font({
        familyName: state.familyName,
        styleName: state.styleName,
        unitsPerEm: state.unitsPerEm,
        glyphs: glyphs.map(g => new opentype.Glyph(g))
      });
      
      const validation = validateFontForInstallation(testFont);
      setValidationResults(validation);
      
    } catch (error) {
      console.error('Error generating font:', error);
    } finally {
      setIsGenerating(false);
    }
  };
  
  // Export font
  const handleExport = () => {
    if (generatedGlyphs.length === 0) {
      alert('Please generate the font first');
      return;
    }
    
    const exportOptions: FontExportOptions = {
      familyName: state.familyName,
      styleName: state.styleName,
      version: '1.0.0',
      description: 'CYMAGYPH - DSP-generated sacred geometry font',
      copyright: '© 2024 CYMAGYPH Project',
      manufacturer: 'CYMAGYPH Generator',
      designer: 'DSP Engine',
      license: 'MIT',
      embedSignalParams: true
    };
    
    const result = exportFont(generatedGlyphs, exportOptions, state.exportFormat, signalParams);
    downloadFont(result);
  };
  
  // Update state helper
  const updateState = <K extends keyof FontGeneratorState>(key: K, value: FontGeneratorState[K]) => {
    setState(prev => ({ ...prev, [key]: value }));
  };
  
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      background: '#050810',
      color: '#e0e0e0',
      fontFamily: 'system-ui, sans-serif'
    }}>
      {/* Header */}
      <header style={{
        padding: '16px 24px',
        borderBottom: '1px solid rgba(100, 150, 255, 0.2)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <h1 style={{ margin: 0, fontSize: '24px', color: '#4ade80' }}>
          CYMAGYPH Font Generator
        </h1>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            onClick={handleGenerateFont}
            disabled={isGenerating}
            style={{
              padding: '10px 20px',
              background: isGenerating ? '#374151' : '#22c55e',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: isGenerating ? 'not-allowed' : 'pointer',
              fontWeight: 'bold'
            }}
          >
            {isGenerating ? 'Generating...' : 'Generate Font'}
          </button>
          <button
            onClick={handleExport}
            disabled={generatedGlyphs.length === 0}
            style={{
              padding: '10px 20px',
              background: generatedGlyphs.length === 0 ? '#374151' : '#3b82f6',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: generatedGlyphs.length === 0 ? 'not-allowed' : 'pointer',
              fontWeight: 'bold'
            }}
          >
            Export as {state.exportFormat.toUpperCase()}
          </button>
        </div>
      </header>
      
      {/* Main Content */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Left Panel - Controls */}
        <aside style={{
          width: '380px',
          padding: '16px',
          overflowY: 'auto',
          borderRight: '1px solid rgba(100, 150, 255, 0.2)'
        }}>
          {/* Font Metadata */}
          <section style={{ marginBottom: '24px' }}>
            <h3 style={{ color: '#60a5fa', marginBottom: '12px' }}>Font Metadata</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <input
                type="text"
                value={state.familyName}
                onChange={(e) => updateState('familyName', e.target.value)}
                placeholder="Family Name"
                style={inputStyle}
              />
              <input
                type="text"
                value={state.styleName}
                onChange={(e) => updateState('styleName', e.target.value)}
                placeholder="Style Name"
                style={inputStyle}
              />
            </div>
          </section>
          
          {/* DSP Parameters */}
          <section style={{ marginBottom: '24px' }}>
            <h3 style={{ color: '#60a5fa', marginBottom: '12px' }}>DSP Parameters</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <ParameterSlider
                label="Carrier Hz"
                value={state.carrierHz}
                min={1000}
                max={24000}
                step={100}
                onChange={(v) => updateState('carrierHz', v)}
              />
              <ParameterSlider
                label="Payload Hz"
                value={state.payloadHz}
                min={20}
                max={2000}
                step={10}
                onChange={(v) => updateState('payloadHz', v)}
              />
              <ParameterSlider
                label="AM Depth"
                value={state.amDepth}
                min={0}
                max={100}
                step={1}
                onChange={(v) => updateState('amDepth', v)}
              />
              <ParameterSlider
                label="PM Depth"
                value={state.pmDepth}
                min={0}
                max={100}
                step={1}
                onChange={(v) => updateState('pmDepth', v)}
              />
              <ParameterSlider
                label="Resonance Q"
                value={state.resonanceQ}
                min={0.1}
                max={120}
                step={0.1}
                onChange={(v) => updateState('resonanceQ', v)}
              />
            </div>
          </section>
          
          {/* Geometry Parameters */}
          <section style={{ marginBottom: '24px' }}>
            <h3 style={{ color: '#60a5fa', marginBottom: '12px' }}>Sacred Geometry</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <ParameterSlider
                label="Symmetry Order"
                value={state.symmetryOrder}
                min={2}
                max={24}
                step={1}
                onChange={(v) => updateState('symmetryOrder', v)}
              />
              <ParameterSlider
                label="Radial Layers"
                value={state.radialLayers}
                min={1}
                max={18}
                step={1}
                onChange={(v) => updateState('radialLayers', v)}
              />
              
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px' }}>
                <input
                  type="checkbox"
                  checked={state.includeSeedOfLife}
                  onChange={(e) => updateState('includeSeedOfLife', e.target.checked)}
                />
                Seed of Life
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input
                  type="checkbox"
                  checked={state.includeFlowerOfLife}
                  onChange={(e) => updateState('includeFlowerOfLife', e.target.checked)}
                />
                Flower of Life
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input
                  type="checkbox"
                  checked={state.includeMetatronsCube}
                  onChange={(e) => updateState('includeMetatronsCube', e.target.checked)}
                />
                Metatron's Cube
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input
                  type="checkbox"
                  checked={state.includeSriYantra}
                  onChange={(e) => updateState('includeSriYantra', e.target.checked)}
                />
                Sri Yantra
              </label>
            </div>
          </section>
          
          {/* Export Settings */}
          <section style={{ marginBottom: '24px' }}>
            <h3 style={{ color: '#60a5fa', marginBottom: '12px' }}>Export Settings</h3>
            <div style={{ display: 'flex', gap: '12px', marginBottom: '12px' }}>
              <button
                onClick={() => updateState('exportFormat', 'ttf')}
                style={{
                  flex: 1,
                  padding: '8px',
                  background: state.exportFormat === 'ttf' ? '#22c55e' : '#374151',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                TTF
              </button>
              <button
                onClick={() => updateState('exportFormat', 'otf')}
                style={{
                  flex: 1,
                  padding: '8px',
                  background: state.exportFormat === 'otf' ? '#22c55e' : '#374151',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                OTF
              </button>
            </div>
          </section>
          
          {/* Validation Results */}
          {validationResults && (
            <section style={{
              padding: '12px',
              background: validationResults.valid ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
              borderRadius: '6px',
              border: `1px solid ${validationResults.valid ? '#22c55e' : '#ef4444'}`
            }}>
              <h4 style={{
                margin: '0 0 8px 0',
                color: validationResults.valid ? '#22c55e' : '#ef4444'
              }}>
                {validationResults.valid ? '✓ Valid for Installation' : '✗ Validation Errors'}
              </h4>
              {validationResults.errors.length > 0 && (
                <ul style={{ margin: '0 0 8px 0', paddingLeft: '20px', fontSize: '13px' }}>
                  {validationResults.errors.map((err, i) => (
                    <li key={i} style={{ color: '#ef4444' }}>{err}</li>
                  ))}
                </ul>
              )}
              {validationResults.warnings.length > 0 && (
                <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '13px' }}>
                  {validationResults.warnings.map((warn, i) => (
                    <li key={i} style={{ color: '#fbbf24' }}>{warn}</li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </aside>
        
        {/* Center - Preview */}
        <main style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          padding: '16px'
        }}>
          {/* Preview Canvas */}
          <div style={{
            flex: 1,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            background: 'rgba(10, 14, 26, 0.5)',
            borderRadius: '8px',
            marginBottom: '16px'
          }}>
            <canvas
              ref={canvasRef}
              width={600}
              height={600}
              style={{
                maxWidth: '100%',
                maxHeight: '100%',
                objectFit: 'contain'
              }}
            />
          </div>
          
          {/* Preview Controls */}
          <div style={{
            display: 'flex',
            gap: '12px',
            alignItems: 'center',
            padding: '12px',
            background: 'rgba(10, 14, 26, 0.5)',
            borderRadius: '8px'
          }}>
            <label style={{ fontWeight: 'bold' }}>Preview:</label>
            <input
              type="text"
              value={state.previewChar}
              onChange={(e) => updateState('previewChar', e.target.value || 'A')}
              maxLength={1}
              style={{ ...inputStyle, width: '60px', textAlign: 'center' }}
            />
            <label style={{ fontWeight: 'bold' }}>Character Set:</label>
            <input
              type="text"
              value={state.characters}
              onChange={(e) => updateState('characters', e.target.value)}
              style={{ ...inputStyle, flex: 1 }}
            />
          </div>
        </main>
      </div>
    </div>
  );
}

// Helper Components
function ParameterSlider({
  label,
  value,
  min,
  max,
  step,
  onChange
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', fontSize: '13px' }}>
        <span>{label}</span>
        <span style={{ color: '#60a5fa' }}>{value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: '100%' }}
      />
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '8px 12px',
  background: 'rgba(30, 40, 60, 0.8)',
  border: '1px solid rgba(100, 150, 255, 0.3)',
  borderRadius: '4px',
  color: '#e0e0e0',
  fontSize: '14px'
};

export default CymaglyphFontGenerator;
