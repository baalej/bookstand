import type { GL } from './gl.js';

/**
 * Side of the grain tile, in texels. Power of two, because WebGL 1 allows
 * mipmaps and REPEAT only on power-of-two textures and the grain needs both:
 * REPEAT to tile across a page, mipmaps so a sheet seen edge-on in the curl
 * averages the grain out rather than shimmering.
 *
 * 256 rather than 128 because the tile is laid at roughly one texel per CSS
 * pixel, and a 128px tile repeats three or four times across a page — enough
 * that the fibres line up into a visible lattice.
 */
export const GRAIN_SIZE = 256;

/** Deterministic, so every book on a page — and every load — has the same paper. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Value noise with `cells` lattice cells across the tile. The lattice wraps,
 * so the noise is seamless at the tile edge by construction rather than by
 * blending.
 */
function tilingNoise(size: number, cells: number, random: () => number): Float32Array {
  const lattice = new Float32Array(cells * cells);
  for (let i = 0; i < lattice.length; i++) lattice[i] = random();
  const at = (x: number, y: number): number =>
    lattice[((y + cells) % cells) * cells + ((x + cells) % cells)]!;
  const smooth = (t: number): number => t * t * (3 - 2 * t);

  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const fy = (y / size) * cells;
    const y0 = Math.floor(fy);
    const ty = smooth(fy - y0);
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * cells;
      const x0 = Math.floor(fx);
      const tx = smooth(fx - x0);
      const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx;
      const bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx;
      out[y * size + x] = top + (bottom - top) * ty;
    }
  }
  return out;
}

/**
 * How much each texel darkens the paper, 0..255. Two layers, because paper has
 * two textures at two scales and either alone reads as something else:
 *
 *   formation — the cloudy unevenness of pulp settling on the wire. Alone it
 *               reads as a stain or a dirty scan.
 *   fibres    — short, sparse, darker strokes. Alone they read as noise or
 *               dust; over the formation they read as paper.
 *
 * Generated rather than shipped as an image: no request, no decode, nothing
 * to configure, and it is computed once per page however many books share it.
 */
export function grainPixels(size: number = GRAIN_SIZE, seed = 7): Uint8Array {
  const random = mulberry32(seed);
  const field = new Float32Array(size * size);

  const octaves: Array<[cells: number, weight: number]> = [
    [4, 0.5],
    [8, 0.3],
    [16, 0.2],
  ];
  for (const [cells, weight] of octaves) {
    const noise = tilingNoise(size, cells, random);
    for (let i = 0; i < field.length; i++) field[i]! += noise[i]! * weight * 0.3;
  }

  // Tooth: the fine, even roughness of the sheet's surface, a texel or two
  // across. It is most of what the eye reads as "paper" at reading distance.
  const tooth = tilingNoise(size, size / 2, random);
  for (let i = 0; i < field.length; i++) field[i]! += tooth[i]! * 0.35;

  // Fibres scale with the tile's area so the density is the same at any size.
  // Short and faint: long or dark strokes read as straw in handmade paper —
  // a texture, but not the one a printed book has.
  const fibres = Math.round((size * size) / 90);
  for (let f = 0; f < fibres; f++) {
    const x = random() * size;
    const y = random() * size;
    const angle = random() * Math.PI;
    const length = 1.5 + random() * 3.5;
    const strength = 0.35 + random() * random() * 0.35;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    for (let s = 0; s <= length; s += 0.5) {
      // Wrapped, so a fibre crossing the edge continues on the other side.
      const px = ((Math.round(x + dx * s) % size) + size) % size;
      const py = ((Math.round(y + dy * s) % size) + size) % size;
      const i = py * size + px;
      field[i] = Math.max(field[i]!, strength);
    }
  }

  const out = new Uint8Array(size * size);
  for (let i = 0; i < field.length; i++) {
    out[i] = Math.round(Math.min(1, Math.max(0, field[i]!)) * 255);
  }
  return out;
}

let shared: Uint8Array | null = null;

/** One tile per GL context, from one generated buffer per page. */
export function createGrainTexture(gl: GL): WebGLTexture {
  shared ??= grainPixels();
  const texture = gl.createTexture();
  if (!texture) throw new Error('Bookstand: could not create texture.');
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1); // one byte per texel; rows are not 4-aligned in general
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.LUMINANCE,
    GRAIN_SIZE,
    GRAIN_SIZE,
    0,
    gl.LUMINANCE,
    gl.UNSIGNED_BYTE,
    shared,
  );
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  return texture;
}
