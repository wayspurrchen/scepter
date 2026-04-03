import * as esbuild from 'esbuild';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const buildOptions = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'out/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: true,
  minify: false,
  // The scepter barrel re-exports LLM/CLI code the extension never uses.
  // Mark those heavy deps external so they don't bloat the bundle.
  // They're never called at runtime in the extension, so missing is fine.
  alias: {},
};

if (watch) {
  const ctx = await esbuild.context(buildOptions);
  await ctx.watch();
  console.log('[esbuild] watching for changes...');
} else {
  const result = await esbuild.build(buildOptions);
  if (result.errors.length > 0) {
    console.error('Build failed:', result.errors);
    process.exit(1);
  }
  console.log('[esbuild] build complete');
}