import { execSync } from 'child_process'
import { copyFileSync, cpSync, mkdirSync, readdirSync, rmSync } from 'fs'
import { join } from 'path'

try {
  copyFileSync('public/logo.png', 'public/favicon.ico')
} catch (e) {
  console.log('No logo.png found, skipping favicon copy')
}

console.log('Building static export...')
execSync('next build', {
  stdio: 'inherit',
  env: { ...process.env, NEXT_EXPORT: 'true' }
})

const outDir = 'out'
const deployDir = join(outDir, 'agentverify')
rmSync(deployDir, { recursive: true, force: true })
mkdirSync(deployDir, { recursive: true })

for (const entry of readdirSync(outDir)) {
  if (entry === 'agentverify') continue
  cpSync(join(outDir, entry), join(deployDir, entry), { recursive: true })
}

console.log('Done! Upload the out/ folder to GoDaddy.')
