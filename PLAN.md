# Bookstand — Plan

A small, fast, beautiful page-flip book for the web.

**Content model (settled):** a page **is an image** — a scan, a screenshot, an exported artboard. One
file, one page, fixed dimensions, nothing to measure or lay out. A book is an optional front cover,
double-page spreads for the interior, and an optional back cover.

The library never looks inside a page. It has no concept of text, no typography, no layout engine, no
document format. Given that, the entire value of this library is *how it looks and how it feels to turn
a page* — which is why the plan spends its effort on motion (§4), material (§5), and image delivery
(§6), and nowhere else.

**Targets (settled):** plain HTML page first, then React and Svelte. Framework-agnostic core with thin
adapters above it.

**Rendering (settled):** WebGL only. Browsers from roughly the last 6–8 years — see §9 for the exact
baseline and the one tradeoff it involves.

---

## 1. What we learned from StPageFlip

StPageFlip (`/StPageFlip`, MIT, Nodlik) is the closest prior art and a genuinely good reference. It is
worth being precise about what to keep and what to replace, because the gap between it and Apple Books
is almost entirely in a handful of specific decisions.

### Keep — the geometry model is sound

`Flip/FlipCalculation.ts` models the flipping page as a **rigid rectangle rotated about the dragged
corner**, then finds where that rectangle crosses the book's boundary (`calculateIntersectPoint`) and
emits two clip polygons: one for the flipping page (`getFlippingClipArea`) and one for the page
revealed beneath it (`getBottomClipArea`). `checkPositionAtCenterLine` constrains the dragged corner to
a circle of radius `pageWidth` around the spine, which is exactly right — a page corner physically
cannot travel further than the page is wide.

This is cheap, numerically stable, and it is the correct *silhouette*. We keep this model. We will
re-derive it rather than copy it, but the approach is proven and we should not invent a new one.

### Replace — nine things, in rough order of how much they cost the experience

**1. Animation is a precomputed array of one-pixel steps, played back linearly.**
`Helper.GetCordsFromTwoPoint` builds one `Point` per pixel of corner travel; `Flip.animateFlippingTo`
wraps each in a closure; `Render.render` picks a frame with
`round((timer - startedAt) / durationFrame)`. Consequences:

- **Linear easing, always.** No ease-out, no settle. A real page decelerates as it falls. This single
  fact is the biggest reason StPageFlip reads as "a web animation" and Apple Books reads as "paper".
- **Velocity is discarded entirely.** `stopMove()` decides purely on position (`pos.x <= 0`). A fast
  flick and a slow crawl to the same point produce identical 1000 ms linear animations. There is no
  momentum, so a quick flick that only travels 30% of the way snaps *backwards* — the opposite of what
  the gesture asked for.
- Allocates hundreds to thousands of closures per flip.

> **Replacement:** a critically-damped **spring** integrated per frame, seeded with the pointer's real
> release velocity. Tap-to-flip uses the same spring with a synthetic initial velocity, so taps and
> drags settle identically. Details in §4.

**2. The render loop never stops.**
`Render.start()` schedules `requestAnimationFrame(loop)` unconditionally, forever. `drawFrame()` then
iterates every page and writes `style.cssText` on each — on every frame, for the life of the page, on
a book nobody is touching.

> **Replacement:** demand-driven rendering. rAF runs only while the state machine is out of `idle`,
> plus one frame after settling. An untouched book costs zero.

**3. Per-frame style writes are CSS string concatenation.**
`HTMLRender.drawInnerShadow` and friends build multi-line template literals — including a
`clip-path: polygon(...)` assembled by string append — and assign them to `style.cssText` every frame.
The browser re-parses CSS 60–120 times a second.

> **Replacement:** a static stylesheet plus a handful of numeric CSS custom properties updated per
> frame; `transform` written directly. In the WebGL renderer this problem disappears — per frame we
> update a few uniforms.

**4. Layout reads inside the write phase.**
`getBlockWidth()`/`getBlockHeight()` read `offsetWidth`/`offsetHeight`, reachable from `getRect()`
during a frame → forced synchronous reflow mid-animation.

> **Replacement:** dimensions cached, invalidated by `ResizeObserver`. Never read layout during a frame.

**5. Resize is `window.addEventListener('resize')`.**
Misses container resizes with no window resize (flex/grid reflow, sidebar toggle, split pane). Also the
`UI` constructor adds a resize listener *and* `setHandlers()` adds a second one, while `removeHandlers()`
removes only one.

> **Replacement:** `ResizeObserver` on the host element. One listener, correct teardown.

**6. Touch has a 250 ms dead zone before the page responds.**
`UI.onTouchStart` wraps `startUserTouch` in `setTimeout(..., this.swipeTimeout)` so it can disambiguate
swipe from fold. For a quarter of a second after you touch the page, nothing moves.

> **Replacement:** unified **Pointer Events** with `setPointerCapture` (one code path for mouse, touch,
> pen; dragging outside the element keeps working). Respond on the first move. Disambiguate with a
> *directional intent lock* — compare |dx| vs |dy| over the first ~6 px and commit to either flipping
> or page-scrolling. Zero latency, no timer.

**7. No accessibility.**
No ARIA, no keyboard navigation, no focus management, no `prefers-reduced-motion`, nothing announced on
page change. For an image gallery, per-page alt text is the whole accessible content.

> **Replacement:** §7.

**8. No image strategy.**
`ImagePageCollection` takes a list of URLs and that is the extent of it. For a library whose content is
*only* images, loading is the dominant performance variable: decode timing, preload window, memory
ceiling, responsive sources, placeholders.

> **Replacement:** §6.

**9. `Settings.getSettings()` mutates shared state.**
```ts
const result = this._default;        // reference, not a copy
Object.assign(result, userSetting);  // mutates the default for every future instance
```
Two books on one page contaminate each other. A real bug; noting it mostly as a reminder that our
config layer must be pure.

Also worth knowing: build tooling is 2020-era (webpack 4, rollup-plugin-typescript2, ESLint 2.x
TypeScript plugin), there is no ESM exports map, and Safari is detected by user-agent regex to work
around a `clip-path` bug.

### Does StPageFlip support cover layout and start position? Mostly yes — with two flaws

You asked, so: `Collection/PageCollection.ts` does implement it. With `showCover: true`, `createSpread()`
pushes page 0 as a lone single-page spread, and `showSpread()` places a lone page as
`left = null, right = page` — unless it's the last page, in which case `left = page, right = null`.
That is exactly the cover-right / back-cover-left behaviour you described. And space *is* reserved:
`calculateBoundsRect()` always sets `width = pageWidth * 2` in landscape, so the footprint never shifts.

Two flaws we must not inherit:

- **Density is inferred from position, not from meaning.** `createSpread()` marks the last page `HARD`
  unconditionally. A book with a front cover and an even interior but *no* back cover gets its final
  interior page rendered as a stiff cover. Covers must be declared, not guessed.
- **No meaningful start-position control.** `startPage` is a flat page index, which collides awkwardly
  with spread pairing, and there is no way to express "open at the cover" versus "open at spread 4".

Our model (§3) fixes both by making the sheet structure explicit.

### The one thing StPageFlip cannot do

The flipping page stays **perfectly flat**. It is a rigid rectangle rotated in the plane, with gradient
shadows painted on top to suggest depth. Real paper — and Apple Books — curls: the sheet wraps around a
soft cylinder near the fold, which produces a curved silhouette, a bright specular band along the curl,
a real cast shadow on the page beneath, and a glimpse of the page's own back face.

