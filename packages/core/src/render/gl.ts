/** Minimal WebGL 1 helpers. No matrix library — we need four numbers, not a framework. */

export type GL = WebGLRenderingContext;

export function createContext(canvas: HTMLCanvasElement): GL | null {
  const attrs: WebGLContextAttributes = {
    alpha: true,
    antialias: true,
    // The curled sheet folds back over itself, so fragments must be ordered
    // by depth rather than by triangle index.
    depth: true,
    premultipliedAlpha: true,
    preserveDrawingBuffer: false,
    powerPreference: 'low-power',
  };
  return (canvas.getContext('webgl', attrs) ??
    canvas.getContext('experimental-webgl', attrs)) as GL | null;
}

function compile(gl: GL, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Bookstand: could not create shader.');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Bookstand: shader failed to compile.\n${log ?? ''}`);
  }
  return shader;
}

export function createProgram(gl: GL, vertex: string, fragment: string): WebGLProgram {
  const vs = compile(gl, gl.VERTEX_SHADER, vertex);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragment);
  const program = gl.createProgram();
  if (!program) throw new Error('Bookstand: could not create program.');
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Bookstand: program failed to link.\n${log ?? ''}`);
  }
  return program;
}

export type UniformMap = Record<string, WebGLUniformLocation | null>;

export function uniforms(gl: GL, program: WebGLProgram, names: string[]): UniformMap {
  const map: UniformMap = {};
  for (const name of names) map[name] = gl.getUniformLocation(program, name);
  return map;
}

export interface Grid {
  buffer: WebGLBuffer;
  indices: WebGLBuffer;
  count: number;
}

/**
 * A unit quad subdivided into `cols` × `rows` cells.
 *
 * One cell is enough for a page lying flat. A curling sheet needs enough
 * subdivision that the roll at the crease reads as a curve rather than a
 * fan of facets — the cylinder is evaluated per vertex, so the mesh density
 * *is* the smoothness.
 */
export function createGrid(gl: GL, cols: number, rows: number): Grid {
  const verts: number[] = [];
  for (let y = 0; y <= rows; y++) {
    for (let x = 0; x <= cols; x++) verts.push(x / cols, y / rows);
  }
  const idx: number[] = [];
  const stride = cols + 1;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const a = y * stride + x;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      // Counter-clockwise in book space, so gl_FrontFacing tells us which
      // side of the sheet is toward the viewer once it rotates.
      idx.push(a, c, b, b, c, d);
    }
  }

  const buffer = gl.createBuffer();
  const indices = gl.createBuffer();
  if (!buffer || !indices) throw new Error('Bookstand: could not create buffers.');
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);

  return { buffer, indices, count: idx.length };
}

/**
 * Upload an image as a texture.
 *
 * NPOT for now: CLAMP_TO_EDGE and LINEAR, no mipmaps — WebGL 1 forbids them on
 * non-power-of-two textures, and every one of our scans is 624×907. Phase 4
 * adds the power-of-two padding path so the curl does not shimmer when it
 * minifies the texture. Flat quads at roughly 1:1 do not need it yet.
 */
export function createTexture(gl: GL, source: TexImageSource): WebGLTexture {
  const texture = gl.createTexture();
  if (!texture) throw new Error('Bookstand: could not create texture.');
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  return texture;
}

export function createSolidTexture(gl: GL, rgba: [number, number, number, number]): WebGLTexture {
  const texture = gl.createTexture();
  if (!texture) throw new Error('Bookstand: could not create texture.');
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    1,
    1,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    new Uint8Array(rgba),
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  return texture;
}
