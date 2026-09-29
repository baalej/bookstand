import { readFileSync, readdirSync, statSync } from 'node:fs';
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

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return full.endsWith('.ts') ? [full] : [];
  });
}

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

describe('attribution', () => {
  // StPageFlip (MIT, Oleg Litovski / Nodlik) is where this library's fold
  // geometry comes from. The model was re-derived rather than copied, so no
  // copyright notice has to travel with it — but the credit is owed regardless
  // of what the licence compels, and the source comments reference it often
  // enough that a reader would rightly wonder if the README did not say so.
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');

  it('credits StPageFlip in the README a consumer actually gets', () => {
    expect(manifest.files, 'the README must ship, or the credit ships nowhere').toContain(
      'README.md',
    );
    expect(readme).toMatch(/StPageFlip/);
    // The person, not the handle. `Nodlik` alone would be satisfied by the
    // repository URL below, which is how this assertion first passed while
    // saying nothing at all.
    expect(readme, 'name the author, not just the project').toMatch(/Oleg\s+Litovski/);
    expect(readme, 'state the licence').toMatch(/MIT/);
    expect(readme, 'link somewhere a reader can verify it').toMatch(
      /github\.com\/Nodlik\/StPageFlip/,
    );
    // The two claims that keep the credit honest in both directions.
    //
    // Matched across whitespace, because prose wraps: the point is that the
    // sentence is present, not that it fits on one line. A guard that forces
    // the README to be reflowed around a regex is a guard nobody will keep.
    expect(readme, 'say plainly that no source was copied').toMatch(/no\s+StPageFlip\s+source/i);
    expect(readme, 'say what it is better at, not only what we changed').toMatch(
      /StPageFlip\s+is\s+the\s+better\s+tool/i,
    );
  });

  it('does not miscast StPageFlip as the text-only one', () => {
    // The tempting shorthand is "we do images, they do text". It is wrong:
    // StPageFlip exposes loadFromImages as well as loadFromHTML — verified
    // against the published 2.0.7 bundle. The real axis is the renderer. DOM
    // elements can hold live HTML *or* images and cannot bend; WebGL textures
    // must be bitmaps and can. Saying it the short way would misstate someone
    // else's project in the very section written to avoid doing that.
    expect(readme, 'name the axis that actually separates them').toMatch(/DOM\s+element/i);
    expect(readme, 'StPageFlip takes images too, and should be said to').toMatch(
      /live\s+HTML\s+\*?\*?or\*?\*?\s+(an\s+)?image/i,
    );
  });

  it('warns that a page of text is a page of pixels', () => {
    // The consequence a reader most needs before committing: text on a page
    // cannot be selected or searched, and reaches a screen reader only through
    // `alt`. Finding that out after building the book is too late.
    expect(readme).toMatch(/selected/i);
    expect(readme, 'point at alt as the accessible content').toMatch(/alt/);
    expect(readme, 'say when to choose the other one').toMatch(
      /content\s+rather\s+than\s+pictures/i,
    );
  });

  it('vendors no third-party source into the package', () => {
    // The comparison harness pulls the published bundle at runtime and is
    // gitignored. If a copy ever lands under src/, the claim above becomes
    // false and the MIT notice obligation becomes real.
    const vendored = sourceFiles(join(ROOT, 'src')).filter((file) =>
      /Copyright|@license|StPageFlip is licensed/i.test(readFileSync(file, 'utf8')),
    );
    expect(vendored, 'third-party code under src/ would need its notice carried').toEqual([]);
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

describe('the resize event', () => {
  const code = source('bookstand.ts');

  it('routes resize away from the controller', () => {
    // `on` forwards to the controller's emitter, which accepts any event name
    // and silently never fires it. Before this existed, `book.on('resize')`
    // in plain JS registered a listener that was never called and threw no
    // error — TypeScript rejected it, a static page did not.
    expect(code).toMatch(/if \(event === 'resize'\)/);
    expect(code, 'resize has its own emitter').toMatch(/events\.on\('resize'/);
  });

  it('announces after the layout settles, not before', () => {
    // A listener reading `metrics` in the handler must see the new size, not
    // the one being replaced.
    const body = code.slice(code.indexOf('private onResize('));
    const measured = body.indexOf('this.layout = this.measure()');
    const emitted = body.indexOf("this.events.emit('resize'");
    expect(measured).toBeGreaterThan(-1);
    expect(emitted).toBeGreaterThan(measured);
  });

  it('stays quiet when nothing moved', () => {
    // Where we own the height, `fitHeight` writes it and that write re-enters
    // onResize, so every real resize arrives twice — measured at four
    // callbacks for two width changes, the second of each pair identical.
    expect(code, 'expected a change guard').toMatch(/signature === this\.announced/);
  });

  it('drops its listeners on destroy', () => {
    const body = code.slice(code.indexOf('destroy(): void'));
    expect(body).toMatch(/events\.clear\(\)/);
  });
});

describe('touch parity with the mouse', () => {
  const code = source('input/pointer.ts');

  it('claims vertical movement on a corner, and only there', () => {
    // `touch-action: pan-y` gives the browser vertical panning, which is
    // right in the middle of the page — a book inside an article must not be
    // a scroll trap — and wrong on a corner, where pulling a dog-ear
    // downward is the natural motion. Measured before the fix: a
    // mostly-downward corner pull produced three pointercancels and no flip,
    // while the identical gesture with a mouse worked.
    expect(code, 'still let the page scroll from mid-book').toContain("touchAction = 'pan-y'");
    expect(code, 'a corner grab has to take the gesture').toMatch(/preventDefault\(\)/);
    // Not passive, or preventDefault is ignored and the listener is decorative.
    expect(code).toMatch(/'touchstart',[\s\S]{0,80}passive:\s*false/);
  });

  it('decides what a corner is in exactly one place', () => {
    // The touch guard claims the gesture from the browser on the way in, and
    // `fromCorner` decides afterwards whether to skip the direction test. If
    // those two drift, a finger takes the gesture and is then told it was not
    // really on a corner — the page neither scrolls nor turns. One predicate
    // makes that unrepresentable.
    expect(code).toMatch(/private grabsCorner\(/);
    expect(code.match(/this\.grabsCorner\(book\)/g) ?? [], 'both callers').toHaveLength(2);
    // The peek's arming zone is a genuinely different question — it has no
    // business asking whether a corner is already lifted — so it keeps its own.
    const peek = code.slice(code.indexOf('private maybePeek('));
    expect(peek).toMatch(/cornerNearness\(book\) < gesture\.peekZone/);
  });

  it('leaves a second finger to the browser', () => {
    // A pinch is a zoom, not a fold.
    expect(code).toMatch(/touches\.length !== 1/);
  });

  it('unbinds the touch listener on destroy', () => {
    const body = code.slice(code.indexOf('destroy(): void'));
    expect(body).toMatch(/removeEventListener\('touchstart'/);
  });

  it('never lifts a corner under a finger', () => {
    // Peek is a hover affordance. On touch every tap would lift a corner the
    // reader never aimed at, so it is gated on the pointer type rather than
    // on the option, which stays true.
    expect(code).toMatch(/pointerType !== 'mouse' && [^)]*pointerType !== 'pen'/);
  });
});
