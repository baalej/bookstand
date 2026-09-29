# bookstand

A small, fast, beautiful page-flip book for the web. WebGL, no dependencies, **~12 kB gzipped**.

A page is an image — a scan, a screenshot, an exported artboard. The library never looks inside one.
What it does instead is make turning them feel like paper: a real cylindrical curl, a spring seeded
with your pointer's actual release velocity, and a book that costs nothing when nobody is touching it.

## Is this the right tool?

**Bookstand is for books that are already pictures.** Scanned volumes, print layouts exported as
pages, photo books, portfolios, zines, comics. Every page is uploaded to the GPU as a texture, and
that one constraint is what buys the curl: a scan is already a bitmap, so there is nothing to
rasterize before the mesh can bend it.

**The cost of that is real and you should know it before you start.** Whatever is on the page is
pixels:

- text cannot be selected, copied, or found with ⌘F
- screen readers get the page's `alt` text and nothing else — so write it properly, it *is* the
  accessible content
- nothing reflows, and nothing responds to the reader's font-size preference
- links inside a page are not clickable
- you need images at roughly 2× the displayed size to stay crisp

If any of that is a dealbreaker, you want a DOM-based flipbook, and
[StPageFlip](#prior-art--stpageflip) is the one to use — it renders real elements, so the text stays
real text. The tradeoff runs the other way: a DOM element cannot bend, so its pages stay flat.

|  | **Bookstand** | **StPageFlip** |
|---|---|---|
| Renders | WebGL textures | DOM elements |
| A page can be | an image | live HTML **or** an image |
| Text on a page | pixels | real, selectable text |
| The turning sheet | curls on a deformed mesh | stays flat |
| Reach for it when | the pages are already pictures | the pages are content |

---

# Using it

## On a static page

No build step, no npm, no JavaScript to write. Copy one file:

```
your-site/
├─ vendor/bookstand.js        ← dist/element.js, renamed
├─ book.json
└─ index.html
```

```html
<book-stand src="/book.json"></book-stand>
<script type="module" src="/vendor/bookstand.js"></script>
```

```json
{
  "cover": "/cover.jpg",
  "spreads": [
    ["/page_1.jpg", "/page_2.jpg"],
    ["/page_3.jpg", "/page_4.jpg"]
  ],
  "backCover": "/backcover.jpg",
  "aspect": 0.688
}
```

Or skip the extra request and declare it inline:

```html
<book-stand start-at="first-spread">
  <script type="application/json">
    { "spreads": [["/1L.jpg", "/1R.jpg"]], "aspect": 0.688 }
  </script>
</book-stand>
```

### Size and placement is ordinary CSS

The book is fitted inside whatever box you give the element — width, `max-width`, margin, a grid
area, all of it works:

```css
book-stand { max-width: 44rem; margin: 2rem auto; }
```

**You do not have to give it a height.** With none, it sizes itself so the book is as large as the
width allows *and* the turning sheet still has room to sweep. Give it a height and it uses that
instead, fitting the book inside.

## From npm

```sh
npm install bookstand
```

```js
import { Bookstand } from 'bookstand';

const book = new Bookstand(document.querySelector('#book'), {
  cover: '/cover.jpg',
  spreads: [['/1L.jpg', '/1R.jpg']],
  backCover: '/back.jpg',
  startAt: 'cover',
});
```

Or register the tag and keep writing markup:

```js
import 'bookstand/element';
```

---

# API

## `<book-stand>`

### Attributes

| | |
|---|---|
| `src` | URL of a book JSON file. Omit it and an inline `<script type="application/json">` is used instead. |
| `start-at` | `cover`, `first-spread`, or a spread index. Anything else is ignored rather than guessed at, so a typo falls back to the default instead of silently opening at page 0. |

Both are observed: change either and the book remounts.

### Properties and events

| | |
|---|---|
| `.book` | The `Bookstand` instance, or `null` before it mounts. Everything below is reachable through it. |
| `change` | Re-fired from the instance. `event.detail` is `{ index, previous }`. Bubbles, and composed so it crosses a shadow boundary. |
| `error` | The book could not be loaded, or the renderer could not start. `event.detail` is the cause. The element also gets `data-bookstand-error`, and your markup is left alone. |

## `new Bookstand(host, options)`

### Methods and properties

| | |
|---|---|
| `next(corner?)` | Turn forward. `corner` is `'top'` (default) or `'bottom'`. Returns `false` if there is nothing to turn. |
| `prev(corner?)` | Turn back. Same signature. |
| `goTo(index, { animate })` | Jump to a spread index. Without `animate` it cuts straight there. Out-of-range values clamp. |
| `stateIndex` | The current spread index. |
| `book` | The resolved model — `faces`, `sheets`, `states`, `firstState`, `lastState`. |
| `metrics` | Layout figures, below. |
| `on(event, fn)` | Subscribe. Returns an unsubscribe function. |
| `destroy()` | Release the GPU textures, the observers and the listeners. |

### Events

| | |
|---|---|
| `change` | `{ index, previous }` — settled on a new spread. |
| `flipstart` | `{ direction, from, to }` — a turn began. |
| `flipend` | `{ index, completed }` — a turn finished. `completed` is `false` if it fell back. |
| `resize` | `BookstandMetrics` — the book was re-laid-out. Fires after the layout settles, once per real change. |

### `metrics`

For laying other things out against the book, or sizing the host yourself:

```js
const m = book.metrics;

m.book        // { width, height }  the book at rest
m.host        // { width, height }  the box you gave it
m.margin      // { x, y }           host minus book, both sides together
m.idealHeight //                    the height that wastes nothing at this width
```

`metrics` is read live, so it is never stale. To know *when* it changed:

```js
book.on('resize', (m) => {
  caption.style.width = `${m.book.width}px`;
});
```

**The margin is reserve, not slack.** A turning page sweeps well outside the book's rectangle — up
to **1.42× the page height** — and that room is where it goes. Shrink the host to reclaim it and the
sheet gets sliced flat against the canvas edge for the last quarter of every turn. Size against
`idealHeight` instead. On a wide host the horizontal margin also carries whatever the page's fixed
aspect ratio leaves over, which genuinely is unusable — the book cannot get wider without getting
taller.

## Pages

Each page is a string URL, or an object when you want the details:

```js
{
  src: '/page_1.jpg',
  alt: 'Chapter one',        // this is the accessible content — write it properly
  width: 624,                // intrinsic size; holds the layout before anything loads
  height: 907,
  srcset: '/page_1@2x.jpg 2x',
  sizes: '(max-width: 40rem) 100vw, 44rem',
  placeholder: '#e8e4dd',    // data URI or solid colour — accepted, not yet rendered
}
```

Covers are optional and independent: cover only, back cover only, both, or neither. A cover sits on
the right with the left half reserved, so the footprint never changes and opening the book does not
shove your layout around.

## Options

```js
new Bookstand(host, {
  cover, spreads, backCover,   // the book
  startAt: 'cover',            // 'cover' | 'first-spread' | <spread index>
  aspect: 624 / 907,           // page width ÷ height; defaults to the first image's
  padding: 0.04,               // breathing room inside the host, as a fraction
  maxDpr: 2,                   // cap device pixel ratio; halves fill cost on 3× phones
  textureLimit: 8,             // page textures held on the GPU; see below
  interactions: { drag: true, tap: true, peek: true, keyboard: true },
  motion: { /* … */ },
  curl:   { /* … */ },
  render: { /* … */ },
});
```

**`textureLimit`** caps GPU memory. One 624×907 page is 2.26 MB, so the default of 8 holds a book to
about 18 MB however long it is; unbounded, a 300-page read reaches 522 MB and mobile Safari discards
the context. Keep it at 6 or more — the preload window is the current spread plus one either side —
or every navigation evicts a page it is about to need again.

**`interactions`** — `drag` is corner-pull and swipe, `tap` turns on a press in either half, `peek`
is the hover lift (fine pointers only, and dropped under `prefers-reduced-motion`), `keyboard` is
documented below.

<details>
<summary><strong>motion</strong> — springs, not durations</summary>

```js
motion: {
  settle:  { stiffness: 340 },   // a confirmed turn falling into place
  recoil:  { stiffness: 480 },   // a refused one leaving — stiffer, so refusal is faster than arrival
  peek:    { stiffness: 300 },   // the hover lift
  flickVelocity: 1.6,            // page-widths/sec that completes a turn regardless of distance
  intentLockPx: 6,               // travel before a press commits to a drag, in CSS px
  peekDepth: 0.15,               // how far the hover lift rises
  peekZone: 0.3,                 // corner region that arms it, as a fraction of the page diagonal
  maxDuration: 900,              // hard ceiling on a settle, ms — a safety net, not the usual path
}
```

`intentLockPx` is in CSS pixels on purpose: it is a property of the hand, not of the page. Every
other constant here scales with the book.
</details>

<details>
<summary><strong>curl</strong> — the shape of the fold</summary>

```js
curl: {
  minRadius: 0.02,   // tightest roll, as a fraction of page width
  maxRadius: 0.06,   // loosest; higher reads as a tube rather than paper
  relaxFrom: 0.62,   // progress at which the roll flattens, so a turned page can lie flat
}
```
</details>

<details>
<summary><strong>render</strong> — material and light</summary>

```js
render: {
  gutter: 0.12,               // broad darkening where paper bows into the binding
  gutterFalloff: 6,           // higher keeps it tighter to the spine
  gutterCore: 0.14,           // the narrow seam at the fold itself
  gutterCoreTightness: 7,
  coverGutter: 0.2,           // a cover board does not bow; this scales the gutter down on one
  focal: 4,                   // perspective focal length in page widths; lower is more dramatic
  maxMagnification: 1.08,     // cap on how much a tilted sheet may grow
  light: [-0.35, -0.5, 0.79], // direction, in book space — up and to the left
  ambient: 0.78,              // share of brightness independent of the normal; high on purpose
  segments: [160, 120],       // curl mesh subdivisions
}
```

`ambient` is high because paper is thin, white and lit by bounce from everywhere — the diffuse term
is there to sculpt the roll, not to light the scene. There is no cast-shadow option: see `PLAN.md`
§4j for why it was removed rather than tuned.
</details>

## Keyboard

The host gets `role="region"`, a `tabindex`, and an `aria-label` built from the current pages' `alt`
text. Once focused:

| | |
|---|---|
| `→` · `PageDown` · `Space` | next spread |
| `←` · `PageUp` | previous spread |
| `Home` · `End` | first · last spread |

Keyboard turns are deliberately not animated — a reader holding `→` is already faster than any
animation. Set `interactions.keyboard: false` to opt out.

## Touch

The same gestures on the same code path — Pointer Events throughout, so there is no separate touch
implementation to drift. Measured on an emulated phone: **18 ms** from finger-down to the page
moving, and a corner responds at any angle you pull it.

Vertical swipes still scroll the page, *except* from a corner, where pulling a dog-ear downward is
what you meant. A second finger is left to the browser.

Not yet: pinch-zoom and double-tap-to-zoom.

## Browser support

Safari 13.1+ · Chrome 84+ · Firefox 79+ · Edge 84+ — 2020 onward. The constraints are Pointer
Events and `ResizeObserver`, not WebGL. There is no polyfill bundle and no second renderer; if the
module never loads or a context cannot be created, your markup is untouched and the page still works.

`prefers-reduced-motion` is honoured: dragging stays, because it is direct manipulation under the
reader's own hand, but the hover peek does not.

> **On the rest of the exports.** The package also exposes its internals — `FlipController`,
> `PointerInput`, `WebGLRenderer`, `Spring`, the geometry in `geom/fold.ts`, and so on. They are
> reachable because the core is built to be testable without a GPU, not because they are a supported
> surface. Everything documented above is; the rest may change in a minor version.

---

# Prior art — StPageFlip

[**StPageFlip**](https://github.com/Nodlik/StPageFlip) by Oleg Litovski ([Nodlik](https://github.com/Nodlik)),
MIT — the closest prior art, and the reason parts of this library look the way they do.

**Its geometric model is the one used here.** The turning sheet as a rigid shape rotated about the
dragged corner, with that corner tethered to a circle about the spine, is StPageFlip's, and it is
right: cheap, numerically stable, and the correct silhouette. Inventing a different one would have
produced something worse. It was **re-derived from the geometry rather than copied**, and **no
StPageFlip source is included in this package** — but the idea is theirs and it deserves saying
plainly rather than being left for someone to notice.

StPageFlip 2.0.7 also served as a measured baseline while the drag was being built. A real working
implementation to compare against is worth more than any specification, and several of the decisions
recorded in [`PLAN.md`](../../PLAN.md) exist because it was possible to measure both side by side.

## The differences

**They are of aim, not of quality**, and they all follow from one decision: *what a page is made of*.

StPageFlip renders **DOM elements**, and takes either live HTML or images — `loadFromHTML` and
`loadFromImages` are both first-class there. Bookstand renders **WebGL textures**, so a page can only
ever be an image. That single constraint is what makes the GPU path viable — a scan is already a
bitmap, so it uploads directly with nothing to rasterize first — and it is also what lets the sheet
curl on a deformed mesh instead of staying flat, because a DOM element cannot bend.

The rest follows from having a mesh and a physics loop rather than clip paths and a tween:

| | Bookstand | StPageFlip 2.0.7 |
|---|---|---|
| The turning sheet | curls around a cylinder | stays flat, clipped to a polygon |
| Release | a spring seeded with your real release velocity | a fixed 1000 ms linear tween |
| A fast flick at 20% travel | completes | snaps back |
| Idle cost | zero — rAF stops | `requestAnimationFrame` forever |
| Touch response | 18 ms | 278 ms (a 250 ms `setTimeout`) |
| Covers | declared, so density is known | inferred from position in the array |
| Page content | images only | live HTML or images |

Neither choice is the better one in general. A picture cannot be selected, searched or read aloud;
an element cannot be wrapped around a cylinder. **If the pages are content rather than pictures,
StPageFlip is the better tool and you should use it.**

`demo/reference/` builds a side-by-side comparison harness. It downloads the published bundle from
npm at runtime; that file is neither committed to this repository nor redistributed in this package.

---

## Development

```sh
pnpm install
pnpm --filter bookstand-demo dev    # the playground, running against source
pnpm test                           # 240 tests
pnpm build                          # bundles + declarations, with the size budget enforced
```

The build fails if either bundle exceeds its gzip budget. See `PLAN.md` §9.

## License

MIT
