#!/usr/bin/env node
/**
 * Post-build normalization of client/client.js, mirroring the dshmarket
 * pattern: Rolldown pretty-prints the tsdown banner into a three-line
 * header, but the published contract requires the file to START with the
 * exact one-line `window.__ModuleLoader__.load({ id: "…"` prefix (hosts sniff
 * the loader id from the file head). Collapse the header onto one line,
 * leaving blank lines in place of the folded ones so the sourcemap's line
 * numbers stay valid.
 */
import fs from 'node:fs'

const file = 'client/client.js'
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
const name = pkg.name
const required = `window.__ModuleLoader__.load({ id: ${JSON.stringify(name)}, factory: (require) => {`

if (!fs.existsSync(file)) {
  console.error(`normalize-client-banner: ${file} not found — did tsdown run?`)
  process.exit(1)
}

let code = fs.readFileSync(file, 'utf8')

if (!code.startsWith(required)) {
  const lines = code.split('\n')
  const head = [
    'window.__ModuleLoader__.load({',
    `\tid: ${JSON.stringify(name)},`,
    '\tfactory: (require) => {',
  ]
  if (lines[0] !== head[0] || lines[1] !== head[1] || lines[2] !== head[2]) {
    console.error(`normalize-client-banner: unexpected ${file} header:\n` + lines.slice(0, 3).join('\n'))
    process.exit(1)
  }
  lines[0] = required
  lines[1] = ''
  lines[2] = ''
  code = lines.join('\n')
}

fs.writeFileSync(file, code)
console.log(`normalize-client-banner ok: ${file}`)
