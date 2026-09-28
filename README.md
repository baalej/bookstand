# Bookstand

A small, fast, beautiful page-flip book for the web. WebGL, no dependencies, ~12 kB gzipped.

**→ [Package README](packages/bookstand/README.md)** — installation and usage.
**→ [PLAN.md](PLAN.md)** — the design, and a log of every decision and why.

```
packages/bookstand/   the library
demo/                 playground, runs against source
example/              the scans the demo and tests use
references/           StPageFlip, kept for comparison; excluded from the build
```

```sh
pnpm install
pnpm --filter bookstand-demo dev
pnpm test
pnpm build
```

MIT.
