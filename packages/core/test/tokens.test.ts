import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { gesture, springs } from '../src/motion/tokens.js';
import { defaultMotion } from '../src/flip-controller.js';
import { defaultCurl } from '../src/geom/fold.js';
import { defaultRender } from '../src/render/webgl-renderer.js';

const SRC = fileURLToPath(new URL('../src', import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return full.endsWith('.ts') ? [full] : [];
  });
}

/** Strip comments so prose about values doesn't trip the scanners below. */
function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('motion token discipline', () => {
  // The lesson being encoded: taste that lives at call sites regresses. Every
  // spring and gesture constant has one home, so the feel can be retuned in
  // one place and cannot drift apart across modules.

  it('declares stiffness only in tokens.ts', () => {
    const offenders = sourceFiles(SRC)
      .filter((f) => !f.endsWith(join('motion', 'tokens.ts')))
      .filter((f) => /stiffness\s*:\s*[\d.]/.test(code(f)))
      .map((f) => f.slice(SRC.length + 1));

    expect(offenders).toEqual([]);
  });

  it('routes every default through a token', () => {
    expect(defaultMotion.settle).toBe(springs.settle);
    expect(defaultMotion.recoil).toBe(springs.recoil);
    expect(defaultMotion.peek).toBe(springs.peek);
    expect(defaultMotion.flickVelocity).toBe(gesture.flickVelocity);
    expect(defaultMotion.maxDuration).toBe(gesture.maxDuration);
    expect(defaultMotion.peekDepth).toBe(gesture.peekDepth);
  });

  it('keeps the set small enough to hold in your head', () => {
    expect(Object.keys(springs).length).toBeLessThanOrEqual(4);
    expect(Object.keys(gesture).length).toBeLessThanOrEqual(6);
  });
});

