/**
 * Two bundles and their declarations.
 *
 * `tsc` alone emits sixteen ESM modules with relative imports between them,
 * which is right for a bundler and wrong for a `<script type="module">`: a
 * static page would fetch sixteen files in a waterfall and you would have to
 * upload the whole tree. So the JS is bundled and the types come from `tsc`.
 */
import { build } from 'esbuild';
import { gzipSync } from 'node:zlib';
import { readFileSync, statSync } from 'node:fs';

/** PLAN.md §9. A budget nobody checks is not a budget. */
const BUDGET = { 'bookstand.js': 14 * 1024, 'element.js': 16 * 1024 };

const shared = {
  bundle: true,
  format: 'esm',
  platform: 'browser',
  // Matches tsconfig's ES2020 and the Safari 13.1 baseline in §9. esbuild will
  // refuse to emit syntax these cannot run rather than shipping it silently.
  target: ['es2020', 'safari13.1', 'chrome84', 'firefox79', 'edge84'],
  legalComments: 'none',
};

await build({
  ...shared,
  entryPoints: {
    bookstand: 'src/index.ts',
    element: 'src/element.ts',
  },
  // Bundles at the root of dist, declarations under dist/types.
  //
  // Not cosmetic: `tsc` names a declaration after its source, so emitting both
  // here would put dist/bookstand.d.ts — the types for *src/bookstand.ts*
  // alone — next to dist/bookstand.js, the bundle of the whole index. Any tool
  // resolving types by matching filename would silently pick the narrower one.
  // Keeping them apart also leaves exactly the two files a static site copies
  // sitting at the top of dist.
  outdir: 'dist',
  minify: true,
  sourcemap: true,
});

let over = false;
for (const [file, budget] of Object.entries(BUDGET)) {
  const path = `dist/${file}`;
  const gzip = gzipSync(readFileSync(path), { level: 9 }).length;
  const raw = statSync(path).size;
  const pct = Math.round((gzip / budget) * 100);
  const line = `  ${file.padEnd(14)} ${String(raw).padStart(6)} B  ${String(gzip).padStart(5)} B gzip  ${String(pct).padStart(3)}% of budget`;
  if (gzip > budget) {
    over = true;
    console.error(`${line}  ← OVER`);
  } else {
    console.log(line);
  }
}
if (over) {
  console.error('\nBundle budget exceeded. See PLAN.md §9.');
  process.exit(1);
}
