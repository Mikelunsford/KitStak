#!/usr/bin/env node
/*
 * canon-steward-check.mjs
 * Closes: F-Wave7-CANON-STEWARD-01
 *
 * Three grep-style guardrails that catch the silent-breakage patterns the
 * Canon Steward pass missed in Phase 6.5:
 *
 *   1. Placeholder / TODO 6.5-* / TODO Canon Steward markers anywhere in
 *      apps/web/src/ or supabase/functions/. Two Phase 6.5 incidents shipped
 *      because intentional stubs (ProjectLineItemPlaceholder) leaked past
 *      the steward.
 *
 *   2. Every <Link to="/path/new"> (and useNavigate()('/path/new')) in
 *      apps/web/src/ whose /path/new is not a registered route in
 *      apps/web/src/routes.ts. PR #27 and PR #34 both shipped a Sidebar
 *      link pointing at /foo/new with no matching route registered; the
 *      URL fell through to /:id with id="new" and surfaced as a 500 at the
 *      Postgres uuid cast.
 *
 *   3. Every list-page route registered in routes.ts that is NOT reachable
 *      from at least one NavChild entry in
 *      apps/web/src/components/shell/Sidebar.tsx.
 *
 * Zero top-level dependencies: pure node:fs / node:path / built-in regex.
 * Runs in well under 10s against the current tree. Targets Node 20+ via
 * a .mjs ESM file so it works on the CI matrix without a TS toolchain.
 *
 * Exits 0 with no output on a clean tree, 1 with a structured per-file:line
 * report on violations. An allowlist at scripts/canon-steward-allowlist.txt
 * suppresses known entries by literal "<rule>|<file>|<snippet>" form; see
 * that file for the format and the require-a-follow-up rule.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Project root resolution: this file lives at <root>/scripts/.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');
const ALLOWLIST_PATH = join(ROOT, 'scripts', 'canon-steward-allowlist.txt');

// --------------------------------------------------------------------------
// Filesystem helpers (no glob dep; cheap and synchronous).
// --------------------------------------------------------------------------

function walk(dir, exts) {
  if (!existsSync(dir)) return [];
  const out = [];
  const stack = [dir];
  while (stack.length > 0) {
    const cur = stack.pop();
    let entries;
    try {
      entries = readdirSync(cur);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (name === 'node_modules' || name === '.git' || name === 'dist') continue;
      const p = join(cur, name);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        stack.push(p);
      } else if (st.isFile()) {
        for (const ext of exts) {
          if (name.endsWith(ext)) {
            out.push(p);
            break;
          }
        }
      }
    }
  }
  return out;
}

function rel(p) {
  return relative(ROOT, p).split(sep).join('/');
}

// --------------------------------------------------------------------------
// Allowlist.
// --------------------------------------------------------------------------

function loadAllowlist() {
  if (!existsSync(ALLOWLIST_PATH)) return new Set();
  const raw = readFileSync(ALLOWLIST_PATH, 'utf8');
  const out = new Set();
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    // Format: <rule>|<file>|<snippet>. The line number is intentionally not
    // part of the key so an allowed entry does not silently fall back into
    // failing CI on line drift; the rule + file + snippet is the load-
    // bearing tuple.
    out.add(line);
  }
  return out;
}

function isAllowed(v, allow) {
  const key = `${v.rule}|${v.file}|${v.snippet}`;
  return allow.has(key);
}

// --------------------------------------------------------------------------
// Rule 1: markers.
// --------------------------------------------------------------------------

const MARKER_PATTERNS = [
  // Case-sensitive `Placeholder` (PascalCase). The HTML `placeholder=` attr
  // is lowercase and never matches. Catches identifiers like
  // `ProjectLineItemPlaceholder` left as TODO stubs.
  { re: /\bPlaceholder\b/, label: 'Placeholder identifier' },
  { re: /TODO 6\.5-/, label: 'TODO 6.5- marker (stale Phase 6.5 stub)' },
  { re: /TODO Canon Steward/i, label: 'TODO Canon Steward marker' },
];

function scanMarkers() {
  const out = [];
  const roots = [
    join(ROOT, 'apps', 'web', 'src'),
    join(ROOT, 'supabase', 'functions'),
  ];
  const files = roots.flatMap((r) =>
    walk(r, ['.ts', '.tsx', '.js', '.jsx']),
  );
  for (const path of files) {
    // The scripts directory references the literal marker patterns inside
    // string literals; exclude self-references.
    if (rel(path).startsWith('scripts/')) continue;
    const text = readFileSync(path, 'utf8');
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      for (const { re, label } of MARKER_PATTERNS) {
        if (re.test(line)) {
          out.push({
            rule: 'marker',
            file: rel(path),
            line: i + 1,
            message: `${label} found`,
            snippet: line.trim().slice(0, 160),
          });
        }
      }
    }
  }
  return out;
}

// --------------------------------------------------------------------------
// Rule 2 + 3: routes vs Sidebar vs <Link to="..."> / navigate("...").
// --------------------------------------------------------------------------

function parseRoutes() {
  // routes.ts is a flat array of `{ path: '/foo/bar', ... }` entries. A
  // regex over the file is good enough; we are not building a full TS AST.
  const path = join(ROOT, 'apps', 'web', 'src', 'routes.ts');
  const text = readFileSync(path, 'utf8');
  const out = [];
  const re = /path:\s*['"`]([^'"`]+)['"`]/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push(m[1]);
  }
  return out;
}

function parseSidebarLinks() {
  const path = join(
    ROOT,
    'apps',
    'web',
    'src',
    'components',
    'shell',
    'Sidebar.tsx',
  );
  // Post-UX-Q1 the route strings live in sidebarModes.ts; Sidebar.tsx
  // consumes the SIDEBAR_MODES export but no longer carries the literal
  // `to: '/foo'` entries. Scan both files so the orphan-route check
  // remains accurate. Order matches the import direction (consumer →
  // data) but the check is path-agnostic.
  const modesPath = join(
    ROOT,
    'apps',
    'web',
    'src',
    'components',
    'shell',
    'sidebarModes.ts',
  );
  const sources = [path, modesPath].filter((p) => existsSync(p));
  if (sources.length === 0) return [];
  const out = [];
  // NavChild entries / ModeSpec route entries: `{ to: '/foo', label: 'Foo' }` or
  // `{ path: '/foo', label: 'Foo' }`. Match both the `to:` and `path:`
  // keys inside object literals. Sidebar.tsx also has a top-level
  // `<NavLink to="/dashboard">`; pick that up too.
  const reTo = /\bto:\s*['"`]([^'"`]+)['"`]/g;
  const rePath = /\bpath:\s*['"`]([^'"`]+)['"`]/g;
  const reJsx = /<NavLink\s+to=["']([^"']+)["']/g;
  let m;
  for (const file of sources) {
    const text = readFileSync(file, 'utf8');
    while ((m = reTo.exec(text)) !== null) out.push(m[1]);
    while ((m = rePath.exec(text)) !== null) out.push(m[1]);
    while ((m = reJsx.exec(text)) !== null) out.push(m[1]);
  }
  return out;
}

function scanLinkOrphans(routes) {
  const out = [];
  const routeSet = new Set(routes);
  const files = walk(join(ROOT, 'apps', 'web', 'src'), ['.ts', '.tsx']);
  const reLink = /<Link\s+[^>]*?\bto=["']([^"']+)["']/g;
  const reNavLink = /<NavLink\s+[^>]*?\bto=["']([^"']+)["']/g;
  const reNavigate = /\bnavigate\(\s*['"`]([^'"`]+)['"`]/g;
  for (const path of files) {
    // Skip the routes file itself.
    const relPath = rel(path);
    if (relPath.endsWith('/routes.ts')) continue;
    const text = readFileSync(path, 'utf8');
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const candidates = [];
      let m;
      reLink.lastIndex = 0;
      while ((m = reLink.exec(line)) !== null) candidates.push(m[1]);
      reNavLink.lastIndex = 0;
      while ((m = reNavLink.exec(line)) !== null) candidates.push(m[1]);
      reNavigate.lastIndex = 0;
      while ((m = reNavigate.exec(line)) !== null) candidates.push(m[1]);
      for (const target of candidates) {
        // Only static absolute paths. Skip template-literal-like substrings,
        // relative paths, external URLs, hash anchors, query-only paths,
        // and dynamic id segments (caller built the URL themselves).
        if (!target.startsWith('/')) continue;
        if (target.startsWith('//')) continue; // protocol-relative URL
        if (target.startsWith('/#')) continue;
        if (target.includes('${')) continue; // template literal residue
        if (target.includes(':')) continue; // dynamic segment usage
        // Strip query/hash before matching against the route table.
        const cleaned = target.split('?')[0].split('#')[0];
        if (cleaned === '/' || cleaned === '') continue;
        if (routeSet.has(cleaned)) continue;
        out.push({
          rule: 'orphan-link',
          file: relPath,
          line: i + 1,
          message: `Link target ${cleaned} is not registered in routes.ts`,
          snippet: line.trim().slice(0, 160),
        });
      }
    }
  }
  return out;
}

function scanRouteOrphans(routes) {
  // For every list-page route ensure at least one Sidebar NavChild has the
  // same `to` value. Reachability is "the user can land on this page from
  // the sidebar in <= 1 hop." Detail / edit / create / send / apply /
  // convert routes are reachable via the list page, not the sidebar; this
  // check only enforces list-page coverage.
  const out = [];
  const sidebar = new Set(parseSidebarLinks());
  for (const path of routes) {
    if (path.includes(':')) continue;
    if (path.endsWith('/new')) continue;
    if (path.endsWith('/edit')) continue;
    if (path.endsWith('/send')) continue;
    if (path.endsWith('/apply')) continue;
    if (path.endsWith('/convert')) continue;
    // Public / utility paths are not expected in the sidebar.
    const skipPrefixes = [
      '/signin',
      '/404',
      '/feature-unavailable',
      '/portal',
      '/dashboard/summary',
    ];
    if (skipPrefixes.some((p) => path === p || path.startsWith(`${p}/`))) {
      continue;
    }
    // Sidebar /dashboard is rendered via a NavLink not a NavChild; covered.
    if (sidebar.has(path)) continue;
    out.push({
      rule: 'orphan-route',
      file: 'apps/web/src/routes.ts',
      line: 0,
      message: `Route ${path} is registered but not reachable from Sidebar.tsx`,
      snippet: path,
    });
  }
  return out;
}

// --------------------------------------------------------------------------
// Main.
// --------------------------------------------------------------------------

function main() {
  const allow = loadAllowlist();
  const routes = parseRoutes();

  const all = [
    ...scanMarkers(),
    ...scanLinkOrphans(routes),
    ...scanRouteOrphans(routes),
  ];

  const filtered = all.filter((v) => !isAllowed(v, allow));
  if (filtered.length === 0) {
    // Silent success keeps CI logs short.
    return;
  }

  process.stdout.write('canon-steward-check: violations found\n');
  process.stdout.write(`Total: ${filtered.length}\n\n`);
  const byRule = new Map();
  for (const v of filtered) {
    const list = byRule.get(v.rule) ?? [];
    list.push(v);
    byRule.set(v.rule, list);
  }
  for (const [rule, list] of byRule) {
    process.stdout.write(`[${rule}] ${list.length} violation(s):\n`);
    for (const v of list) {
      const loc = v.line > 0 ? `${v.file}:${v.line}` : v.file;
      process.stdout.write(`  ${loc}\n`);
      process.stdout.write(`    ${v.message}\n`);
      if (v.snippet) process.stdout.write(`    > ${v.snippet}\n`);
    }
    process.stdout.write('\n');
  }
  process.stdout.write(
    'Fix the violations, or add an explicit entry to scripts/canon-steward-allowlist.txt\n',
  );
  process.stdout.write(
    'in the form: <rule>|<file>|<snippet>\n',
  );
  process.exitCode = 1;
}

main();
