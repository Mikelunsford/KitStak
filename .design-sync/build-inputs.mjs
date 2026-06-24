// design-sync buildCmd: regenerates the two converter inputs this repo needs.
//  1. compiled Tailwind CSS (cfg.cssEntry) — styles.css uses @tailwind directives
//  2. real component .d.ts (.cache/dts) — the .tsx sources ship no declarations,
//     so without this the extracted prop interfaces collapse to [key]: unknown.
// Run before package-build.mjs / resync.mjs.
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const tsc = resolve(repo, 'apps/web/node_modules/typescript/lib/tsc.js');

console.log('[build-inputs] compiling Tailwind CSS...');
execFileSync(process.execPath, [resolve(here, 'build-css.mjs')], { stdio: 'inherit' });

console.log('[build-inputs] emitting component .d.ts...');
// tsc exits non-zero on the (harmless) missing-types diagnostic even though it
// emits; don't let that abort the script.
try {
  execFileSync(process.execPath, [tsc, '-p', resolve(here, 'dts-tsconfig.json')], { stdio: 'inherit' });
} catch {
  /* declarations still emitted (noEmitOnError:false) */
}
console.log('[build-inputs] done.');
