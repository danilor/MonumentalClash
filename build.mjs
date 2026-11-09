// Bundles the game into docs/ (one classic script, so docs/index.html also works when opened from disk).
//   node build.mjs           production build
//   node build.mjs --serve   development server with rebuild-on-change on http://localhost:8080
import { context, build } from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const serve = process.argv.includes('--serve');
const outdir = resolve(root, 'docs');
mkdirSync(outdir, { recursive: true });
copyFileSync(resolve(root, 'src/index.html'), resolve(outdir, 'index.html'));

const options = {
  entryPoints: [resolve(root, 'src/main.js')],
  outfile: resolve(outdir, 'game.js'),
  bundle: true,
  format: 'iife',
  target: 'es2020',
  minify: !serve,
  sourcemap: serve,
  legalComments: 'none',
  // The prebuilt Phaser bundle avoids Phaser's compile-time feature flags.
  alias: { phaser: resolve(root, 'node_modules/phaser/dist/phaser.min.js') },
  logLevel: 'info',
};

if (serve) {
  const ctx = await context(options);
  await ctx.watch();
  const { port } = await ctx.serve({ servedir: outdir, port: 8080 });
  console.log(`Serving on http://localhost:${port}`);
} else {
  await build(options);
}
