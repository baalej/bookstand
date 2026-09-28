import type { FrameState } from '../flip-controller.js';
import type { Layout } from '../layout.js';
import type { FaceSlot, Point } from '../types.js';
import {
  createContext,
  createGrid,
  createProgram,
  createSolidTexture,
  uniforms,
  type GL,
  type Grid,
  type UniformMap,
} from './gl.js';
import type { TextureStore } from './textures.js';

/**
 * Anything crossing the vertex/fragment boundary carries an explicit `highp`.
 *
 * The two stages have different default precisions — `highp` in the vertex
 * shader, `mediump` in the fragment shader — and GLSL ES requires a shared
 * uniform or varying to agree. Leaving it implicit fails at *link* time, which
 * takes the whole book down rather than degrading: the renderer constructor
 * throws and nothing renders at all.
 *
 * `mediump` would be the cheaper choice for the fragment stage, but `vFold`
 * carries a distance in page pixels that the normal is rebuilt from, and ~10
 * bits of mantissa there bands the shading it exists to smooth.
 */
const SHARED_PRECISION = 'highp';

/**
 * Quote identifiers in the GLSL below with 'apostrophes', never backticks.
 *
 * The shader sources are template literals, so a backtick anywhere inside one
 * — including inside a comment — terminates the string and the whole file
 * stops parsing, usually surfacing as a blank page and a 500 from the dev
 * server rather than as anything that mentions shaders. It has cost three
 * cycles. The compiler does catch it immediately, so the fix is simply to
 * typecheck after touching a shader.
 */

/**
 * Two coordinate frames, and the shader works in both.
 *
 * *Page-local*: x from 0 at the spine to pageWidth at the free edge, y from 0
 * (top) to pageHeight. Both halves of the book share it, mirrored — which is
 * the same trick `geom/fold.ts` uses, so the fold description arrives here
 * needing no conversion.
 *
 * *Book space*: x from −pageWidth to +pageWidth with the spine at 0, y as
 * above. `uMirror` maps one to the other, and the projection maps book space
 * to clip space. The spine lands on the clip origin, so the perspective divide
 * pivots about the middle of the book.
 */
const VERTEX = `
precision highp float;

attribute vec2 aPos;          // unit quad

uniform vec4 uProject;        // scaleX, scaleY, offsetX, offsetY
uniform ${SHARED_PRECISION} vec2 uPage;   // pageWidth, pageHeight
uniform ${SHARED_PRECISION} float uMirror;      // +1 right half, -1 left half
uniform float uUvFlip;        // 1 when the spine is on the image's right

uniform ${SHARED_PRECISION} float uCurl;        // 1 soft sheet, 0 rigid board
uniform vec2 uFoldOrigin;     // page-local point on the crease
uniform ${SHARED_PRECISION} vec2 uFoldNormal;   // page-local unit, into the lifted part
uniform ${SHARED_PRECISION} float uRadius;      // curl cylinder radius
uniform float uAngle;         // rigid hinge angle about the spine

uniform float uFocal;
uniform float uMinW;

varying ${SHARED_PRECISION} vec2 vUV;
varying ${SHARED_PRECISION} float vFold;  // signed distance past the crease
varying ${SHARED_PRECISION} float vHinge; // rigid hinge angle, for shading
varying ${SHARED_PRECISION} float vSpine;

const float PI = 3.141592653589793;

void main() {
  vUV = vec2(mix(aPos.x, 1.0 - aPos.x, uUvFlip), aPos.y);
  // Geometry, not texture space. aPos.x is the material point's distance from
  // the binding on every surface the renderer draws — both halves, either
  // flip direction, front face or back — because book x is always
  // aPos.x * pageWidth * mirror. Deriving the gutter from vUV instead made it
  // follow the image's orientation: on a backward flip the UV is mirrored, so
  // the spine rendered at full brightness and the seam jumped to the page's
  // outer edge.
  vSpine = aPos.x;

  vec2 pl = aPos * uPage;     // page-local
  vec3 p;
  // Distance past the crease is linear in position, so interpolating it across
  // a triangle is exact. The fragment stage rebuilds the normal from it,
  // which makes shading independent of how coarse the mesh is — vertex
  // normals band visibly when a 21px roll spans 1.6 quads.
  vFold = dot(pl - uFoldOrigin, uFoldNormal);
  vHinge = uAngle;

  if (uCurl > 0.5) {
    // Wrap the sheet around a cylinder tangent to the page at the crease.
    // Everything before the crease is untouched; past it the paper rolls, and
    // once it has rolled half a turn it lies flat again, upside down, at 2R.
    float u = vFold;
    if (u <= 0.0) {
      p = vec3(pl, 0.0);
    } else {
      float arc = u / uRadius;
      vec2 onCrease = pl - uFoldNormal * u;
      float along;
      float z;
      if (arc < PI) {
        along = uRadius * sin(arc);
        z = uRadius * (1.0 - cos(arc));
      } else {
        along = -(u - PI * uRadius);
        z = 2.0 * uRadius;
      }
      p = vec3(onCrease + uFoldNormal * along, z);
    }
  } else {
    // Rigid board: covers do not bend, they hinge about the spine.
    p = vec3(pl.x * cos(uAngle), pl.y, pl.x * sin(uAngle));
  }

  vec2 book = vec2(p.x * uMirror, p.y);

  // A sheet tilted toward the viewer really does grow, but unbounded growth
  // overflows the footprint and clips at the canvas edge, so the divide is
  // clamped to the maximum the layout reserves headroom for.
  float w = max(1.0 - p.z / uFocal, uMinW);

  // Nearer geometry must win: the curl folds back over itself, and without a
  // depth term the later triangles paint over the ones in front.
  float ndcZ = -clamp(p.z / (0.5 * uPage.x), 0.0, 1.0) * 0.9;

  gl_Position = vec4(
    book.x * uProject.x + uProject.z,
    book.y * uProject.y + uProject.w,
    ndcZ * w,
    w
  );
}
`;

