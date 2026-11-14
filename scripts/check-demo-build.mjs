// Checks a finished build (dist/ and .netlify/build/) for the template demo:
//   node scripts/check-demo-build.mjs off   -> fails if any demo page or route was built
//   node scripts/check-demo-build.mjs on    -> fails if a demo page or route is missing
// Run it right after `astro build`. It reads files only.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { demoRoutes } from '../src/demo/routes.mjs';

const expected = process.argv[2];
if (expected !== 'on' && expected !== 'off') {
    console.error('usage: node scripts/check-demo-build.mjs <on|off>');
    process.exit(2);
}

const walk = (dir) =>
    existsSync(dir)
        ? readdirSync(dir).flatMap((name) => {
              const path = join(dir, name);
              return statSync(path).isDirectory() ? (name === 'node_modules' ? [] : walk(path)) : [path];
          })
        : [];

if (!existsSync('dist') || !existsSync('.netlify/build')) {
    console.error('no build output found: run `astro build` first');
    process.exit(2);
}

// Routes the server function knows about, from Astro's route manifest
const serverRoutes = new Set(walk('.netlify/build').flatMap((file) => [...readFileSync(file, 'utf8').matchAll(/"route":"([^"]+)"/g)].map((match) => match[1])));
if (!serverRoutes.has('/')) {
    console.error('could not read the route manifest in .netlify/build (the application home route is missing)');
    process.exit(2);
}

// Pages written to dist/, as the paths they are served at
const staticPages = new Set(
    walk('dist')
        .filter((file) => file.endsWith('.html'))
        .map(
            (file) =>
                '/' +
                file
                    .slice('dist/'.length)
                    .replace(/(^|\/)index\.html$/, '')
                    .replace(/\/$/, '')
        )
);

const demoPatterns = demoRoutes.map((route) => route.pattern);
const built = demoPatterns.filter((pattern) => serverRoutes.has(pattern) || staticPages.has(pattern));
const missing = demoPatterns.filter((pattern) => !serverRoutes.has(pattern));

console.log(`server routes: ${[...serverRoutes].sort().join(' ')}`);
console.log(`static pages:  ${[...staticPages].sort().join(' ')}`);

if (expected === 'off' && built.length) {
    console.error(`FAIL: the demo is expected to be off, but these demo routes were built: ${built.join(' ')}`);
    process.exit(1);
}
if (expected === 'on' && missing.length) {
    console.error(`FAIL: the demo is expected to be on, but these demo routes are missing: ${missing.join(' ')}`);
    process.exit(1);
}
console.log(`OK: demo is ${expected} (${expected === 'off' ? 'none' : 'all'} of ${demoPatterns.length} demo routes built)`);