describe('the renderer consumes the whole fold', () => {
  // The lesson this encodes cost a whole phase: `geom/fold.ts` computed
  // origin, normal and radius every frame and the renderer read only
  // `progress`, driving a spine hinge. The fold was right, the corner was
  // simply never drawn — and nothing failed, because nothing checked.
  const renderer = code(join(SRC, 'render', 'webgl-renderer.ts'));

  it.each(['origin', 'normal', 'radius'] as const)('uses fold.%s', (field) => {
    expect(renderer).toContain(`fold.${field}`);
  });

  it('subdivides the mesh it curls', () => {
    // A 1×1 quad cannot bend, whatever the shader says.
    const [cols, rows] = defaultRender.segments;
    expect(cols).toBeGreaterThanOrEqual(8);
    expect(rows).toBeGreaterThanOrEqual(8);
  });

  it('keeps a depth buffer for the sheet to fold over itself', () => {
    expect(code(join(SRC, 'render', 'gl.ts'))).toMatch(/depth:\s*true/);
    expect(renderer).toContain('DEPTH_TEST');
  });

  it('corrects the winding when a half is mirrored', () => {
    // Without this, a sheet turning leftward samples its back texture on the
    // front and negates its normal — it renders as a dark grey slab.
    expect(renderer).toContain('frontFace');
  });

  it('rebuilds the normal per fragment rather than interpolating one', () => {
    // A 21px roll spanning 1.6 quads bands visibly with vertex normals, and
    // no mesh density fixes it at every scale.
    expect(renderer).toContain('surfaceNormal');
    expect(renderer).not.toMatch(/varying\s+\S*\s*vec3 vNormal/);
  });

  it('gives every shared uniform and varying an explicit matching precision', () => {
    // The two stages default to different precisions, and a mismatch fails at
    // *link* time — the renderer constructor throws and the entire book
    // disappears rather than degrading. Caught only because the demo went blank.
    //
    // Scanned against the GLSL sources alone: the surrounding TypeScript is
    // full of `gl.uniform1f(...)` calls that a looser pattern happily matches.
    const glsl = [...renderer.matchAll(/^const (?:VERTEX|FRAGMENT) = `([\s\S]*?)^`;/gm)].map(
      (m) => m[1]!,
    );
    expect(glsl, 'expected a vertex and a fragment source').toHaveLength(2);

    // Derived from the sources, not hardcoded: a list would go stale the
    // moment a new uniform is used in both stages, which is exactly how this
    // regressed once already.
    const declarations = (src: string): Map<string, string> => {
      const found = new Map<string, string>();
      for (const m of src.matchAll(/^\s*(?:uniform|varying)\b([^;]*?)(\w+)\s*;/gm)) {
        found.set(m[2]!, m[0]!);
      }
      return found;
    };
    const [vertex, fragment] = glsl.map(declarations) as [Map<string, string>, Map<string, string>];

    const shared = [...vertex.keys()].filter((name) => fragment.has(name));
    expect(shared.length, 'expected some uniforms to cross the stage boundary').toBeGreaterThan(4);

    for (const name of shared) {
      for (const [stage, decl] of [
        ['vertex', vertex.get(name)!],
        ['fragment', fragment.get(name)!],
      ] as const) {
        expect(decl, `${name} needs an explicit precision in the ${stage} stage`).toContain(
          'SHARED_PRECISION',
        );
      }
    }
  });

  it('shades a flat lit sheet identically to an unlit page', () => {
    // A hovering cursor swaps the resting half for a *lit* sheet. The two
    // paths disagreed by ~2%, so the whole page dimmed the moment the pointer
    // arrived — 28,000 changed pixels across the half, read as a hover
    // highlight. Mirrors the shader's arithmetic for a surface still flat.
    const [lx, ly, lz] = defaultRender.light;
    const length = Math.hypot(lx, ly, lz);
    const a = defaultRender.ambient;

    const shade = (n: readonly [number, number, number]): number => {
      const wrapped = ((n[0] * lx + n[1] * ly + n[2] * lz) / length) * 0.5 + 0.5;
      const unlifted = (lz / length) * 0.5 + 0.5;
      return (a + (1 - a) * wrapped) / (a + (1 - a) * unlifted);
    };

    expect(shade([0, 0, 1])).toBeCloseTo(1, 10);
    // And the curl still gets sculpted, or the normalisation ate the effect.
    expect(shade([-1, 0, 0])).toBeLessThan(0.97);
    expect(shade([0, 0, -1])).toBeLessThan(shade([0, 0, 1]));
  });

  it('normalises the lit path in the shader, not just in this test', () => {
    expect(renderer).toContain('unlifted');
  });

  it('keeps the gutter readable without dominating the spread', () => {
    // The only shadow on a static book. At 0.06 it was invisible and the
    // spread read as two images side by side; at 0.37 it was too heavy. The
    // definition is the core's job, not the total depth's.
    const total = defaultRender.gutter + defaultRender.gutterCore;
    expect(total).toBeGreaterThanOrEqual(0.2);
    expect(total).toBeLessThanOrEqual(0.32);
  });

  it('does not try to shadow the turning sheet with itself', () => {
    // Deliberate, after five attempts. The flap sits at z = 2R and takes the
    // perspective divide; the page beneath it sits at z = 0 and does not, so
    // its rendered silhouette lands 4-25px outside its material footprint
    // depending on fold size. A shadow computed on the page in material space
    // therefore cannot align with the flap's visible edge — every variant
    // read as either a stripe, a hard cut, or a detached band.
    //
    // Doing it properly needs a shadow-caster pass that reuses the same
    // vertex path, so caster and receiver share a projection. Until then the
    // sheet casts but does not receive. See PLAN.md.
    expect(renderer).not.toContain('uShadowSelf');
    const branch = renderer.match(/if \(uShadow > 0\.0\) \{([\s\S]*?)\n  \}/);
    expect(branch, 'expected the cast-shadow branch').not.toBeNull();
    expect(branch![1], 'receivers use the book-space crease').toContain('vBook');
    expect(branch![1], 'no material-space self term').not.toContain('vFold');
  });

  it('measures the gutter from the binding, never from texture space', () => {
    // `vUV` is mirrored on a backward flip, so a gutter derived from it put
    // the spine at full brightness and moved the seam to the page's outer
    // edge — measured 167 at the spine at rest against 255 while peeking.
    // `aPos.x` is the material point's distance from the binding on every
    // surface: both halves, either direction, front face or back.
    expect(renderer).toContain('vSpine = aPos.x');
    expect(renderer).toMatch(/float d = vSpine;/);
    expect(renderer, 'uGutterSide reintroduces the orientation bug').not.toContain('uGutterSide');
  });

  it('gives the gutter a defined core, not just a smooth bowl', () => {
    // One exponential cannot be both broad and defined: the centre reads as a
    // vague darkening with no actual spine. The seam has to be tighter than
    // the bowl and carry real weight.
    expect(defaultRender.gutterCore).toBeGreaterThan(0);
    expect(defaultRender.gutterCoreTightness).toBeGreaterThan(1);

    const shade = (d: number): number =>
      1 -
      defaultRender.gutter * Math.exp(-d * defaultRender.gutterFalloff) -
      defaultRender.gutterCore *
        Math.exp(-d * defaultRender.gutterFalloff * defaultRender.gutterCoreTightness);

    // Never black, and never brighter than the paper it sits on.
    expect(shade(0)).toBeGreaterThan(0.45);
    expect(shade(1)).toBeLessThanOrEqual(1);
    // Monotonic away from the spine, or the seam reads as a band not a fold.
    let previous = -Infinity;
    for (let d = 0; d <= 1.0001; d += 0.02) {
      const v = shade(d);
      expect(v).toBeGreaterThan(previous - 1e-9);
      previous = v;
    }
    // The core must actually concentrate: most of its effect inside the bowl.
    const coreAt = (d: number): number =>
      Math.exp(-d * defaultRender.gutterFalloff * defaultRender.gutterCoreTightness);
    expect(coreAt(0.05)).toBeLessThan(0.2);
  });

  it('resolves the tightest roll across enough quads to read as a curve', () => {
    // The roll occupies a band pi*R wide. At the stiffness floor that is the
    // narrowest it ever gets, and it has to span enough of the mesh to look
    // round — 1.6 quads is the "low poly" complaint.
    const page = { width: 320, height: 464 };
    const tightestRoll = Math.PI * page.width * defaultCurl.minRadius;
    const quad = page.width / defaultRender.segments[0];
    expect(tightestRoll / quad).toBeGreaterThanOrEqual(8);
  });
});

