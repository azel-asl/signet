// Build the web renderer bundle (17 §20).
// Output: web/dist/{index.html,styles.css,app.js,layout.js}
// No manual copying; this script is the documented build path.
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Find impl/ by walking up to package.json (works from scripts/ or dist/scripts/).
let implDir = dirname(fileURLToPath(import.meta.url));
while (!existsSync(join(implDir, 'package.json')) && implDir !== dirname(implDir)) {
  implDir = dirname(implDir);
}
const webDir = join(implDir, 'web');
const distDir = join(webDir, 'dist');

// Clean and compile.
rmSync(distDir, { recursive: true, force: true });
execSync(`npx tsc -p ${join(implDir, 'tsconfig.web.json')}`, { cwd: implDir, stdio: 'inherit' });

// The tsconfig outputs to web/dist/web/ and web/dist/src/ due to rootDir.
// Flatten: move web/*.js to top level, drop the rest.
const nestedWeb = join(distDir, 'web');
const nestedSrc = join(distDir, 'src');
for (const f of ['app.js', 'layout.js']) {
  cpSync(join(nestedWeb, f), join(distDir, f));
}
rmSync(nestedWeb, { recursive: true, force: true });
rmSync(nestedSrc, { recursive: true, force: true });

// Stage static assets.
cpSync(join(webDir, 'index.html'), join(distDir, 'index.html'));
cpSync(join(webDir, 'styles.css'), join(distDir, 'styles.css'));

console.log('web bundle built:', distDir);