const FRAGMENT = `
precision mediump float;

varying ${SHARED_PRECISION} vec2 vUV;
varying ${SHARED_PRECISION} float vFold;
varying ${SHARED_PRECISION} float vHinge;
varying ${SHARED_PRECISION} float vSpine;

uniform sampler2D uFront;
uniform sampler2D uBack;
uniform float uHasBack;
uniform ${SHARED_PRECISION} vec2 uFoldNormal;
uniform ${SHARED_PRECISION} float uRadius;
uniform ${SHARED_PRECISION} float uMirror;
uniform ${SHARED_PRECISION} float uCurl;
uniform ${SHARED_PRECISION} vec2 uPage;

const float PI = 3.141592653589793;

/**
 * Rebuild the surface normal here rather than interpolating a vertex one.
 * The curl's whole shape lives in a band pi*R wide — as narrow as 21px during
 * a corner peek — and per-vertex normals across that band produce visible
 * facets however the mesh is tuned.
 */
vec3 surfaceNormal() {
  vec3 n;
  if (uCurl > 0.5) {
    if (vFold <= 0.0) {
      n = vec3(0.0, 0.0, 1.0);
    } else {
      float arc = vFold / uRadius;
      n = arc < PI
        ? vec3(-uFoldNormal * sin(arc), cos(arc))
        : vec3(0.0, 0.0, -1.0);
    }
  } else {
    n = vec3(-sin(vHinge), 0.0, cos(vHinge));
  }
  return normalize(vec3(n.x * uMirror, n.y, n.z));
}

uniform float uGutter;        // broad bowl strength
uniform float uGutterCore;    // narrow seam strength, on top of the bowl
uniform float uGutterFalloff; // higher = tighter to the spine
uniform float uGutterCoreTightness;
// Interior paper bows into the binding; a cover board is rigid and meets the
// spine at a hinge. Giving a cover the same broad gradient is what makes a
// bound book read as a stapled booklet.
//
// Per *face*, not per sheet: x for the front face, y for the back. A leaf is
// rigid when either of its faces is a cover, so the first and last leaves
// carry one cover and one interior page. Keyed on the leaf, hovering them
// flattened the interior page's gutter too — the gradient vanishing under the
// cursor on exactly the pages next to the covers.
uniform vec2 uGutterScale;
uniform float uLit;           // 1 to shade by the normal, 0 to leave flat
uniform ${SHARED_PRECISION} vec3 uLight;
uniform float uAmbient;

void main() {
  vec4 c;
  if (gl_FrontFacing || uHasBack < 0.5) {
    c = texture2D(uFront, vUV);
  } else {
    // The reverse of a sheet reads mirrored, because we are looking through it.
    c = texture2D(uBack, vec2(1.0 - vUV.x, vUV.y));
  }
  vec3 rgb = c.rgb;

  if (uLit > 0.5) {
    vec3 n = surfaceNormal();
    if (!gl_FrontFacing) n = -n;
    vec3 l = normalize(uLight);
    // Half-Lambert, and weighted heavily toward ambient. Paper is thin, white
    // and lit by bounce from every direction, so a full Lambert term renders
    // any face turned away from the light as a dark slab — which is what a
    // cover rotated past vertical looked like. The diffuse term here sculpts
    // the curl; it does not light the scene.
    float wrapped = dot(n, l) * 0.5 + 0.5;
    // Normalised so a sheet still lying flat comes out at exactly 1.0, the
    // same as the unlit pages beside it. Without this the lit and unlit paths
    // disagree by ~2%, and since a hovering cursor swaps the resting page for
    // a lit sheet, the whole half dimmed the moment the pointer arrived — a
    // hover highlight nobody asked for, and a visible seam along any sheet
    // that is only partly lifted.
    float unlifted = l.z * 0.5 + 0.5;   // 'flat' is reserved in GLSL
    rgb *= (uAmbient + (1.0 - uAmbient) * wrapped) / (uAmbient + (1.0 - uAmbient) * unlifted);
  }

  // The gutter: paper curving down into the binding. Two terms, because one
  // exponential cannot be both.
  //
  //   bowl — broad and soft, the page bending toward the spine over the first
  //          fifth or so of its width.
  //   core — a narrow seam right at the fold. A single smooth gradient loses
  //          the centre entirely: there is nothing to read as *the* spine,
  //          only a vague darkening.
  // Selected the same way the texture above is, so the shading always belongs
  // to the face actually being shown.
  float gutterScale = (gl_FrontFacing || uHasBack < 0.5) ? uGutterScale.x : uGutterScale.y;

  float d = vSpine;
  float bowl = exp(-d * uGutterFalloff);
  float core = exp(-d * uGutterFalloff * uGutterCoreTightness);
  rgb *= 1.0 - (uGutter * bowl + uGutterCore * core) * gutterScale;

  gl_FragColor = vec4(rgb, c.a);
}
`;

