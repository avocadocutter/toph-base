// Copies apps/dashboard/dist → apps/api/dashboard/
// so the npm package includes the built dashboard.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src  = path.join(root, 'apps/dashboard/dist');
const dest = path.join(root, 'apps/api/dashboard');

if (!fs.existsSync(src)) {
  console.error('Dashboard not built. Run: pnpm --filter @vibebase/dashboard build');
  process.exit(1);
}

fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });
console.log(`Dashboard bundled into apps/api/dashboard/ (${fs.readdirSync(dest).length} files)`);