You cannot get that from a rotated rectangle and a `clip-path`. You get it from a deformed mesh.

**And this is where our content decision pays off.** The argument against a WebGL renderer is normally
that a GPU renderer has to rasterize whatever the page contains before it can deform it, which is
ruinous for a reader rendering live content. A scan is already a bitmap. It uploads as a texture
directly — no rasterization step, no snapshot-and-swap, nothing lost in the conversion. The standard
objection to doing this properly simply does not apply to us.

---

## 2. Architecture

```
@bookstand/core          book model · state machine · geometry · physics · input · events
  └── renderer            WebGL: deformable mesh, lighting, shadows
@bookstand/element       <book-stand>  custom element                  ← static HTML target
@bookstand/react         <Bookstand /> thin binding over core
@bookstand/svelte        <Bookstand /> thin binding over core
```

**One renderer, not two.** Dropping old-browser support removes the CSS fallback renderer entirely, and
that is a real simplification — no second implementation to keep visually in sync, no divergence in
feel, one less package, a smaller bundle. Reduced motion becomes a *mode inside* the WebGL renderer
(cross-fade between spreads instead of curling), not a separate code path. The only non-WebGL path left
is progressive enhancement: if the module never loads or a context can't be created, the markup renders
the images in document order. Content is never lost; it just isn't a book.

The core never touches a canvas or an `<img>`. It owns the truth — which pages are where, what the fold
line is this frame, how the spring is settling — and hands a plain **frame state** object to whichever
renderer is mounted:

```ts
interface FrameState {
  spread: { left: PageRef | null; right: PageRef | null };
  flip: null | {
    page: PageRef;          // the sheet in motion
    behind: PageRef | null; // revealed beneath it
    backFace: PageRef | null;
    fold: { origin: Point; normal: Vec2; radius: number }; // fold line + curl tightness
    progress: number;       // 0..1
    direction: 'forward' | 'back';
    rigid: boolean;         // covers hinge instead of curling
  };
  zoom: { scale: number; offset: Point };
}
```

Keeping this boundary even with a single renderer is still worth it: it is what makes the core testable
without a GPU, and it is the seam we'd use if a 2D-canvas or CSS renderer ever became necessary again.

---

## 3. Book model

Structure, as specified:

```ts
{
  cover?:     Image,                       // optional · single · rigid · sits on the RIGHT
  spreads:   [{ left: Image, right: Image }],  // interior · soft paper · fills both halves
  backCover?: Image                        // optional · single · rigid · sits on the LEFT
}
```

Both covers are optional — a book may be interior spreads only, or spreads plus one cover.
**No endpapers:** flipping the cover reveals the first spread directly. Anyone who wants an inside-cover
just adds an image.

### Sheets and faces — the one idea the whole model rests on

A page-flip book is not a list of pages. It is a list of **sheets**, each with a **front face** and a
**back face**, and a spread is what you see when a stack of sheets is split at some point. Getting this
right up front makes every other question (pairing, covers, start position, reserved space, what's on
the reverse of a flipping page) fall out automatically instead of needing special cases.

Flatten everything into an ordered list of faces, then pair consecutive faces into sheets:

```
cover + 2 spreads + backCover
faces:  [ Cover, S1.left, S1.right, S2.left, S2.right, BackCover ]
sheets: [ Cover | S1.left ] [ S1.right | S2.left ] [ S2.right | BackCover ]
          ^front  ^back
```

Now read off the states — with *N* sheets there are *N+1* of them, one for each split point:

| state | left half | right half | |
|---|---|---|---|
| 0 | *(reserved)* | Cover | closed book |
| 1 | S1.left | S1.right | spread 1 |
| 2 | S2.left | S2.right | spread 2 |
| 3 | BackCover | *(reserved)* | closed from the back |

Each state's left half is the *back* of the sheet to its left, and the right half is the *front* of the
sheet to its right. That is also exactly what the renderer needs mid-flip: the face on the reverse of
the turning sheet is already in the model, not computed as a special case.

**Optional covers fall out of padding.** Prepend a `null` face when there is no cover; append one when
that leaves an odd count. Then drop any state whose visible content is entirely `null`:

```
no cover, 2 spreads, no backCover
faces:  [ null, S1.left, S1.right, S2.left, S2.right, null ]
sheets: [ null | S1.left ] [ S1.right | S2.left ] [ S2.right | null ]
states:  0 ✗(empty)         1 = spread 1           2 = spread 2         3 ✗(empty)
valid range: 1 … 2
```

One rule, no branching on which covers exist. It handles all four combinations, and it is why the
back cover correctly ends on the left "as it would in a normal book" without any code saying so.

### Reserved space — the book never changes size

The book's footprint is **always the full spread width**, in every state. At the cover, the right half
holds the cover and the left half is empty but occupied — reserved for where the cover will land. At
the back cover, the mirror. Nothing resizes, nothing jumps, and opening the book doesn't shove the
surrounding page layout around.

> This corrects my earlier draft, which proposed centering the closed cover and sliding it right on
> first flip. Reserving is the better call — a layout shift on the very first interaction is exactly
> the kind of thing that reads as cheap.

The reserved half is transparent by default so the host page's background shows through, with an
optional surface colour. The closed book also gets its fore-edge page stack (§5) on the open side,
which is what makes a cover-only state read as *a closed book* rather than *one image floating next to
a gap*.

### Start position

```js
startAt: 'cover' | 'first-spread' | number   // number = spread index
```

Defaults to `'cover'` when a cover exists, `'first-spread'` otherwise. Out-of-range values clamp to the
valid state range rather than throwing. The initial state is set directly — no opening animation on
load unless asked for.

### Density

