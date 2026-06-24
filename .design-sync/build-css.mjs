// Compiles the app's Tailwind stylesheet into a static CSS file for the
// design-sync bundle. styles.css uses @tailwind directives, so it must be run
// through the Tailwind compiler; the raw source would ship no utility classes.
// Output is cfg.cssEntry (.design-sync/.cache/ds-compiled.css), appended into
// _ds_bundle.css by the converter. The brand fonts load from Google Fonts at
// runtime (the app does the same via an index.html <link>), so a remote
// @import is prepended.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const web = resolve(repo, 'apps/web');
const out = resolve(here, '.cache/ds-compiled.css');
mkdirSync(dirname(out), { recursive: true });

// Invoke Tailwind's JS CLI through node so it works cross-platform (spawning a
// .CMD shim on Windows fails with EINVAL).
const cli = resolve(web, 'node_modules/tailwindcss/lib/cli.js');
execFileSync(process.execPath, [cli, '-i', 'src/styles.css', '-o', out, '-c', 'tailwind.config.js', '--minify'], {
  cwd: web,
  stdio: 'inherit',
});

const FONT =
  "@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter+Tight:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');\n";
const css = readFileSync(out, 'utf8');
if (!css.includes('fonts.googleapis.com')) writeFileSync(out, FONT + css);
console.log('ds-compiled.css ready (' + (readFileSync(out, 'utf8').length / 1024).toFixed(0) + ' KB)');