const UNIFORMS = [
  'uProject',
  'uPage',
  'uMirror',
  'uUvFlip',
  'uCurl',
  'uFoldOrigin',
  'uFoldNormal',
  'uRadius',
  'uAngle',
  'uFocal',
  'uMinW',
  'uFront',
  'uBack',
  'uHasBack',
  'uGutter',
  'uGutterCore',
  'uGutterFalloff',
  'uGutterCoreTightness',
  'uGutterScale',
  'uLit',
  'uLight',
  'uAmbient',
];

export interface RenderOptions {
  /**
   * Darkening at the spine. The only shadow on a still spread, and what makes
   * two pages read as one bound object rather than two images side by side.
   */
  gutter: number;
  /** Gutter decay rate. Higher keeps it tighter to the spine. */
  gutterFalloff: number;
  /**
   * A narrow seam at the very fold, on top of the broad bowl. Without it the
   * centre is a smooth gradient with no defined middle.
   */
  gutterCore: number;
  /** How much tighter the seam is than the bowl. */
  gutterCoreTightness: number;
  /**
   * The covers' share of the interior gutter. Low: a board does not bow into
   * the binding the way paper does, and giving it the full gradient makes the
   * book look like a folded booklet rather than something bound.
   */
  coverGutter: number;
  /** Perspective focal length, in page widths. Lower is more dramatic. */
  focal: number;
  /**
   * Cap on how much a tilted sheet may grow. The layout reserves exactly this
   * much headroom, so the two must stay in step.
   */
  maxMagnification: number;
  /** Direction the light comes from, in book space. Up and to the left. */
  light: readonly [number, number, number];
  /**
   * Share of brightness that does not depend on the normal. High on purpose:
   * the diffuse term is here to sculpt the roll, not to light the page.
   */
  ambient: number;
  /** Curl mesh subdivisions. Enough that the roll reads smooth at the crease. */
  segments: readonly [number, number];
}

