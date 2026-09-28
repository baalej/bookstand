# Bookstand

A small, fast, beautiful page-flip book for the web. WebGL, no dependencies, ~12 kB gzipped.

**→ [Package README](packages/bookstand/README.md)** — installation and usage.
**→ [PLAN.md](PLAN.md)** — the design, and a log of every decision and why.

```
packages/bookstand/   the library
demo/                 playground, runs against source
demo/reference/       side-by-side harness vs StPageFlip; downloads it at runtime, commits nothing
example/              the scans the demo and tests use
```

```sh
pnpm install
pnpm --filter bookstand-demo dev
pnpm test
pnpm build
```

## Prior art

This library's fold geometry follows the model established by
[**StPageFlip**](https://github.com/Nodlik/StPageFlip) by Oleg Litovski
([Nodlik](https://github.com/Nodlik)), MIT. That model was **re-derived rather than copied, and no
StPageFlip source is included here** — but the approach is theirs, it is the right one, and it is
credited throughout `PLAN.md` and in the source comments where the two diverge.

StPageFlip 2.0.7 was also used as a measured baseline while building the drag. Where the code or the
plan compares the two, it is comparing *engineering choices made for different goals*.

The goals differ in one decision — **what a page is made of**. StPageFlip renders DOM elements and
accepts either live HTML or images. Bookstand renders WebGL textures, so a page can only ever be an
image; that constraint is what makes the GPU path viable and what lets the sheet curl, and the price
is that text on a page is pixels — not selectable, not searchable, and reaching a screen reader only
through its `alt`. **If the pages are content rather than pictures, StPageFlip is the better tool.**

See [Prior art — StPageFlip](packages/bookstand/README.md#prior-art--stpageflip) for the full note.

MIT.
