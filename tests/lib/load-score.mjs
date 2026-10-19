// Loads files from src/lib (TypeScript) into plain Node by bundling it with
// esbuild, which ships with Vite, so there is nothing extra to install.
import { build } from 'esbuild'
import { mkdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** Loads any TypeScript file in src/lib (given as e.g. 'form') as a plain module. */
export async function loadLib(name) {
  const outdir = join(ROOT, 'tests', '.tmp')
  mkdirSync(outdir, { recursive: true })
  const outfile = join(outdir, `${name}-${process.pid}.mjs`)
  await build({ entryPoints: [join(ROOT, `src/lib/${name}.ts`)], outfile, format: 'esm', bundle: true, logLevel: 'silent', alias: { '@': join(ROOT, 'src') } })
  return import(pathToFileURL(outfile).href)
}

export const loadScore = () => loadLib('score')
