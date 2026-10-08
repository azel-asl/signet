// Local experience service (17 §3, §11): node:http on 127.0.0.1, GET only,
// JSON bodies. The service's only engine-facing import is capabilities.ts.
// Zero runtime dependencies.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize } from 'node:path';
import {
  runScenario,
  compareScenariosFacade,
  listInstants,
} from '../capabilities.js';
import { loadSource } from './source.js';
import { initRegisters, listRegisters, projectFrame, inspectEntity, getRegister, ProjectError } from './project.js';
import type { RegisterKind } from './types.js';

const here = dirname(fileURLToPath(import.meta.url));
// Find impl/ (works from src/ or dist/src/), then web/dist.
import { existsSync } from 'node:fs';
let sdir = here;
while (!existsSync(join(sdir, 'package.json')) && sdir !== dirname(sdir)) {
  sdir = dirname(sdir);
}
const WEB_DIR = join(sdir, 'web', 'dist');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const bytes = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': bytes.length });
  res.end(bytes);
}

function sendErr(res: ServerResponse, code: string, message: string, status = 400): void {
  sendJson(res, status, { error: { code, message } });
}

async function serveStatic(pathname: string, res: ServerResponse): Promise<void> {
  const rel = pathname === '/' ? '/index.html' : pathname;
  // Prevent path traversal: stay inside WEB_DIR.
  const full = normalize(join(WEB_DIR, rel));
  if (!full.startsWith(WEB_DIR)) {
    sendErr(res, 'NOT_FOUND', 'not found', 404);
    return;
  }
  try {
    const bytes = await readFile(full);
    const ext = full.slice(full.lastIndexOf('.'));
    res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream', 'content-length': bytes.length });
    res.end(bytes);
  } catch {
    sendErr(res, 'NOT_FOUND', 'not found', 404);
  }
}

export interface ServiceState {
  worldId: string;
  worldName: string;
  scenarioName: string;
  comparison: unknown;
}

let state: ServiceState | null = null;

/** Start-up: load source, run both M2 arms once via runScenario, deep-freeze, init registers. */
export async function initService(): Promise<ServiceState> {
  const { world, ledger, scenarioPath, scenarioName, scenarioId, tB, tH } = await loadSource();
  const { baseline, scenario } = await runScenario({ world, ledger, scenarioPath });
  const b: any = baseline;
  const s: any = scenario;
  // Deep-freeze: the service never mutates arms after start-up (invariant 6).
  deepFreeze(b);
  deepFreeze(s);
  initRegisters({
    world,
    historyLedger: ledger,
    baseline: { branch: b.receipt.branch, events: b.events, receipt: b.receipt },
    scenarioArm: { branch: s.receipt.branch, events: s.events, receipt: s.receipt },
    scenarioName,
    tB,
    tH,
  });
  const comparison = compareScenariosFacade({
    world, baseline: b, scenario: s, scenarioId,
  });
  state = {
    worldId: (world.metadata as { id: string }).id,
    worldName: (world.metadata as { name?: string }).name ?? '',
    scenarioName,
    comparison,
  };
  return state;
}

function deepFreeze(o: unknown): void {
  if (o && typeof o === 'object') {
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v);
    Object.freeze(o);
  }
}

async function handleApi(pathname: string, params: URLSearchParams, res: ServerResponse): Promise<void> {
  const st = state!;
  if (pathname === '/api/world') {
    const regs = listRegisters();
    // Initial t: 18:20 on the observed register (contract §11).
    // Derived from the world's origin date, not from a display string.
    const { world: w } = await loadSource();
    const originDate = new Date((w.time as { origin: string }).origin);
    originDate.setHours(18, 20, 0, 0);
    const initial_t = Math.floor(originDate.getTime() / 1000);
    sendJson(res, 200, {
      world: { id: st.worldId, name: st.worldName },
      registers: regs,
      scenario_name: st.scenarioName,
      initial_t,
    });
    return;
  }
  if (pathname === '/api/frame') {
    const register = params.get('register') ?? '';
    const tParam = params.get('t');
    if (tParam === null) {
      sendErr(res, 'T_NOT_INTEGER', 'missing required parameter: t');
      return;
    }
    const t = Number(tParam);
    try {
      const frame = projectFrame(register as RegisterKind, t);
      sendJson(res, 200, frame);
    } catch (e) {
      if (e instanceof ProjectError) sendErr(res, e.code, e.message);
      else sendErr(res, 'INTERNAL', 'internal error', 500);
    }
    return;
  }
  if (pathname === '/api/inspect') {
    const register = params.get('register') ?? '';
    const t = Number(params.get('t'));
    const entity = params.get('entity') ?? '';
    try {
      const inspection = inspectEntity(register as RegisterKind, t, entity);
      sendJson(res, 200, inspection);
    } catch (e) {
      if (e instanceof ProjectError) sendErr(res, e.code, e.message);
      else sendErr(res, 'INTERNAL', 'internal error', 500);
    }
    return;
  }
  if (pathname === '/api/instants') {
    const register = params.get('register') ?? '';
    const from = Number(params.get('from'));
    const to = Number(params.get('to'));
    try {
      const { ledger } = getRegister(register);
      sendJson(res, 200, { instants: listInstants({ ledger, from, to }) });
    } catch (e) {
      if (e instanceof ProjectError) sendErr(res, e.code, e.message);
      else sendErr(res, 'INTERNAL', 'internal error', 500);
    }
    return;
  }
  if (pathname === '/api/comparison') {
    sendJson(res, 200, st.comparison);
    return;
  }
  sendErr(res, 'NOT_FOUND', 'not found', 404);
}

export function createApp(): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    void (async () => {
      try {
        if (req.method !== 'GET') {
          sendErr(res, 'METHOD_NOT_ALLOWED', 'only GET is supported', 405);
          return;
        }
        const url = new URL(req.url ?? '/', 'http://127.0.0.1');
        if (url.pathname.startsWith('/api/')) {
          await handleApi(url.pathname, url.searchParams, res);
        } else {
          await serveStatic(url.pathname, res);
        }
      } catch {
        sendErr(res, 'INTERNAL', 'internal error', 500);
      }
    })();
  };
}

/** Start the service on 127.0.0.1. Fails loudly if validation fails. */
export async function startService(port: number): Promise<{ port: number; close: () => Promise<void> }> {
  await initService();
  const server = createServer(createApp());
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    // Bind only to 127.0.0.1 (§11).
    server.listen(port, '127.0.0.1', () => resolve());
  });
  const addr = server.address();
  const actualPort = typeof addr === 'object' && addr ? addr.port : port;
  return {
    port: actualPort,
    close: () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}