describe('curl radius law', () => {
  it('is bounded by paper stiffness, not by progress', () => {
    // Deriving the radius from progress puts a 104px radius under a 40px
    // flap at peek, which cannot reach a quarter turn. See geom/fold.ts.
    expect(defaultCurl.minRadius).toBeLessThan(defaultCurl.maxRadius);
    expect(defaultCurl.maxRadius).toBeLessThanOrEqual(0.25);
  });
});

describe('motion character', () => {
  it('abandoning a drag is stiffer than completing one', () => {
    // A refusal gets out of the way faster than a confirmation arrives.
    // Inverting these would make every rejected drag feel like a commitment.
    expect(springs.recoil.stiffness).toBeGreaterThan(springs.settle.stiffness);
  });

  it('the hover hint is the softest thing that moves', () => {
    expect(springs.peek.stiffness).toBeLessThan(springs.settle.stiffness);
  });

  it('commits to a drag on distance, never on a timer', () => {
    // StPageFlip gates touch behind a 250 ms setTimeout and measures 278 ms
    // before the page moves. A distance lock decides on the first move that
    // proves intent. If this ever becomes a duration, that regression is back.
    expect(gesture.intentLockPx).toBeGreaterThan(0);
    expect(gesture.intentLockPx).toBeLessThan(16);
    expect(Object.keys(gesture)).not.toContain('intentLockMs');
  });
});