export const defaultRender: RenderOptions = {
  gutter: 0.12,
  gutterFalloff: 6,
  gutterCore: 0.14,
  gutterCoreTightness: 7,
  coverGutter: 0.2,
  focal: 4,
  maxMagnification: 1.08,
  light: [-0.35, -0.5, 0.79],
  ambient: 0.78,
  // Dense enough that the roll's *silhouette* resolves; shading no longer
  // depends on this, since the fragment stage rebuilds the normal. One sheet
  // at a time, so ~38k triangles a frame.
  segments: [160, 120],
};

export class WebGLRenderer {
  readonly gl: GL;
  private readonly program: WebGLProgram;
  private readonly u: UniformMap;
  private readonly flat: Grid;
  private readonly curled: Grid;
  private readonly blank: WebGLTexture;
  private readonly aPos: number;
  private lost = false;

  constructor(
    readonly canvas: HTMLCanvasElement,
    private readonly options: RenderOptions = defaultRender,
  ) {
    const gl = createContext(canvas);
    if (!gl) throw new Error('Bookstand: WebGL is unavailable.');
    this.gl = gl;
    this.program = createProgram(gl, VERTEX, FRAGMENT);
    this.u = uniforms(gl, this.program, UNIFORMS);
    this.flat = createGrid(gl, 1, 1);
    this.curled = createGrid(gl, options.segments[0], options.segments[1]);
    this.blank = createSolidTexture(gl, [0, 0, 0, 0]);
    this.aPos = gl.getAttribLocation(this.program, 'aPos');

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE); // both faces of a turning sheet are visible
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    canvas.addEventListener('webglcontextlost', this.onLost);
    canvas.addEventListener('webglcontextrestored', this.onRestored);
  }

  private onLost = (e: Event): void => {
    e.preventDefault(); // without this the context never comes back
    this.lost = true;
  };

  private onRestored = (): void => {
    this.lost = false;
  };

  get contextLost(): boolean {
    return this.lost;
  }

  resize(cssWidth: number, cssHeight: number, dpr: number): void {
    const w = Math.max(1, Math.round(cssWidth * dpr));
    const h = Math.max(1, Math.round(cssHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.gl.viewport(0, 0, w, h);
  }

  draw(frame: FrameState, layout: Layout, textures: TextureStore): void {
    const { gl } = this;
    if (this.lost) return;

    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const dpr = cw / Math.max(1, this.canvas.clientWidth);

    gl.useProgram(this.program);
    gl.uniform4fv(this.u['uProject']!, [
      (2 * dpr) / cw,
      (-2 * dpr) / ch,
      0,
      (layout.pageHeight * dpr) / ch,
    ]);
    gl.uniform2f(this.u['uPage']!, layout.pageWidth, layout.pageHeight);
    gl.uniform1f(this.u['uFocal']!, layout.pageWidth * this.options.focal);
    gl.uniform1f(this.u['uMinW']!, 1 / this.options.maxMagnification);
    gl.uniform1i(this.u['uFront']!, 0);
    gl.uniform1i(this.u['uBack']!, 1);
    gl.uniform1f(this.u['uGutter']!, this.options.gutter);
    gl.uniform1f(this.u['uGutterCore']!, this.options.gutterCore);
    gl.uniform1f(this.u['uGutterFalloff']!, this.options.gutterFalloff);
    gl.uniform1f(this.u['uGutterCoreTightness']!, this.options.gutterCoreTightness);
    gl.uniform3fv(this.u['uLight']!, this.options.light as unknown as number[]);
    gl.uniform1f(this.u['uAmbient']!, this.options.ambient);

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // Resting halves first; the turning sheet passes over them.
    this.drawFace(frame.left, 'left', layout, textures);
    this.drawFace(frame.right, 'right', layout, textures);
    if (frame.flip) this.drawSheet(frame.flip, layout, textures);
  }

  private bindGrid(grid: Grid): void {
    const { gl } = this;
    gl.bindBuffer(gl.ARRAY_BUFFER, grid.buffer);
    gl.enableVertexAttribArray(this.aPos);
    gl.vertexAttribPointer(this.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, grid.indices);
  }

  /**
   * Mirroring a half of the book flips the triangle winding, which flips
   * `gl_FrontFacing` with it — so a sheet turning leftward sampled its back
   * texture on the front and negated its normal, rendering as a dark grey
   * slab. Telling GL which winding is front for this draw fixes the facing
   * test and the lighting together.
   */
  private setWinding(mirror: number): void {
    this.gl.frontFace(mirror > 0 ? this.gl.CCW : this.gl.CW);
  }

  /** A cover board does not bow into the binding; interior paper does. */
  private gutterScaleFor(face: FaceSlot): number {
    return face && face.role !== 'interior' ? this.options.coverGutter : 1;
  }

  private drawFace(
    face: FaceSlot,
    side: 'left' | 'right',
    layout: Layout,
    textures: TextureStore,
  ): void {
    if (!face) return; // a reserved half draws nothing at all
    const { gl } = this;

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, textures.get(face) ?? this.blank);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.blank);

    this.bindGrid(this.flat);
    this.setWinding(side === 'right' ? 1 : -1);
    gl.uniform1f(this.u['uMirror']!, side === 'right' ? 1 : -1);
    gl.uniform1f(this.u['uUvFlip']!, side === 'right' ? 0 : 1);
    gl.uniform1f(this.u['uCurl']!, 0);
    gl.uniform1f(this.u['uAngle']!, 0);
    gl.uniform1f(this.u['uRadius']!, 1); // never leave a divisor at zero
    gl.uniform1f(this.u['uHasBack']!, 0);
    gl.uniform1f(this.u['uLit']!, 0); // a page lying flat needs no shading
    const scale = this.gutterScaleFor(face);
    gl.uniform2f(this.u['uGutterScale']!, scale, scale);
    gl.drawElements(gl.TRIANGLES, this.flat.count, gl.UNSIGNED_SHORT, 0);
  }

  private drawSheet(
    flip: NonNullable<FrameState['flip']>,
    layout: Layout,
    textures: TextureStore,
  ): void {
    const { gl } = this;
    const forward = flip.direction === 'forward';
    const soft = !flip.rigid;

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, textures.get(flip.movingFront) ?? this.blank);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, textures.get(flip.movingBack) ?? this.blank);

    this.bindGrid(soft ? this.curled : this.flat);
    this.setWinding(forward ? 1 : -1);
    gl.uniform1f(this.u['uMirror']!, forward ? 1 : -1);
    gl.uniform1f(this.u['uUvFlip']!, forward ? 0 : 1);
    gl.uniform1f(this.u['uHasBack']!, flip.movingBack ? 1 : 0);
    gl.uniform1f(this.u['uLit']!, 1);
    gl.uniform2f(
      this.u['uGutterScale']!,
      this.gutterScaleFor(flip.movingFront),
      this.gutterScaleFor(flip.movingBack),
    );
    if (soft) {
      gl.uniform1f(this.u['uCurl']!, 1);
      gl.uniform2f(this.u['uFoldOrigin']!, flip.fold.origin.x, flip.fold.origin.y);
      gl.uniform2f(this.u['uFoldNormal']!, flip.fold.normal.x, flip.fold.normal.y);
      gl.uniform1f(this.u['uRadius']!, Math.max(1, flip.fold.radius));
      gl.uniform1f(this.u['uAngle']!, 0);
    } else {
      gl.uniform1f(this.u['uCurl']!, 0);
      gl.uniform1f(this.u['uAngle']!, flip.fold.progress * Math.PI);
    }

    gl.drawElements(
      gl.TRIANGLES,
      soft ? this.curled.count : this.flat.count,
      gl.UNSIGNED_SHORT,
      0,
    );
    void layout;
  }

  destroy(): void {
    const { gl } = this;
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored);
    gl.deleteProgram(this.program);
    for (const grid of [this.flat, this.curled]) {
      gl.deleteBuffer(grid.buffer);
      gl.deleteBuffer(grid.indices);
    }
    gl.deleteTexture(this.blank);
  }
}