`rigid` for covers, `soft` for interior — **derived from the declared structure, not from position in
the array.** Rigid sheets hinge about the spine instead of curling (a hardcover doesn't bend). This is
the flaw in StPageFlip's `createSpread()` that we're deliberately avoiding.

### Layout — a spread, always

There is no single-page mode. The gesture this library exists for is turning one leaf of an open book,
and a lone page has no spine to turn about; a "single page" layout would be a different, lesser product
sharing a name. On a narrow container the spread simply gets smaller.

This deleted `LayoutMode`, `ResolvedMode`, `minPageWidth`, the breakpoint hysteresis and the renderer's
single-page branch — `computeLayout` went from a mode machine to nine lines of arithmetic.

---

## 4. Motion — the part that matters

### Parameterization
One set of values drives every flip, whether dragged or tapped: the **fold line** (a point and a
normal, in page space) plus a **curl radius**. Drag sets it from the pointer. Tap synthesizes a corner
path and sets it from that. There is no separate "animated flip" code path — which is exactly why taps
and drags will feel like the same object.

The dragged corner is constrained to a circle of radius `pageWidth` about the spine (StPageFlip's
`LimitPointToCircle`, and it's correct). The fold line is the perpendicular bisector between the
corner's rest position and its current position.

### Spring, not duration
A critically-damped spring on flip progress:

```
  a = -k·(x - target) - c·v      c = 2·√k   (critical damping: settles fast, never overshoots)
  v += a·dt
  x += v·dt
```
Fixed-timestep accumulator (≈120 Hz substeps) so behaviour is identical on 60 Hz and 120 Hz displays —
a frame-rate-dependent spring is a bug that only shows up on someone else's machine. Terminate on
`|x - target| < ε && |v| < ε`, with a hard duration ceiling as a safety net.

### Release decision
On pointer up, with velocity from an exponential moving average over the last ~100 ms:

```
complete = projectedProgress(x, v) > 0.5  ||  v > flickThreshold
```
Then seed the spring with the actual release velocity. A fast flick at 20% travel completes. A slow
drag abandoned at 60% falls back. This is the behaviour StPageFlip's position-only check gets wrong,
and it is most of what people mean when they say an interaction "feels right".

### Tap path
Tapping the right edge shouldn't animate the corner in a straight line to the left edge — real pages
arc. The synthetic corner path is a shallow quadratic curve with the corner rising slightly before
falling, driven by the same spring.

### Curl radius
`R` shrinks as the flip progresses: broad, gentle curl on first lift; tight near the spine. Clamped to
`[Rmin, Rmax]` derived from page width so it scales with the book. A page lifted 5% should look like a
sheet barely peeled up, not a tube.

### Reduced motion
`prefers-reduced-motion: reduce` → the renderer cross-fades between spreads: no curl, no corner peek,
no spring. Same renderer, same API, a mode flag. Navigation stays fully functional.

---

## 5. Rendering craft

Hand-rolled WebGL, no three.js. One shader program, one quad mesh per visible page at ~24×32
subdivisions. Pages are images, so they are textures directly — no intermediate rasterization.

**WebGL 1 is the baseline, WebGL 2 is an upgrade when present.** Nothing here needs WebGL 2: one
program, a handful of textures, no instancing, no transform feedback. See §9 for why the baseline
matters.

**Vertex stage — cylindrical curl.** In a frame aligned to the fold line, let `u` be distance past the
fold. The sheet wraps a cylinder of radius `R`:

```
  u < πR :   x' = R·sin(u/R)          z' = R·(1 − cos(u/R))     // on the cylinder
  u ≥ πR :   x' = −(u − πR)           z' = 2R                   // flat, folded back over
```
Points before the fold line are untouched. The surface normal falls out of the derivative analytically,
which gives correct lighting for free — no normal buffer, no recompute.

Rigid pages (covers) skip the curl and hinge about the spine with a perspective projection instead.

**Fragment stage — the details that sell it.**

- **Diffuse** `N·L`, light up and to the left.
- **Broad specular** — Blinn-Phong with a low exponent (~8–16). Paper has a wide, weak sheen; this is
  what makes the curl read as coated stock rather than matte cardboard.
- **Gutter occlusion** — a soft darkening toward the spine on both resting pages. Static, nearly free,
  and it is the single strongest "this is a physical book" cue. Present even when idle.
- **Cast shadow** — the curled sheet darkens the page beneath it. Computed analytically per fragment
  from the fold line and curl height rather than a shadow-map pass: cheaper, smoother, no aliasing.
- **Back face** — the reverse of a flipping sheet shows the *next* page's image, mirrored and darkened.
- **Show-through** — paper is slightly translucent. Mix a faint mirrored sample of the front face into
  the back face at low alpha. Almost nobody implements this and it is immediately recognizable as real.
- **Leading edge** — a 1–2 px brighter rim along the curl's cut edge catching the light.

**Page thickness.** The remaining unread pages show as a stack at the fore-edge — a few thin strips
whose count tracks progress through the book, thinning on the left as they thicken on the right.
Apple Books does this. It costs almost nothing and it is a large part of why the object reads as a book
rather than two rectangles.

**Texture quality — the one place WebGL 1 bites.** A curled page minifies its texture sharply in the
curl region, and a minified texture without mipmaps shimmers and crawls as it animates. That would
undo much of the craft above. WebGL 1 cannot mipmap non-power-of-two textures, and book scans are never
conveniently sized. So on upload: draw the image into an offscreen canvas at the next power-of-two,
generate mipmaps, and use trilinear filtering (`LINEAR_MIPMAP_LINEAR`). Costs ~33% extra texture memory
and one canvas draw per image. On WebGL 2, skip the padding — NPOT mipmaps work natively.

Also enable anisotropic filtering via `EXT_texture_filter_anisotropic` where available; at grazing
angles near the fold it is very visible and the extension is near-universal.

**Texture memory.** LRU cache bounded by count (default 8). Distant pages release their GPU textures
and re-upload on approach. A 300-page image book must not hold 300 textures.

**Context loss.** Handle `webglcontextlost` / `webglcontextrestored` — rebuild textures from the decoded
image cache. If restoration fails outright, tear down to the static-image fallback. Mobile Safari will
do this to us under memory pressure, and a book that dies on a backgrounded tab is a bug report.

---

## 6. Image pipeline

For an image-only library this *is* the performance story.

```ts
type Page = {
  src: string;
  srcset?: string; sizes?: string;   // responsive sources
  alt: string;                       // required — this is the accessible content
  width: number; height: number;     // for aspect ratio before load
  placeholder?: string;              // LQIP data-URI or a dominant colour
};
```

- **Preload window** — current spread ±1 spread by default, configurable. Beyond the window, nothing is
  fetched.
- **Decode before display** — `await img.decode()` so a page is never presented mid-decode. Decoding a
  large JPEG on the main thread at the moment of a flip is a guaranteed frame drop.
- **Never block a flip on a load.** If the incoming page isn't ready, show the placeholder and
  cross-fade the real image in over ~120 ms when it lands. A flip that stalls waiting on the network is
  worse than a flip to a blurred page.
- **Aspect ratio from `width`/`height`** so layout is stable before anything loads — no size pop.
- **Eviction** — decoded bitmaps and GPU textures released outside a wider retention window.

---

## 7. Interaction & accessibility

**Input**
- Corner drag — pointer capture, immediate response.
- Swipe anywhere on the page — directional intent lock over the first ~6 px.
- Tap/click left or right region → prev/next, with a configurable centre dead zone so tapping the
  middle of an image doesn't turn the page.
- Corner peek on hover (desktop) — a small spring-driven lift that follows the cursor, hinting the
  affordance. Cheap and charming; StPageFlip has this and it's one of its best touches.
- Horizontal wheel / two-finger trackpad swipe — accumulate `deltaX` and drive the flip directly.
  Desktop users expect this and it is rarely implemented.
- Pinch-zoom and double-tap-to-zoom on a spread, with pan. Flipping is locked while zoomed; zooming out
  restores it.

**Accessibility**
- The host is a `role="region"` with an accessible name; pages carry their `alt` text.
- Full keyboard control: `←`/`→`, `PageUp`/`PageDown`, `Home`/`End`, `Space`. Visible focus ring.
- A polite live region announcing "Pages 12–13 of 84" on settle (debounced, so a fast run of flips
  announces once).
- `prefers-reduced-motion` honoured throughout.
- A non-JS / no-renderer fallback that renders the images in document order, so the content is never
  lost.

---

## 8. Public API (first draft)

```js
import { Bookstand } from '@bookstand/core';

const book = new Bookstand(element, {
  cover:     '/cover.jpg',                    // optional
  spreads:  [['/1L.jpg', '/1R.jpg'], ...],    // or objects with alt, srcset, placeholder
  backCover: '/back.jpg',                     // optional

  startAt: 'cover',              // 'cover' | 'first-spread' | <spread index>

  // Springs, not durations — gesture motion has to carry the velocity the
  // hand gave it. Defaults come from motion/tokens.ts.
  motion:  { settle: { stiffness: 340 }, recoil: { stiffness: 480 },
             peek: { stiffness: 160 }, flickVelocity: 1.6 },
  curl:    { minRadius: 0.06, maxRadius: 0.35 },   // fractions of page width
  render:  { gutter: 0.06, focal: 4, maxMagnification: 1.08 },

  interactions: { drag: true, tap: true, peek: true, keyboard: true },

  preload: 1,
});

book.next(); book.prev();
book.goTo(12, { animate: true });
book.on('change', ({ index, spread }) => {});
book.on('flipstart' | 'flipend' | 'zoom', handler);
book.destroy();
```

Static HTML:
```html
<script type="module" src="/bookstand.js"></script>
<book-stand src="/book.json" mode="auto"></book-stand>
```

React and Svelte wrappers are bindings only — props in, events out, no logic. If a wrapper starts
growing behaviour, that behaviour belongs in the core.

---

## 9. Repo & tooling

As built (Phase 7 collapsed the four packages into one — see there for why):

```
bookstand/
├─ packages/bookstand/   the library; entry points "." and "./element"
├─ demo/                 static HTML playground — the primary dev target
│  └─ reference/         side-by-side harness vs StPageFlip; the bundle is
│                        fetched from npm at runtime and never committed
├─ example/              the scans the demo and tests run against
├─ README.md
└─ PLAN.md
```

pnpm workspaces · TypeScript strict, with `noUnusedLocals`/`noUnusedParameters` on · esbuild for the
bundles and `tsc` for declarations · Vitest for unit tests · Playwright for interaction and visual
regression *(still to come)* · a dependency-free gzip check in `build.mjs` enforcing the budget
below, which fails the build rather than warning.

### Attribution — settled

> Note 2 below asked for a deliberate call rather than an accident. This is the call.

**No StPageFlip source is included anywhere in this repository or in the published package.** The
fold geometry was re-derived. The published tarball contains `dist/`, `README.md` and `LICENSE` and
nothing else, so the MIT obligation to retain a copyright notice alongside copied code is not
triggered — there is no copied code to attach it to. Adding a `NOTICE` implying bundled third-party
code would be *less* accurate than not having one.

**What is owed regardless of licence is credit, and it is given.** The geometric model — the turning
sheet as a rigid shape rotated about the dragged corner, the corner tethered to a circle about the
spine — is StPageFlip's, and §1 keeps it on purpose because it is right. That is stated in the
package README under *Prior art*, in the root README, and at the points in the source where the two
implementations diverge (`geom/vec.ts`, `geom/fold.ts`, `motion/spring.ts`, `motion/tokens.ts`,
`flip-controller.ts`).

**Tone matters as much as accuracy.** §1 and the phase logs below are an engineering record and name
specific defects measured in 2.0.7; that is fair comparative use and it is how the decisions here
were arrived at. The *public* README makes the other half of the point explicit: the differences are
of aim, not of quality, and for a flipbook that must hold live HTML content StPageFlip is the better
tool. A reader should finish either document knowing exactly what was borrowed, what was not, and
why the two exist.

The comparison bundle in `demo/reference/` is fetched from npm at runtime by `reference/fetch.mjs`
and is gitignored — third-party MIT code we compare against, never commit and never redistribute.

**One housekeeping note on the current folder:**
1. `StPageFlip/` contains its own `.git` directory. Once we `git init` here it will behave as an
   unintended nested repo. Keep it out of the tree entirely, or add it as a proper submodule —
   nothing in the build, the tests or the package depends on it being present.

### Browser baseline

"Last 8 years" lands in 2018, and there is one awkward fact in the way. WebGL itself is not the
constraint — WebGL 1 has been universal since ~2013. The constraints are the two modern DOM APIs the
plan leans on:

| API | available from | |
|---|---|---|
| WebGL 1 | Safari 8 · Chrome 33 | not a constraint |
| Pointer Events | **Safari 13** (Sep 2019) | Safari 12 has none |
| ResizeObserver | **Safari 13.1** (Mar 2020) | |
| WebGL 2 | Safari 15 (Sep 2021) | opportunistic only |

So a clean, polyfill-free baseline is **Safari 13.1+ / Chrome 84+ / Firefox 79+ / Edge 84+ — 2020
onward, about six years.** Reaching a true 2018 baseline means shipping a Pointer Events polyfill plus a
ResizeObserver polyfill, roughly 3–4 kB gzipped, to serve a fraction of a percent of traffic.

**Recommendation: take the 2020 baseline** and skip both polyfills. If 2018 turns out to be a hard
requirement for a specific deployment, we add a separate `@bookstand/core/compat` entry point that
bundles them, so the cost lands only on the projects that ask for it. Flagging rather than deciding
silently, since you named eight years specifically.

### Bundle budget

Gzipped, enforced in CI — a budget nobody checks is not a budget. Dropping the second renderer buys us
room, so these are tighter than the first draft:

| | target |
|---|---|
| `@bookstand/core` (incl. WebGL renderer) | ≤ 14 kB |
| `<book-stand>` element | + ≤ 2 kB |
| React / Svelte wrapper | + ≤ 1 kB |
| optional `compat` polyfill entry | + ~4 kB |

**Performance targets:** sustained 60 fps on a 2019 mid-range Android during a drag; zero main-thread
work when idle; no forced synchronous layout during a flip (asserted via a scripted Playwright trace).

---

## 10. Phases

Each phase ends with something runnable. Sequenced so the *feel* is established early and proven on the
simple renderer before we spend effort on the fancy one — if the motion is wrong, a beautiful curl will
not save it.

**Phase 0 — Scaffolding** — ✅ *done*
pnpm workspace, TypeScript strict (ES2020 lib, enforcing the §9 baseline), Vitest, `@bookstand/core`
building to ESM + declarations. Still to add: CI and `size-limit`, which wait on there being a bundle
worth measuring.

**Phase 1 — Core, headless** — ✅ *done · 75 tests passing*

| module | what it owns |
|---|---|
| `model/book.ts` | faces → padding → sheets → states, reachable range, `startAt` |
| `geom/fold.ts` | corner tether, fold line, progress, curl radius, corner paths |
| `motion/spring.ts` | critically-damped spring at a fixed substep; `projectedRest` |
| `motion/velocity.ts` | sliding-window pointer velocity |
| `flip-controller.ts` | position, drag/release, animated flips, `FrameState`, events |

The four-cover-combination table is in `test/book.test.ts` and behaves as the specification. Geometry
invariants, spring convergence, frame-rate independence and the release decision are covered too.

Two notes from building it:

- **Velocity uses a sliding window, not the EMA sketched in §4.** An EMA seeded by a slow drag lags
  badly when the finger accelerates just before release — which is exactly the gesture that has to be
  caught. There's a test for that specific case.
- **The spring is bit-identical at 60 Hz and 120 Hz**, not merely close (measured divergence `0`).
  Removing the fixed substep takes it to `4.2e-2`, so the test has four orders of magnitude of margin.

**Phase 2 — Minimal renderer + demo** — ✅ *done · 86 tests passing*

WebGL renderer with a **rigid hinge** rather than flat quads — covers need that permanently, so it is
Phase 4 work done early rather than throwaway scaffolding. Plus `layout.ts`, `TextureStore`, the
`Bookstand` facade (demand-driven rAF, `ResizeObserver`, click-halves and arrow keys), and a Vite demo
at `demo/` running against the real scans.

Verified in headless Chrome over CDP: cover renders right-half with the left reserved, back cover
left-half with the right reserved, back-face textures select and mirror correctly, and the footprint
never shifts.

Three things the first render taught us:

- **Perspective magnification overflowed the footprint.** A sheet tilting toward the viewer is enlarged
  by the perspective divide — about 9% at the angles where it is widest — so it rendered outside the
  book rect and clipped against the canvas edge, visibly slicing the top off the turning page. Fixed by
  clamping the divide (`max(1 - z/focal, 1/maxMagnification)`) and reserving exactly that much headroom
  in the layout. The two are derived from one value in `Bookstand` so they cannot drift apart; a
  regression test asserts `bookHeight × headroom` still fits. Measured after the fix: zero frames touch
  either canvas edge across a full flip.
- **The scans already have gutter shading baked in.** Page 14 is a verso and the darkening sits on its
  right edge, the spine side. Our own gutter default is therefore low (0.06) — §5's gutter occlusion has
  to be tuned against real scans, not added blind on top of them.
- **NPOT aliasing is real and visible**, exactly where predicted: at edge-on angles the minified texture
  shimmers. This confirms the power-of-two/mipmap upload path in Phase 4 is necessary, not precautionary.

Deliberately provisional: **single-page mode** renders the leading half only and still needs a proper
design for where the spine goes. **Input** is click-halves plus keyboard — real gestures are Phase 3.

**Phase 3 — Drag and physics** — ✅ *done · 110 tests passing*

Drag-to-turn is the reason this library exists, so the reference was measured rather than read, and
every fix is verified against the same measurement.

| Defect in StPageFlip 2.0.7 | Measured there | Measured here |
|---|---|---|
| Velocity ignored on release | 140 px at 90 ms and at 700 ms → *identical* outcome, both fall back | flick turns, crawl falls back |
| Release has no easing | 0.12 pp from a straight line over the whole settle | 22.7 pp — genuinely eased |
| Corner teleports to the grab point | 3.4% / 23.3% / **38.4%** for the same 20 px nudge at 95/55/25% across | **3.1% / 3.1% / 3.1%** |
| Touch dead on contact | 278 ms before the page moves (250 ms `setTimeout`) | 6 ms |

New: `motion/tokens.ts` (three springs, four scalars), `input/pointer.ts` (Pointer Events, capture,
directional intent lock, delta grab, velocity), controller peek/drag/settle modes and mid-settle
re-grab.

**Motion character.** `settle` k=340 — 50% at 100 ms, 90% at 232 ms, landed at 448 ms. Longer than the
sub-300 ms budget that governs dropdowns, deliberately: this is not chrome reacting, it is the content
moving under simulated physics, and it is the one motion the reader is watching. `recoil` k=480 is
stiffer so a refusal leaves faster than a confirmation arrives. `peek` k=160 is the softest thing that
moves.

**Two bugs the adversarial pass caught that unit tests could not:**

- **Rapid taps were swallowed.** Five taps in a second advanced two spreads: each arrived mid-settle and
  `animate()` dropped it. A tap during a settle now lands the flip in flight and starts the next.
- **A rejected vertical drag left a corner peeked.** Once the intent lock released the grab, the next
  move re-entered the hover path with the button still down. Peek now requires an empty hand.

**Deliberately not animated:** keyboard flips (gate disqualifier — a reader holding `→` is already
faster than any animation) · corner lift on `pointerdown` (would fire a false lift on every tap) ·
end-of-book rubber band (there is genuinely no sheet to lift; a clean refusal beats a fake bounce) ·
peek on touch · any smoothing between finger and page.

**Not verified:** physical touch hardware, and the fresh-eyes pass. Both need a person and a day.

**Phase 4 — Curl and material** — 🟡 *curl done · 121 tests passing · material partial*

The corner fold now exists. Before this, `geom/fold.ts` computed `origin`, `normal` and `radius` every
frame and the renderer read only `fold.progress`, driving a spine hinge off it — the fold was correct
and simply never drawn, on a 1×1 quad that could not bend. Nothing failed, because nothing checked.

Shipped: cylindrical curl vertex stage on a 24×32 mesh, analytic normals, rigid hinge retained for
covers, depth buffer, cast shadow keyed to the crease, half-Lambert paper shading.

**The reference folds flat; we curl.** Measured on StPageFlip at 18% and 62% progress: the folded
region is a flat plane mirrored across a sharp crease, zero curvature. Real paper doesn't crease when
you turn a page, and Apple Books curls. At high progress the cylinder's flat-return section converges
on the same silhouette anyway, so nothing is lost.

**The radius law was wrong, and it was wrong in the plan.** `R = W·lerp(0.35, 0.06, progress)` puts a
104 px radius under the ~40 px flap of a corner peek: the sheet cannot reach even a quarter turn and
bows the page by 7 px on a 464 px height. Invisible — which is exactly the symptom reported. The radius
follows the *size of the fold*, not progress through the turn:

```
R = clamp(travel / 2π, minRadius·W, maxRadius·W)     min 0.02, max 0.18
```

Half the corner's travel is the paper past the crease, so `travel/2π` is the radius of a half-turn over
that distance. The tip then reaches at least π at every scale — a tight little triangle when barely
lifted, a clamped roll with a flat flap when mostly turned. There is a test asserting exactly that.

**Two rendering bugs found by eye, both invisible to unit tests:**

- **A sheet turning leftward rendered as a dark grey slab.** Mirroring a half flips the triangle
  winding, so `gl_FrontFacing` inverted: the front face sampled the back texture and negated its
  normal. Fixed with `gl.frontFace()` per draw rather than by patching the shader.
- **A cover rotated past vertical was also dark.** That normal was correct — a surface turned 104° from
  an up-left light genuinely is unlit. The fault was full Lambert at 0.62 ambient, far too contrasty
  for paper, which is thin, white and lit by bounce from everywhere. Now half-Lambert at 0.78 ambient:
  the diffuse term sculpts the roll, it does not light the scene.

### Phase 4b — three defects found by using it

The curl shipped above was geometrically real and still looked wrong. All three causes were measured.

| Complaint | Cause | After |
|---|---|---|
| "very low poly folding" | The roll occupies a band `πR` wide — **21 px at peek, against 13.3 px quads: 1.6 quads across a half-turn.** | Normal rebuilt per fragment from the interpolated crease distance, so shading no longer depends on mesh at all; mesh raised to 160×120 for the silhouette. **Median frame 16.6 ms, p95 17.1 ms** — still 60 fps. |
| "magnetism is lost as you get closer" | The corner was placed *at* the cursor, so the lift equalled the cursor's distance and **collapsed on approach: 42 px at 50 px away → 15 px at 15 px → 5 px at 5 px.** | Depth now grows with nearness: **1 → 10 → 26 → 38 → 44 → 47 → 48 px.** The spring drives *how far risen*, the cursor drives *toward what*, so the lift tracks while it rises. |
| "you can only flip until a certain point, then it transports you" | A roll consumes `πR` of page length, so at 100% the free edge reached **x = −140 instead of −319** — bunched under a 114 px hump, which the resting spread then replaced in one frame. | Radius relaxes to zero past `relaxFrom`. Free edge now lands at **−319, exactly** where the spread will draw it. |

**The radius law is a hump, not a ramp.** Both earlier versions were monotonic and each was wrong at
the end it ignored: falling with progress made the corner peek invisible, rising with fold size made
the finished page unable to lie flat. It has to grow with the fold *and* relax as the crease reaches
the spine.

**A shader link failure takes the whole book down.** Vertex defaults to `highp`, fragment to `mediump`,
and GLSL ES requires shared uniforms to agree — so adding one fragment uniform threw in the renderer
constructor and the demo went blank. Every shared uniform and varying now carries an explicit
precision, and a test fails by name if one loses it.

### Phase 4c — four more found by using it

| Reported | Cause | Evidence |
|---|---|---|
| A page darkens under the cursor | Not the shadow. A hovering cursor swaps the resting half for a **lit** sheet, and the lit and unlit paths disagreed on a flat surface — 0.977 against 1.0. | **28,004 changed pixels across the whole half** → **91, in a 42×30 box at the corner.** |
| Centre gutter barely visible | 0.06 max darkening in a narrow band. | Raised to 0.26 with a tunable falloff. It is the only shadow on a still spread and most of what stops two pages reading as two images. |
| Drag sometimes does nothing from the hint | The directional intent lock rejected any grab starting more downward than leftward — and pulling a top-right dog-ear downward is the natural motion. Once rejected the gesture stayed dead however far the reader pulled. | Angle sweep: **0/20/40° worked, 46/50/60/75/90° all dead.** Now all eight engage. |
| Bottom of the page crosses the centre | Only one tether was enforced. | **158 px of spine edge lifted** at the reported drag. Now 0.00 px across five hostile drags. |

**The spine needs two tethers, and it is provable rather than heuristic.** A page is glued along its
whole spine edge, so the crease must leave both ends unlifted: `dot(S − origin, normal) ≤ 0`. Since the
origin is the midpoint of rest→corner and the normal runs along rest−corner, that reduces exactly to

```
|corner − S| ≤ |rest − S|   for each endpoint S of the spine edge
```

— two discs, at radius `pageWidth` and at radius the page diagonal. We enforced only the first, which
is why the sheet could swing loose. StPageFlip arrives at the same second circle by a different route.

**Normalise any shading that only some surfaces receive.** The lit path must agree with the unlit path
where they meet, or the seam shows up as a hover highlight nobody designed.

### Phase 4d — the white flash, and proving the model is shape-independent

**The flash was geometry, not colour.** Grabbing near the right edge and moving 77 px left and 52 px
*up* put the corner at y = −52 — above the page. A corner above the top edge sits on the arc centred on
the **far** spine corner, and on that arc the crease passes through that corner: the fold line lands on
the page diagonal and a page-wide white flap sweeps across the centre, at **9% progress**. The flap is
white paper carrying its own gutter at its own UV, so the spine's dark seam vanishes underneath it —
measured **245 at the spine against 189 at rest**, brighter than plain paper. That is the flash.

Fixed by clamping the dragged corner to the book's vertical span. A page bound at the spine can be
lifted and curled but cannot slide up out of the binding. It is not a wall — horizontal movement still
tracks exactly, so the corner slides along the book's edge the way paper held against a board does.
After the fix the spine holds at **163 through the entire flip**, and the same gesture produces a narrow
corner curl.

> The two-disc tether from Phase 4c was necessary but not sufficient. It forbids the crease *crossing*
> the spine; it permits the crease *passing exactly through* a spine corner, which is the degenerate
> case a small upward drag lands on.

**The gutter now has a core.** One exponential cannot be both broad and defined — the old single
gradient darkened the middle without ever giving it a centre. Two terms: a broad `bowl` for the page
bending into the binding, and a narrow `core` seam at the fold itself, 7× tighter.

**Shape independence is now proved, not asserted** — `test/proportions.test.ts`, 56 cases over seven
aspect ratios from a 0.25 ribbon to a 3.0 panorama, at three page scales each. Every invariant holds:
the spine never lifts, the corner stays in the page, a full turn still completes and relaxes flat, a
peek-sized fold still gets its half turn, the roll still resolves across enough quads, and a small drag
still makes a small fold. That last one fails at **55–56% of the page lifted** on every shape if the
vertical clamp is removed, so the guard has teeth.

Every constant is a fraction of page width, of the diagonal, or unitless. The one deliberate exception
is `intentLockPx`, which is in CSS pixels because it is a property of the hand, not of the page.

### Phase 4e — the gutter was measured in the wrong space

**Reported:** hovering the left page turns its spine white and moves the seam to the page's outer edge.
**Measured:** at rest the left page reads 167 at the spine and 255 at the outer edge; during a backward
peek, 255 at the spine and 178 at the outer edge. Exactly inverted.

The gutter distance came from `vUV.x`, a *texture* coordinate. `uUvFlip` mirrors the UV for the left
half and for backward flips so the image faces the right way — and the gutter silently followed the
image's orientation instead of the book's. `drawFace` compensated with a paired `uGutterSide`;
`drawSheet` hardcoded `uGutterSide = 1` while still flipping the UV, so every backward flip and every
left-corner peek rendered the seam on the wrong edge.

Fixed by deriving it from geometry instead: a `vSpine` varying carrying `aPos.x`, which is the material
point's distance from the binding on **every** surface the renderer draws — both halves, either
direction, front face or back — because book x is always `aPos.x · pageWidth · mirror`. `uGutterSide`
is deleted rather than corrected; the compensating uniform was the bug's habitat.

> The pattern worth remembering: shading that belongs to the *object* must be measured in object space.
> Anything derived from texture coordinates inherits every flip applied for image orientation.

Verified across all five states that can show a gutter — rest, forward peek, backward peek, mid-drag
forward, mid-drag backward — spine darkest, outer edge brightest, in every one.

**Also softened.** 0.20 bowl + 0.17 core was too heavy. Now 0.12 + 0.14, so the total depth is about
what it was before the core existed and the definition comes from the narrow seam rather than from
sheer darkness.

### Phase 4f — the self-shadow: five failures, one cause, one fix

The ask was sound: at small folds the page under a dog-ear *is* the flipping sheet, so a dog-ear with
nothing beneath it floats. Five models each fixed the previous tell and exposed a new one:

| # | Model | How it read |
|---|---|---|
| 1 | decay from the crease, unbounded | a stripe down the whole crease line |
| 2 | clamped to the flap's footprint | a hard cut along the flap's straight tip |
| 3 | ramp across the tip | two lobes, bright notch, shadow detached |
| 4 | decay + gate on the roll clearing a half turn | erased at small folds |
| 5 | decay + gate on the flap existing | monotonic in profile, still wrong on screen |

**One cause behind all five.** The flap sits at `z = 2R` and takes the perspective divide; the page it
shadows sits at `z = 0` and does not. Its rendered silhouette lands **4–25 px outside its material
footprint**, growing with fold size. A shadow computed *on the page in material space* can never align
with where the flap *renders*. Attempt 5 measured as a textbook curve — 170 at −10 px rising to 224 at
−90 px — and still looked detached: the profile was right about the paper and wrong about the pixels.

**The fix is a caster pass, not a better field.** Draw the same mesh through the same vertex path,
displaced onto the page along the light:

```glsl
if (uCast > 0.5) {
  vec3 l = normalize(uLight);
  p = vec3(p.xy - (p.z / max(l.z, 0.2)) * l.xy, 0.0);
}
```

Landing at `z = 0` it takes `w = 1`, exactly like the page receiving it, so caster and receiver share
one projection and cannot drift apart. Alpha falls off with height, so the fold reads as contact and
the raised tip only hints. Drawn between the resting pages and the sheet, with depth writes off.

> **Displaced along the light, not straight down.** Straight down lands back on the material footprint
> and reproduces the original bug exactly. That distinction is the whole fix.

**And the flap was standing too high.** At `maxRadius 0.18` it stood 106 px off a 446 px page —
proportionally a corner hovering 4 cm above an A4 sheet, a tube rather than a fold. At **0.06** it
stands 54 px, reads as paper, and halves the projection gap the caster pass has to close. Cheap change,
large effect; worth making before reaching for shadow machinery.

**Known limit:** the silhouette is geometric, so the shadow's edge is defined rather than blurred. Real
contact shadows are fairly defined, so this reads correctly at the sizes tested. Genuinely soft edges
would need the caster rendered to an offscreen buffer and blurred — two more passes.

> Phase 4i did exactly that, and found the limit was understated: drawn into the scene the caster was
> not merely hard-edged, it was **erased by its own sheet on the half the flap was over**. The two
> extra passes were not a refinement, they were the fix.

### Phase 4g — covers do not bow into the binding

The gutter was applied uniformly to every face, so the cover and back cover got the same broad gradient
at their spine edge as interior paper. That reads as a **stapled booklet** — paper folded at the middle
— rather than a bound book.

Interior paper genuinely curves down into the binding. A cover board does not: it is rigid and meets
the spine at a hinge. `coverGutter` (0.2) scales the gutter down on any face whose role is not
`interior`, and on the turning sheet whenever it is rigid.

The guard counts the *call sites*, not the presence of the uniform: both the face path and the sheet
path have to set it, or a cover inherits whatever the previous draw left behind. Removing either one
fails the test by name.

### Phase 4h — the gutter belongs to the face, not the leaf

Phase 4g's cover fix regressed the pages either side of it: hovering the first or last interior page
flattened its gutter.

A **leaf is rigid when *either* of its faces is a cover** — that rule is correct and deliberate, because
a cover board does not bend and its reverse cannot either. But it means the first and last leaves carry
one cover *and* one interior page. Keying the gutter on the leaf therefore gave the interior page the
cover's flat treatment, and only while that leaf was being drawn as a turning sheet — which is to say,
only under the cursor.

The gutter is a property of the **face**: is *this* surface a board, or paper? So it is now selected
exactly the way the texture is, by `gl_FrontFacing`:

```glsl
float gutterScale = (gl_FrontFacing || uHasBack < 0.5) ? uGutterScale.x : uGutterScale.y;
```

Measured after: the spine holds at 191 → 254 with and without hover, on the cover-adjacent spread and
mid-book alike.

> Third time a bug has come from attaching shading to the wrong thing — texture space instead of the
> binding, deformed position instead of material position, and now the leaf instead of the face. Worth
> asking, of any new shading term: *what does this belong to?*

### Phase 4i — the shadow was an object in the scene, and had to stop being one

**Reported:** the page you are pulling casts no shadow on itself; a shadow appears from the spine only
once the flap crosses it, covering the whole opposite page; and that shadow is sharp, with no blur.
All three were one decision.

Measured before touching anything, by diffing each frame against the same frame with `shadow: 0`:

| Reported | Measured |
|---|---|
| No shadow on the page being pulled | `drawSheet` repaints the whole half *after* the caster. Across five progress points from both corners: **0 changed pixels** on the sheet's own half, every time. |
| A shadow anchored at the spine over the whole opposite page | Not the flap's shadow at all. The analytic `exp(s/falloff)` field on the resting pages is a half-plane keyed to the crease line *extended to infinity*, so it washes the page regardless of the flap's silhouette — mean 2–10/255, and banding visibly at that depth. |
| Sharp, no blur | The geometric caster contributed **15 pixels at 66% progress and none anywhere else** — a dashed hairline where caster and sheet z-fight at the crease. That hairline was the only hard edge on screen. |

**One cause: the shadow was drawn into the scene**, between the resting pages and the sheet. From that
one decision all three follow — it is occluded by the very sheet that casts it, it z-fights the page
where the two are coplanar, and it cannot be blurred, because a shadow rasterised in place is final.
The analytic field was then added to compensate for the caster being invisible, which is why the thing
the reader actually saw was the compensation rather than the shadow.

> A shadow is not an object in the scene. It is a field over the page, and it wants its own buffer.

**The fix.** `render/shadow-map.ts`: the caster renders into a half-resolution off-screen target,
gets a separable Gaussian, and every surface still lying on the page samples it — both resting halves
*and* the flat side of the turning sheet's own crease. Receivers are selected by height (`step(vLift,
0.5)`), not by which draw call they belong to, so the sheet receives the shadow it casts. Because
caster and receiver are both at z = 0 and so both take w = 1, one projection serves both and the
lookup can be `gl_FragCoord` with nothing able to drift.

The analytic field is **deleted**, not corrected — along with `uShadowOrigin`, `uShadowNormal`,
`uShadowFalloff` and the `vBook` varying it needed. Two models of one phenomenon means the wrong one
can be the only one anybody sees.

**A latent bug found on the way.** The caster drew its *flat* region too, blackening the entire
unlifted half at full strength. It was invisible only because the sheet painted over it a moment
later — and it is precisely why the caster could not be lifted out of the scene until it was found.
Only paper that has left the page casts: `if (vFold < 0.0) discard`.

**Softness says distance; opacity does not.** The old model faded the shadow out with height
(`exp(-lift / 0.1w)`, down to 30% at a normal flap), which reads as the shadow disappearing rather
than the paper floating. The caster now carries its height in the red channel, premultiplied exactly
as the blend leaves it, and the blur reads it back to widen the penumbra. Energy conservation in the
Gaussian then lightens a spread shadow for free, which is what a real penumbra does.

Measured after, same probe: the sheet's own half carries **2451–9399 px** of shadow at every progress
instead of 0, at **22–36/255** instead of 2–10, top and bottom corners within ~10% of each other; and
the hardest adjacent-texel step in the map falls from **169 — a full cliff — to 29**.

**Cost: +0.2 ms per frame**, flat across the turn (headless SwiftShader, 940×700 book; a ratio, not a
device figure). The triangle count is unchanged — same mesh, same draw — and the caster's fill is now
a quarter of what it was, because it renders at half resolution in each axis. Two blur passes are
three vertices each over that quarter-area buffer. An idle book still costs nothing: nothing is
captured unless something is casting.

> **Superseded by Phase 4j — this whole system is deleted.** It is kept here because the measurements
> are what justify the refusal, and because the two corrections it does contain are permanent: a
> shadow drawn into the scene is erased by its own sheet, and softness rather than opacity is what
> says how far a caster is. Both were true. They just were not enough.

**One WebGL trap, and it failed silently.** Last frame's map is still bound to its sampler unit when
the next capture begins, and it is also the texture that capture renders into. WebGL rejects that as a
feedback loop: `INVALID_OPERATION`, the draw discarded, the buffer empty on every frame but the first,
and **no console output of any kind**. It surfaced only as a `getError()` probe. Unbind before
capturing.

### Phase 4j — the cast shadow is deleted, and is not to come back

Phase 4i put the shadow in the right place and it still read wrong: **a hard-edged stripe running
alongside the curl**, which at dog-ear scale is the whole of what the system contributed. Isolating it
(frame minus the same frame with `shadow: 0`) shows a single diagonal band, sharply cut on one side.

That cut is the caster's `vFold < 0` discard. A caster has to stop somewhere, and where it stops is the
crease — a dead-straight line clean across the page. **Blurring a straight step edge leaves a straight
edge.** The blur can soften how quickly it arrives; it cannot stop it being a line.

Two things were ruled out by measurement before deleting anything:

- **Misregistration.** The caster projects at `w = 1` while the flap it shadows is magnified ~3% by the
  perspective divide, so the two sit up to 10px apart. Fixed in two lines — keep the pre-flattening `z`
  for the divide — and re-shot: **the band was unchanged.** Worth knowing that 4i's stated reason for
  screen-space sampling was subtly wrong, too. Caster and receiver do *not* need to share a projection;
  the receiver is sampled in screen space, so any screen position works. What has to match is the
  shadow and the *flap*.
- **Whether the fold needs it at all.** With the cast shadow off, the dog-ear still reads. The curl's
  own half-Lambert term off the cylinder normal is what gives a fold its form — not the shadow.

| Deleting it | |
|---|---|
| Frame time | **0.44–0.50 ms → 0.20–0.26 ms**, roughly halved |
| GPU memory | −2 framebuffers, ~2.3 MB *per book instance* at a 1500×761 canvas |
| Code | −248-line module, −second shader program, −3 draw calls, −3 render options, −2 varyings, −8 uniforms |

> **The two shadings that survived did so because they are free.** The gutter at the spine and the
> curl's own diffuse term are a few arithmetic ops inside the pass that was already going to run. No
> buffer, no second program, no option. That is the bar a new shading term has to clear.

**Do not re-add a cast shadow without solving the termination first.** Seven attempts across three
phases failed, and never on the technique: five material-space fields read as detached or cut (4f); a
caster drawn into the scene was erased by the very sheet casting it, 0 surviving pixels on the flap's
own half (4f/4i); an off-screen blurred caster with correct receivers produced this stripe (4i). The
projection, the blur and the choice of receivers have all now been tried and are not the problem.
`test/tokens.test.ts` fails by name if any of the machinery reappears.

**Still to do in this phase:** specular sheen, show-through, leading-edge highlight, fore-edge
page-thickness stack, power-of-two/mipmap upload (the edge-on aliasing from Phase 2 is still there),
anisotropic filtering, visual regression snapshots.

**Phase 5 — Image pipeline** *(~2 days)*
Preload window, `decode()` gating, LQIP, cross-fade, texture LRU, responsive sources.

**Phase 6 — A11y, zoom, polish** *(~2 days)*
ARIA, keyboard, live region, reduced motion, pinch/double-tap zoom and pan, no-JS fallback.

**Phase 7 — Distribution** — 🟡 *static-HTML target done · 215 tests passing*

Brought forward, because the first real consumer is a static site.

**One package, not four.** `@bookstand/core` is now `bookstand`, with two entry points: `bookstand`
for the class and `bookstand/element` for the tag. The element is ~530 B of the bundle and
tree-shakes away when unused, so a second package bought a second version number and nothing else.
The scope in §2 is therefore retired; React and Svelte become further entry points when they exist.

**`tsc` cannot ship a static site.** It emits one ESM module per source file, so a `<script
type="module">` would fetch sixteen of them in a waterfall and the author would have to upload the
whole tree. esbuild now bundles the JS and `tsc` emits declarations only.

> Declarations go to `dist/types/`, not next to the bundles, and that is not cosmetic. `tsc` names a
> declaration after its source, so `dist/bookstand.d.ts` — the types for *`src/bookstand.ts`* alone —
> would land beside `dist/bookstand.js`, the bundle of the whole index. Any tool resolving types by
> matching filename picks the narrower one and nobody finds out for a while. Keeping them apart also
> leaves exactly the two files a static site copies at the top of `dist`.

**`"sideEffects": false` was a live bug waiting for its first bundler.** `import 'bookstand/element'`
binds no names; registering the tag *is* the module. A blanket `false` lets a bundler drop the import
wholesale and the element silently never upgrades. Now an allowlist, with a test asserting it names
the element and nothing else.

**Give it a width and it works out its own height.** The reported shape of this was "I want to set
the width and placement per page". Sizing was already pure CSS on the host — the book is fitted
inside whatever box it gets — but a host with no height took one from the *canvas's* intrinsic ratio,
a property of the drawing buffer rather than of the book. Measured on a 700px-wide host: **350px
tall, and a book that should be 596px rendered at 410px** — about 30% under, arrived at through a
feedback loop between the canvas and its parent. It renders; it quietly renders wrong.

The fix turns on measuring the host *before* the canvas is appended: an element whose height comes
from its own content is zero while it is empty, which distinguishes "the author gave no height" from
"the author gave one" with no heuristics. After: 700 wide → 509 tall → a 596px book, identical to
setting the height by hand. A pixel height rather than `aspect-ratio`, which says it far better but
lands in Safari 15 against the 13.1 baseline in §9 — and since JS creates the canvas anyway, there is
no no-script case for the declarative version to win.

**Budget enforced at last** (§9 asked for this in Phase 0). `build.mjs` gzips each bundle and fails
the build over budget, with no dependency:

| | gzipped | budget |
|---|---|---|
| `bookstand.js` | 11,823 B | 14 kB |
| `element.js` | 12,355 B | 16 kB |

**Verified on a real static page, not in a test harness**: two `<book-stand>` elements on a plain
HTML file served by `python3 -m http.server` — one from `src="/book.json"`, one from inline config at
`start-at="2"` — both sized by CSS alone, both mounting, a real corner drag turning the cover, and
the `change` event crossing the element boundary. The only console error was the page's own missing
favicon.

**Still to do:** React and Svelte entry points, a docs site, and the no-renderer fallback that renders
the images in document order (§2) — today a failed context sets `data-bookstand-error` and leaves the
markup alone, which keeps the page working but does not yet show the book as images.

**Before publishing:** `repository`, `homepage` and `bugs` are deliberately absent because the repo
has no git remote yet; npm will warn until they are added. The name `bookstand` was free on the
registry at the time of writing, but `npm publish` is the final word.

---

## 11. Open questions

**Resolved since the first draft:** endpapers (none — the cover flips straight to the first spread);
covers optional; reserved space rather than a centred cover; WebGL only; back cover rigid and
left-landing.

Still open:

1. **The 2018-vs-2020 baseline** (§9). My recommendation is 2020 with no polyfills; say the word if a
   specific deployment needs 2018.
2. **Fixed page aspect ratio across the book?** Assuming yes — one ratio for the whole book, from config
   or measured from the first image. Mixed ratios are possible but complicate layout considerably, and
   for a scanned book they shouldn't occur.
3. **What does the reserved half look like?** Default is fully transparent, so the host page shows
   through. The alternatives are a configurable surface colour or a soft contact shadow under where the
   closed book sits. Cheap either way; worth seeing on screen in Phase 2 before deciding.
4. **Deep linking.** Should the current spread sync to the URL hash? Trivial to add, easy to leave out;
   worth deciding before the API settles.

---

*This plan is a foundation, not a contract. Phases 3 and 4 in particular will teach us things that
change the phases after them.*
