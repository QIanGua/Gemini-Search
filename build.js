import * as esbuild from 'esbuild'

try {
  await esbuild.build({
    entryPoints: ['server/index.ts'],
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'esm',
    outdir: 'dist',
    external: [
      // Node.js built-in modules
      'path',
      'fs',
      'http',
      'crypto',
      // External dependencies that should not be bundled
      'express',
      'dotenv',
      'marked',
      '@google/generative-ai',
      'ws',
      // Additional externals to fix build errors
      '@babel/*',
      'lightningcss',
      'fsevents',
      '*.node'
    ],
    loader: {
      '.ts': 'ts',
      '.tsx': 'tsx'
    },
    sourcemap: true,
    minify: true,
    // Additional settings to handle native modules
    mainFields: ['module', 'main'],
    conditions: ['node', 'import', 'default'],
    packages: 'external'
  })
  console.log('⚡ Server build complete')
} catch (error) {
  console.error('❌ Build failed:', error)
  process.exit(1)
} 