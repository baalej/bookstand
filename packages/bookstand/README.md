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

## Use it on a static page

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

**You do not have to give it a height.** With none, it holds itself at the spread's own ratio, so a
width is enough. Give it a height and it uses that instead, fitting the book inside.

### Attributes

| | |
|---|---|
| `src` | URL of a book JSON file. Omit it and an inline `<script type="application/json">` is used. |
| `start-at` | `cover`, `first-spread`, or a spread index. Anything else is ignored rather than guessed at. |

The element also exposes `.book` — the `Bookstand` instance — and re-fires its `change` event.

---

## Use it from npm

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

book.next();
book.prev();
book.goTo(3);
book.on('change', ({ index }) => console.log(index));
book.destroy();
```

Or register the tag and keep writing markup:

```js
import 'bookstand/element';
```

---

## Pages

Each page is a string URL, or an object when you want the details:

```js
{ src: '/page_1.jpg', alt: 'Chapter one', width: 624, height: 907 }
```

`alt` is the accessible content — for a book made of images, it is the *only* accessible content.
`width`/`height` hold the layout steady before anything has loaded.

Covers are optional and independent: cover only, back cover only, both, or neither. A cover sits on
the right with the left half reserved, so the footprint never changes and opening the book does not
shove your layout around.

---

## Options

```js
new Bookstand(host, {
  cover, spreads, backCover,          // the book
  startAt: 'cover',                   // 'cover' | 'first-spread' | <spread index>
  aspect: 624 / 907,                  // page width ÷ height; defaults to the first image's
  padding: 0.04,                      // breathing room inside the host, as a fraction
  maxDpr: 2,                          // cap device pixel ratio; halves fill cost on 3× phones
  interactions: { drag: true, tap: true, peek: true, keyboard: true },
  motion: { /* springs — see src/motion/tokens.ts */ },
  curl:   { minRadius: 0.02, maxRadius: 0.06, relaxFrom: 0.62 },
  render: { gutter: 0.12, focal: 4, ambient: 0.78 /* … */ },
});
```

---

## Browser support

Safari 13.1+ · Chrome 84+ · Firefox 79+ · Edge 84+ — 2020 onward. The constraints are Pointer
Events and `ResizeObserver`, not WebGL. There is no polyfill bundle and no second renderer; if the
module never loads or a context cannot be created, your markup is untouched and the page still works.

`prefers-reduced-motion` is honoured: dragging stays, because it is direct manipulation under the
reader's own hand, but the hover peek does not.

---

## Prior art — StPageFlip

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

**The differences are of aim, not of quality**, and they all follow from one decision: *what a page
is made of*.

StPageFlip renders **DOM elements**, and takes either live HTML or images — `loadFromHTML` and
`loadFromImages` are both first-class there. Bookstand renders **WebGL textures**, so a page can only
ever be an image. That single constraint is what makes the GPU path viable — a scan is already a
bitmap, so it uploads directly with nothing to rasterize first — and it is also what lets the sheet
curl on a deformed mesh instead of staying flat, because a DOM element cannot bend.

Neither choice is the better one in general. A picture cannot be selected, searched or read aloud;
an element cannot be wrapped around a cylinder. **If the pages are content rather than pictures,
StPageFlip is the better tool and you should use it.**

`demo/reference/` builds a side-by-side comparison harness. It downloads the published bundle from
npm at runtime; that file is neither committed to this repository nor redistributed in this package.

## Development

```sh
pnpm install
pnpm --filter bookstand-demo dev    # the playground, running against source
pnpm test                           # 215 tests
pnpm build                          # bundles + declarations, with the size budget enforced
```

The build fails if either bundle exceeds its gzip budget. See `PLAN.md` §9.

## License

MIT
