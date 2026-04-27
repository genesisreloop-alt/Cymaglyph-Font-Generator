import React, { useState, useCallback, useMemo } from 'react';
import { generateTibetanMandala, generateFlowerOfLife } from '../lib/mandala';
import { exportFont, downloadFont } from '../lib/font';
import type { SacredGlyphParams, ParsedGlyph, VectorPath } from '../types';

const defaultParams: SacredGlyphParams = {
  symmetryOrder: 12,
  radialLayers: 7,
  sourceMorph: 0.5,
  modeMorph: 0.5,
  mediumMorph: 0.5,
  depth: 0.5,
  sampleDensity: 0.5,
  mandalaMix: 0.5,
  lotusMix: 0.5,
  cymaticMix: 0.5,
  carrierWaveCycles: 3,
  carrierWaveStrength: 0.5,
  lotusPetals: 8,
  fieldBoundary: 'circle',
  radialRatioFunction: 'phi',
  primitiveSet: ['petal', 'arc', 'circle'],
  strictSacredMapping: true,
  noGapFullForm: true,
};

export function CymaglyphFontGenerator() {
  const [params, setParams] = useState<SacredGlyphParams>(defaultParams);
  const [selectedMandala, setSelectedMandala] = useState<'tibetan' | 'flower'>('tibetan');
  const [exportFormat, setExportFormat] = useState<'ttf' | 'otf'>('ttf');
  const [familyName, setFamilyName] = useState('CYMAGYPH');
  const [isGenerating, setIsGenerating] = useState(false);
  const [previewPaths, setPreviewPaths] = useState<VectorPath[]>([]);

  const handleParamChange = useCallback((key: keyof SacredGlyphParams, value: number | string | boolean | string[]) => {
    setParams(prev => ({ ...prev, [key]: value }));
  }, []);

  const generatePreview = useCallback(() => {
    setIsGenerating(true);
    
    try {
      if (selectedMandala === 'tibetan') {
        const mandala = generateTibetanMandala({
          centerX: 256,
          centerY: 256,
          outerRadius: 200,
          layerCount: params.radialLayers,
          gateCount: 4,
          detailLevel: 1,
          includeDeityPalace: true,
          includeFireRing: true,
          includeLotusRing: true,
          includeVajraRing: true,
        });
        setPreviewPaths(mandala.paths);
      } else {
        const mandala = generateFlowerOfLife({
          centerX: 256,
          centerY: 256,
          radius: 50,
          rings: Math.min(3, params.radialLayers),
          segmentsPerCircle: 32,
        });
        setPreviewPaths(mandala.paths);
      }
    } catch (error) {
      console.error('Generation error:', error);
    } finally {
      setIsGenerating(false);
    }
  }, [selectedMandala, params.radialLayers]);

  const handleExport = useCallback(() => {
    try {
      const glyph: ParsedGlyph = {
        unicode: 'A',
        name: 'cymaglyph_A',
        paths: previewPaths,
        bounds: {
          xMin: 0,
          yMin: 0,
          xMax: 512,
          yMax: 512,
        },
        advanceWidth: 600,
      };

      const fontBuffer = exportFont({
        format: exportFormat,
        familyName,
        styleName: 'Regular',
        unitsPerEm: 1024,
        ascender: 900,
        descender: -200,
        glyphs: [glyph],
        metadata: {
          version: '1.0.0',
          description: 'CYMAGYPH - DSP-generated sacred geometry font',
          designer: 'CYMAGYPH Generator',
          dspParameters: params,
        },
      });

      const ext = exportFormat === 'otf' ? 'otf' : 'ttf';
      downloadFont(fontBuffer, `${familyName.toLowerCase()}.${ext}`);
    } catch (error) {
      console.error('Export error:', error);
      alert('Export failed. Check console for details.');
    }
  }, [previewPaths, exportFormat, familyName, params]);

  return (
    <div style={{ 
      display: 'flex', 
      height: '100vh', 
      background: '#0a0a0f',
      color: '#e0e0e0',
      fontFamily: 'system-ui, sans-serif'
    }}>
      {/* Left Panel - Controls */}
      <div style={{ 
        width: '320px', 
        padding: '20px', 
        overflowY: 'auto',
        borderRight: '1px solid #333',
        background: '#111'
      }}>
        <h2 style={{ fontSize: '18px', marginBottom: '20px', color: '#fff' }}>
          CYMAGYPH Font Generator
        </h2>

        {/* Mandala Type Selector */}
        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px' }}>
            Mandala Type
          </label>
          <select
            value={selectedMandala}
            onChange={(e) => setSelectedMandala(e.target.value as 'tibetan' | 'flower')}
            style={{
              width: '100%',
              padding: '8px',
              background: '#222',
              border: '1px solid #444',
              color: '#fff',
              borderRadius: '4px',
            }}
          >
            <option value="tibetan">Tibetan Mandala</option>
            <option value="flower">Flower of Life</option>
          </select>
        </div>

        {/* Symmetry Order */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px' }}>
            Symmetry Order: {params.symmetryOrder}
          </label>
          <input
            type="range"
            min="4"
            max="24"
            value={params.symmetryOrder}
            onChange={(e) => handleParamChange('symmetryOrder', parseInt(e.target.value))}
            style={{ width: '100%' }}
          />
        </div>

        {/* Radial Layers */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px' }}>
            Radial Layers: {params.radialLayers}
          </label>
          <input
            type="range"
            min="3"
            max="12"
            value={params.radialLayers}
            onChange={(e) => handleParamChange('radialLayers', parseInt(e.target.value))}
            style={{ width: '100%' }}
          />
        </div>

        {/* Source Morph */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px' }}>
            Source Morph: {params.sourceMorph.toFixed(2)}
          </label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={params.sourceMorph}
            onChange={(e) => handleParamChange('sourceMorph', parseFloat(e.target.value))}
            style={{ width: '100%' }}
          />
        </div>

        {/* Mandala Mix */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px' }}>
            Mandala Mix: {params.mandalaMix.toFixed(2)}
          </label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={params.mandalaMix}
            onChange={(e) => handleParamChange('mandalaMix', parseFloat(e.target.value))}
            style={{ width: '100%' }}
          />
        </div>

        {/* Font Family Name */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px' }}>
            Font Family Name
          </label>
          <input
            type="text"
            value={familyName}
            onChange={(e) => setFamilyName(e.target.value)}
            style={{
              width: '100%',
              padding: '8px',
              background: '#222',
              border: '1px solid #444',
              color: '#fff',
              borderRadius: '4px',
            }}
          />
        </div>

        {/* Export Format */}
        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px' }}>
            Export Format
          </label>
          <select
            value={exportFormat}
            onChange={(e) => setExportFormat(e.target.value as 'ttf' | 'otf')}
            style={{
              width: '100%',
              padding: '8px',
              background: '#222',
              border: '1px solid #444',
              color: '#fff',
              borderRadius: '4px',
            }}
          >
            <option value="ttf">TrueType (TTF)</option>
            <option value="otf">OpenType (OTF)</option>
          </select>
        </div>

        {/* Action Buttons */}
        <button
          onClick={generatePreview}
          disabled={isGenerating}
          style={{
            width: '100%',
            padding: '12px',
            marginBottom: '10px',
            background: '#4a9eff',
            border: 'none',
            color: '#fff',
            borderRadius: '4px',
            cursor: isGenerating ? 'not-allowed' : 'pointer',
            fontWeight: 'bold',
          }}
        >
          {isGenerating ? 'Generating...' : 'Generate Preview'}
        </button>

        <button
          onClick={handleExport}
          disabled={previewPaths.length === 0}
          style={{
            width: '100%',
            padding: '12px',
            background: previewPaths.length === 0 ? '#444' : '#2ecc71',
            border: 'none',
            color: '#fff',
            borderRadius: '4px',
            cursor: previewPaths.length === 0 ? 'not-allowed' : 'pointer',
            fontWeight: 'bold',
          }}
        >
          Export {exportFormat.toUpperCase()}
        </button>
      </div>

      {/* Right Panel - Preview */}
      <div style={{ flex: 1, padding: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {previewPaths.length > 0 ? (
          <svg
            width="512"
            height="512"
            viewBox="0 0 512 512"
            style={{ background: '#1a1a2e', borderRadius: '8px' }}
          >
            {previewPaths.map((path, idx) => {
              if (path.points.length < 2) return null;
              
              const d = path.points.map((p, i) => 
                (i === 0 ? 'M' : 'L') + ` ${p.x} ${p.y}`
              ).join(' ') + (path.closed ? ' Z' : '');

              return (
                <path
                  key={idx}
                  d={d}
                  fill="none"
                  stroke="#4a9eff"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              );
            })}
          </svg>
        ) : (
          <div style={{ 
            textAlign: 'center', 
            color: '#666',
            padding: '40px',
            border: '2px dashed #333',
            borderRadius: '8px'
          }}>
            <p style={{ fontSize: '16px', marginBottom: '10px' }}>No preview generated</p>
            <p style={{ fontSize: '14px' }}>Click "Generate Preview" to create a glyph</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default CymaglyphFontGenerator;
