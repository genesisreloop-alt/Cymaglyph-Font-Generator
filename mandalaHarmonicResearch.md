# Mandala Harmonic Structure Research

## Core Harmonic Principles

### 1. Radial Symmetry & Angular Division
- **Symmetry Order (n)**: Primary divisor of 360° creating n-fold rotational symmetry
- Common orders: 4, 6, 8, 12, 16, 24 (divisors of 360 for clean division)
- Angular spacing: θ = 360°/n or 2π/n radians

### 2. Golden Ratio (φ) Proportions
- φ = 1.618033988749895...
- Appears in radial layer spacing: r(k) = r₀ · φ^k or r₀ · φ^(-k)
- Spiral phyllotaxis: divergence angle = 360°/φ² ≈ 137.5° (golden angle)

### 3. Harmonic Frequency Ratios
- **Octave**: 2:1 ratio (fundamental frequency doubling)
- **Perfect Fifth**: 3:2 ratio (musical consonance)
- **Perfect Fourth**: 4:3 ratio
- **Major Third**: 5:4 ratio
- These ratios map to geometric proportions in mandala construction

### 4. Vesica Piscis & Seed of Life
- Created by intersecting circles with radius = distance between centers
- Forms the basis for Flower of Life pattern
- Ratio: √3 appears in hexagonal packing

### 5. Metatron's Cube Geometry
- Derived from Flower of Life
- Contains all 5 Platonic solids
- Grid based on √2, √3, √5 proportions

### 6. Sri Yantra Proportions
- 9 interlocking triangles (4 upward, 5 downward)
- Based on golden ratio subdivisions
- Central bindu point as origin

### 7. Cymatic Pattern Mapping
- Chladni plates: nodal lines form at resonant frequencies
- Circular plates: Bessel function zeros determine ring radii
- Angular modes (m) and radial modes (n) create m:n patterns
- Frequency f ∝ (k·h/a²)·√(E/ρ(1-ν²)) where:
  - k = mode constant
  - h = plate thickness
  - a = radius
  - E = Young's modulus
  - ρ = density
  - ν = Poisson's ratio

### 8. DSP-to-Mandala Mapping
- **Carrier frequency** → radial ring count (high freq = more rings)
- **Payload frequency** → angular division (low freq = fewer petals)
- **AM depth** → contrast between filled/void regions
- **PM depth** → spiral twist/warp magnitude
- **Resonance Q** → sharpness of boundaries

### 9. Sacred Geometry Constants
- π = 3.14159... (circle circumference)
- φ = 1.618... (golden ratio)
- √2 = 1.414... (diagonal of unit square)
- √3 = 1.732... (height of equilateral triangle)
- √5 = 2.236... (diagonal of golden rectangle)
- e = 2.718... (natural logarithm base)

### 10. Harmonic Series in Mandalas
- Fundamental (1f): outer boundary
- 2nd harmonic (2f): first inner ring
- 3rd harmonic (3f): triangular/trine patterns
- 4th harmonic (4f): square/quadrant patterns
- 5th harmonic (5f): pentagonal patterns
- Higher harmonics: increasingly complex subdivisions

## Implementation Strategy for CYMAGYPH Font

1. **Stroke Generation**: Use Marching Squares on DSP field ψ(x,y)
2. **Mandala Overlay**: Superimpose harmonic geometry primitives
3. **4K Resolution**: Sample at 4096×4096 for crisp vector output
4. **TTF/OTF Export**: Convert contours to OpenType path commands
5. **Bijective Mapping**: Each glyph preserves source character topology
