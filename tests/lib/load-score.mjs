// Loads src/lib/score.ts (TypeScript) into plain Node by bundling it with
// esbuild, which ships with Vite, so there is nothing extra to install.
import { build } from 'esbuild'
import { mkdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

export async function loadScore() {
  const outdir = join(ROOT, 'tests', '.tmp')
  mkdirSync(outdir, { recursive: true })
  const outfile = join(outdir, `score-${process.pid}.mjs`)
  await build({ entryPoints: [join(ROOT, 'src/lib/score.ts')], outfile, format: 'esm', bundle: true, logLevel: 'silent' })
  return import(pathToFileURL(outfile).href)
}
