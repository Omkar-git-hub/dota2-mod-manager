/**
 * Where the site and the repository sit on disk, found from where the build runs.
 *
 * Both used to be worked out from import.meta.url, which names the file that ends up running: a
 * build chunk, not this source. Astro 5 left its chunks at a depth where "../../.." still reached
 * the repository. Astro 7 put them somewhere else, and nothing failed. The same three steps up
 * found site/package.json, so the site was built as version 0.0.0, and the check for a page's own
 * link-preview card looked in the wrong public/ folder and gave the docs and the fact sheet the
 * front page's card. The working directory stays put however a bundler lays out its chunks.
 */
import fs from 'node:fs';
import path from 'node:path';

function findSite(): string {
  const start = process.cwd();
  // `npm run build` runs inside site/; a command run from the repository root names it
  for (const candidate of [start, path.join(start, 'site')]) {
    if (fs.existsSync(path.join(candidate, 'astro.config.mjs'))) return candidate;
  }
  let dir = start;
  while (path.dirname(dir) !== dir) {
    dir = path.dirname(dir);
    if (fs.existsSync(path.join(dir, 'astro.config.mjs'))) return dir;
  }
  throw new Error(`No astro.config.mjs in or above ${start}. Run the build from the site folder.`);
}

/** The folder astro.config.mjs is in. */
export const SITE_ROOT = findSite();

/** The repository the site describes, one level up from it. */
export const REPO_ROOT = path.dirname(SITE_ROOT);
