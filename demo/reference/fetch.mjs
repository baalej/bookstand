/**
 * Pull the published StPageFlip browser bundle into vendor/ for the
 * side-by-side harness.
 *
 * Not committed: it is third-party MIT code and we only need it to compare
 * against while building the drag. `references/StPageFlip` holds the source
 * and its licence; this is just a runnable copy.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const URL_ = 'https://unpkg.com/page-flip@2.0.7/dist/js/page-flip.browser.js';
const out = fileURLToPath(new URL('./vendor/page-flip.browser.js', import.meta.url));

await mkdir(fileURLToPath(new URL('./vendor/', import.meta.url)), { recursive: true });
const res = await fetch(URL_);
if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
await writeFile(out, Buffer.from(await res.arrayBuffer()));
console.log(`wrote ${out}`);
