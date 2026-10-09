// Start the ATLAS experience service (17 §15: `npm run experience`).
import { startService } from '../src/experience/server.js';

const port = Number(process.argv[2] ?? process.env.ATLAS_EXPERIENCE_PORT ?? 8123);
const svc = await startService(port);
console.log(`ATLAS experience on http://127.0.0.1:${svc.port}/ (EXPERIENCE_VERSION atlas-experience/0.1.0)`);

const shutdown = async () => {
  await svc.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
