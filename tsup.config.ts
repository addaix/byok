import { defineConfig } from 'tsup';

// Three entries: the core (no AI SDK, no React), the call (the AI SDK), the React parts.
export default defineConfig({
  entry: { index: 'src/index.ts', call: 'src/call.ts', react: 'src/react/index.tsx' },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  // One copy of shared code (ModelCallError) for CommonJS too, so `instanceof` holds across entries.
  splitting: true,
  external: ['react', 'zod', 'ai', /^@ai-sdk\//, /^@zodal\//],
});
