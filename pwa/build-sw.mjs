// Build-time helper (Node ESM) that emits a PWA service worker from the template in this folder,
// stamping the cache version with a content hash of the whole shell so the cache name changes exactly
// when something it caches changes. Import from a consumer's esbuild `build.js`.
//
//   import { writeServiceWorker, serviceWorkerPlugin } from 'birko-web-core/pwa/build-sw.mjs';
//   const opts = { outDir: 'wwwroot', cachePrefix: 'myapp',
//                  shellAssets: ['index.html', 'app.js', 'css/tokens.css', 'manifest.webmanifest'] };
//   // one-shot: writeServiceWorker(opts);
//   // watch: add serviceWorkerPlugin(opts) to esbuild `plugins` so it re-stamps after every rebuild.

import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_TEMPLATE = join(dirname(fileURLToPath(import.meta.url)), 'service-worker.template.js');

/**
 * Emit `<outDir>/<outFile>` from the SW template.
 * @param {object} opts
 * @param {string} opts.outDir       Web root the assets were built into.
 * @param {string[]} opts.shellAssets Shell asset paths (relative to outDir) to precache + hash over.
 * @param {string} opts.cachePrefix  Cache-name prefix (e.g. the app name).
 * @param {string} [opts.templatePath] Override the SW template.
 * @param {string} [opts.outFile]    Output SW filename (default 'sw.js').
 * @returns {{ version: string, precache: string[] }}
 */
export function writeServiceWorker(opts) {
  const { outDir, shellAssets, cachePrefix, templatePath = DEFAULT_TEMPLATE, outFile = 'sw.js' } = opts ?? {};
  if (!outDir) throw new Error('writeServiceWorker: `outDir` is required');
  if (!Array.isArray(shellAssets) || shellAssets.length === 0) throw new Error('writeServiceWorker: `shellAssets` is required');
  if (!cachePrefix) throw new Error('writeServiceWorker: `cachePrefix` is required');

  const hash = createHash('sha1');
  for (const rel of shellAssets) hash.update(readFileSync(join(outDir, rel)));
  const version = hash.digest('hex').slice(0, 12);

  // Web-root-absolute precache paths; always include the navigation fallback '/'.
  const precache = Array.from(new Set(['/', ...shellAssets.map((a) => '/' + a.replace(/^\/+/, ''))]));

  const sw = readFileSync(templatePath, 'utf8')
    .replaceAll('__CACHE_PREFIX__', cachePrefix)
    .replaceAll('__BUILD_HASH__', version)
    .replaceAll('__PRECACHE__', JSON.stringify(precache, null, 2));

  writeFileSync(join(outDir, outFile), sw);
  return { version, precache };
}

/**
 * esbuild plugin that re-stamps the service worker after every successful (re)build, so a watch loop
 * keeps the cache version in step with the freshly emitted bundle.
 * @param {Parameters<typeof writeServiceWorker>[0]} opts
 */
export function serviceWorkerPlugin(opts) {
  return {
    name: 'birko-service-worker',
    setup(build) {
      build.onEnd((result) => {
        if (!result.errors || result.errors.length === 0) writeServiceWorker(opts);
      });
    },
  };
}
