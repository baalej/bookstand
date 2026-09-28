import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// `element.ts` subclasses HTMLElement at module scope, so importing it under
// Node needs something for `extends` to resolve against. A stub rather than a
// DOM library: the element's real behaviour — mounting, attributes, the inline
// config, the drag — is proved against a real browser on a real static page,
// which no DOM emulator would tell us the truth about anyway. This exists so a
// pure attribute parser can live beside the element it belongs to instead of
// being exiled to its own module for the convenience of a test.
(globalThis as { HTMLElement?: unknown }).HTMLElement ??= class {};

const { parseStartAt } = await import('../src/element.js');

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
  main: string;
  types: string;
  files: string[];
  sideEffects: string[];
  exports: Record<string, string | Record<string, string>>;
};
const source = (path: string): string => readFileSync(join(ROOT, 'src', path), 'utf8');

describe('what gets published', () => {
  // These are the failures you cannot see locally: everything works from the
  // workspace and then breaks for whoever installs it.

  it('ships every file the exports map points at', () => {
    const entries = Object.values(manifest.exports).flatMap((value) =>
      typeof value === 'string' ? [value] : Object.values(value),
    );
    entries.push(manifest.main, manifest.types);

    const shipped = (path: string): boolean =>
      manifest.files.some((allowed) => path.replace(/^\.\//, '').startsWith(allowed));

    expect(entries.filter((path) => path !== './package.json').filter((p) => !shipped(p))).toEqual(
      [],
    );
  });

  it('does not let a bundler tree-shake the custom element away', () => {
    // Registering `<book-stand>` is a side effect, and it is the entire point
    // of that module: `import 'bookstand/element'` binds no names at all. With
    // a blanket `"sideEffects": false` a bundler is within its rights to drop
    // the import wholesale, and the tag silently never upgrades.
    expect(Array.isArray(manifest.sideEffects), 'a blanket false would be wrong here').toBe(true);
    expect(manifest.sideEffects.some((p) => p.includes('element'))).toBe(true);
    // ...while the rest of the library stays shakeable.
    expect(manifest.sideEffects.every((p) => p.includes('element'))).toBe(true);
  });

  it('registers the element idempotently', () => {
    // Two copies on one page, or a page that already defines the tag, must not
    // throw — an uncaught error here takes down the whole module graph.
    expect(source('element.ts')).toMatch(/customElements\.get\(TAG\)/);
    expect(source('element.ts')).toMatch(/typeof customElements !== 'undefined'/);
  });
});

describe('sizing from CSS alone', () => {
  it('measures the host before the canvas is in it', () => {
    // The ordering *is* the trick. An element whose height comes from its own
    // content measures zero while empty, which is how we tell "the author gave
    // no height" from "the author gave one". Read it after appending and every
    // host looks authored, because the canvas has given it one.
    const code = source('bookstand.ts');
    const measured = code.indexOf('const authoredHeight');
    const appended = code.indexOf('host.appendChild(this.canvas)');
    expect(measured, 'expected the pre-append measurement').toBeGreaterThan(-1);
    expect(appended, 'expected the canvas append').toBeGreaterThan(-1);
    expect(measured, 'the measurement must come first').toBeLessThan(appended);
  });

  it('holds the host at the spread ratio, not the canvas ratio', () => {
    // Left alone, the host inherits the drawing buffer's ratio — a property of
    // the canvas, not of the book. Measured on a 700px host: 350px tall, and a
    // book that should be 596px wide rendered at 410px.
    expect(source('bookstand.ts')).toMatch(/this\.options\.aspect \* 2/);
  });
});

describe('start-at attribute', () => {
  it.each([
    ['cover', 'cover'],
    ['first-spread', 'first-spread'],
    ['2', 2],
    ['0', 0],
  ])('parses %s', (input, expected) => {
    expect(parseStartAt(input)).toBe(expected);
  });

  it.each(['', '   ', 'firstspread', 'page two', 'NaN'])(
    'refuses %j rather than guessing',
    (input) => {
      // `Number('')` is 0, so a typo would otherwise open the book at the cover
      // and look deliberate. Undefined lets the configured default stand.
      expect(parseStartAt(input)).toBeUndefined();
    },
  );
});
