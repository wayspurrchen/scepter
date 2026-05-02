import * as esbuild from 'esbuild';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

// Emits begin/end lines on every build cycle so the VS Code task
// problem-matcher (tasks.json) can transition state correctly across
// rebuilds. Without these, esbuild's watch is silent on incremental
// builds and the preLaunchTask hangs on subsequent F5s.
const watchLogger = {
  name: 'watch-logger',
  setup(build) {
    build.onStart(() => {
      console.log('[esbuild] build started');
    });
    build.onEnd((result) => {
      if (result.errors.length > 0) {
        console.error(`[esbuild] build failed: ${result.errors.length} error(s)`);
      } else {
        console.log('[esbuild] build finished');
      }
    });
  },
};

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
  alias: {},
  plugins: watch ? [watchLogger] : [],
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