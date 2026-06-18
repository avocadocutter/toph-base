// Copies apps/dashboard/dist → apps/orchestrator/dashboard/
// so the npm package includes the built dashboard.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src  = path.join(root, 'apps/dashboard/dist');
const dest = path.join(root, 'apps/orchestrator/dashboard');

if (!fs.existsSync(src)) {
  console.error('Dashboard not built. Run: pnpm --filter @tophbase/dashboard build');
  process.exit(1);
}

fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });
console.log(`Dashboard bundled into apps/orchestrator/dashboard/ (${fs.readdirSync(dest).length} files)`);

// Copy README and LICENSE from monorepo root into the orchestrator package
// so npm picks them up when publishing.
const orchDir = path.join(root, 'apps/orchestrator');
fs.copyFileSync(path.join(root, 'README.md'), path.join(orchDir, 'README.md'));
fs.copyFileSync(path.join(root, 'LICENSE'), path.join(orchDir, 'LICENSE'));
console.log('README.md and LICENSE copied into apps/orchestrator/');
