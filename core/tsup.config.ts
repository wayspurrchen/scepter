import { defineConfig } from 'tsup';

export default defineConfig({
  // @implements {DD011.§DC.07} Dual entry points: CLI + library
  entry: {
    cli: 'src/cli/index.ts',
    index: 'src/index.ts',
  },
  format: ['cjs', 'esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  shims: true,
  target: 'node18',
  outDir: './dist',
  esbuildOptions(options) {
    options.platform = 'node';
  },
});