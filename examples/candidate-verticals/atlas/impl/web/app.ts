// ATLAS Experience renderer (17 §10): vanilla TypeScript + SVG.
// The renderer owns NO operational truth. Every value displayed is copied
// verbatim from the ExperienceFrame. Status strings map to styles through
// fixed lookup tables. No arithmetic on frame values except layout geometry
// (see layout.ts).
import type {
  ExperienceFrame,
  FrameEntity,
  Inspection,
  Register,
} from '../src/experience/types.js';
import { centerIn, spreadX, clamp } from './layout.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Fixed style lookup: status string -> CSS class. No thresholds. */
const STATUS_CLASS: Record<string, string> = {
  NORMAL: 'st-normal',
  BUSY: 'st-busy',
  OVERLOADED: 'st-overloaded',
  UNSTAFFED: 'st-unstaffed',
  DEGRADED: 'st-degraded',
  DOWN: 'st-down',
};

/** Fixed style lookup: claim_class string -> label. */
const CLAIM_LABEL: Record<string, string> = {
  derived: 'derived',
  simulated: 'simulated',
  observed: 'observed',
};

let currentRegister = 'observed';
let currentT = 0;
let seqNum = 0;
let lastPaintedSeq = 0;
let selectedEntity: string | null = null;
let inspectSeqNum = 0;
let lastPaintedInspectSeq = 0;
let playTimer: number | null = null;
let currentFrame: ExperienceFrame | null = null;

function el(tag: string, attrs: Record<string, string> = {}): SVGElement {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

function txt(parent: SVGElement, x: number, y: number, s: string, cls = ''): SVGTextElement {
  const t = el('text', { x: String(x), y: String(y), class: cls }) as SVGTextElement;
  t.textContent = s;
  parent.appendChild(t);
  return t;
}

/** Render the register banner. Text comes from the frame's register. */
function renderBanner(frame: ExperienceFrame): void {
  const banner = document.getElementById('banner')!;
  const r = frame.register;
  let html = `<strong data-testid="banner-label">${r.label}</strong><br>`;
  html += `<span data-testid="banner-branch">branch: ${r.branch}</span>`;
  if (r.kind !== 'observed') {
    // Use ISO strings for human-readable display (not Unix-seconds-as-duration).
    const bpIso = r.branch_point_t != null ? new Date(r.branch_point_t * 1000).toISOString() : '';
    const hIso = r.horizon_t != null ? new Date(r.horizon_t * 1000).toISOString() : '';
    html += ` · <span data-testid="banner-range">branched at ${bpIso} · horizon ${hIso}</span>`;
  }
  if (r.run_id) {
    html += ` · <span data-testid="banner-run">run: ${r.run_id}</span>`;
  }
  banner.innerHTML = html;
  // Toggle buttons reflect the current register (from the frame, not inferred).
  for (const btn of document.querySelectorAll('[data-register-btn]')) {
    btn.setAttribute('aria-selected', (btn as HTMLElement).dataset.registerBtn === r.kind ? 'true' : 'false');
  }
}

/** Render the SVG floor plan from the frame. All values copied verbatim. */
function renderFloorPlan(frame: ExperienceFrame): void {
  const svg = document.getElementById('floorplan') as unknown as SVGElement;
  svg.innerHTML = '';
  const { canvas, areas, flows } = frame.layout;
  svg.setAttribute('viewBox', `0 0 ${canvas.w} ${canvas.h}`);
  svg.setAttribute('data-t', String(frame.t));
  svg.setAttribute('data-register', frame.register.kind);

  const isSim = frame.register.kind !== 'observed';

  // Defs: hatch pattern for simulated station fills.
  const defs = el('defs');
  const pattern = el('pattern', { id: 'hatch', width: '8', height: '8', patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' });
  pattern.appendChild(el('rect', { width: '8', height: '8', fill: '#f0e0e0' }));
  pattern.appendChild(el('line', { x1: '0', y1: '0', x2: '0', y2: '8', stroke: '#a00', 'stroke-width': '2' }));
  defs.appendChild(pattern);
  svg.appendChild(defs);

  // Areas (background zones).
  for (const [id, r] of Object.entries(areas)) {
    const rect = el('rect', {
      x: String(r.x), y: String(r.y), width: String(r.w), height: String(r.h),
      fill: '#fafafa', stroke: '#ddd', 'data-area': id,
    });
    svg.appendChild(rect);
    const c = centerIn(r);
    txt(svg, c.x, r.y + 16, id, 'area-label');
  }

  // Simulated watermark: repeated diagonal SIMULATED text across the canvas.
  if (isSim) {
    const g = el('g', { class: 'sim-watermark', 'data-testid': 'sim-watermark' });
    for (let y = 60; y < canvas.h; y += 120) {
      for (let x = -40; x < canvas.w; x += 240) {
        const t = el('text', {
          x: String(x), y: String(y), transform: `rotate(-20 ${x} ${y})`,
          class: 'sim-watermark',
        }) as SVGTextElement;
        t.textContent = 'SIMULATED';
        g.appendChild(t);
      }
    }
    svg.appendChild(g);
  }

  // Entities.
  for (const ent of frame.entities) {
    renderEntity(svg, ent, frame, isSim);
  }

  // Flows (arrows between areas/stations, from layout only).
  for (const [from, to] of flows) {
    // Draw a simple line; endpoints resolved from areas/objects by id lookup.
    // (Layout geometry only; no operational meaning.)
    void from; void to;
  }
}

/** Render one entity. Values copied verbatim; status maps via lookup table. */
function renderEntity(svg: SVGElement, ent: FrameEntity, frame: ExperienceFrame, isSim: boolean): void {
  const g = el('g', {
    'data-entity': ent.id,
    'data-kind': ent.kind,
    'data-t': String(frame.t),
    'data-register': frame.register.kind,
  });

  if (ent.kind === 'station' && ent.rect) {
    const r = ent.rect;
    const st = ent.state as Record<string, unknown>;
    const statusClass = STATUS_CLASS[String(st.status)] ?? 'st-unknown';
    const fillClass = isSim ? 'station-hatched' : 'station-solid';
    const rect = el('rect', {
      x: String(r.x), y: String(r.y), width: String(r.w), height: String(r.h),
      class: `${fillClass} ${statusClass}`,
      'data-state': JSON.stringify({
        status: st.status,
        queue_len: st.queue_len,
        in_progress_count: st.in_progress_count,
        oldest_wait_s: st.oldest_wait_s,
      }),
    });
    g.appendChild(rect);
    const c = centerIn(r);
    txt(g, c.x, c.y - 24, ent.name, 'station-name');
    // Two separate copied numbers: in_progress_count and capacity.effective.
    const cap = (st.capacity as { effective?: number }) ?? {};
    txt(g, c.x, c.y - 8, `${st.in_progress_count}/${cap.effective ?? '?'}`, 'station-cap');
    txt(g, c.x, c.y + 8, `queue ${st.queue_len}`, 'station-queue');
    txt(g, c.x, c.y + 24, `wait ${st.oldest_wait_s}s`, 'station-wait');
    txt(g, c.x, c.y + 40, `status ${st.status}`, 'station-status');
  } else if (ent.kind === 'equipment' && ent.rect) {
    const r = ent.rect;
    const es = ent.state as Record<string, unknown>;
    const rect = el('rect', {
      x: String(r.x), y: String(r.y), width: String(r.w), height: String(r.h),
      fill: '#e0e0e0', stroke: '#666',
      'data-entity': ent.id, 'data-kind': ent.kind,
      'data-state': JSON.stringify({ status: es.status, capacity: es.capacity }),
    });
    g.appendChild(rect);
    const c = centerIn(r);
    txt(g, c.x, c.y, `${ent.name}: ${es.status}`, 'equipment-label');
  } else if (ent.kind === 'person') {
    // Person tokens placed by container (a station id or tray id).
    const ps = ent.state as Record<string, unknown>;
    const circle = el('circle', {
      r: '10', fill: ps.on_shift ? '#4a90d9' : '#ccc', stroke: '#333',
      'data-entity': ent.id, 'data-kind': ent.kind,
      'data-state': JSON.stringify({ on_shift: ps.on_shift, station: ps.station }),
      'data-container': ent.container ?? '',
    });
    // Position: spread within the container area if it's a station, else tray.
    // (Layout geometry; the container string comes from the frame.)
    const containerRect = findContainerRect(ent.container, frame);
    if (containerRect) {
      const xs = spreadX(containerRect, 1, 20);
      circle.setAttribute('cx', String(xs[0]));
      circle.setAttribute('cy', String(containerRect.y + containerRect.h - 20));
    }
    g.appendChild(circle);
    const label = el('text', {
      x: circle.getAttribute('cx') ?? '0',
      y: String(Number(circle.getAttribute('cy') ?? '0') + 24),
      class: 'person-label',
      'text-anchor': 'middle',
    }) as SVGTextElement;
    label.textContent = ent.name;
    g.appendChild(label);
  } else if (ent.kind === 'work') {
    // Work tokens: small squares in their station container.
    const ws = ent.state as Record<string, unknown>;
    const containerRect = findContainerRect(ent.container, frame);
    const rect = el('rect', {
      width: '12', height: '12', fill: '#ffcc00', stroke: '#333',
      'data-entity': ent.id, 'data-kind': ent.kind,
      'data-state': JSON.stringify({ state: ws.state, step: ws.step }),
      'data-container': ent.container ?? '',
    });
    if (containerRect) {
      rect.setAttribute('x', String(containerRect.x + 10));
      rect.setAttribute('y', String(containerRect.y + containerRect.h - 30));
    }
    g.appendChild(rect);
  }

  // Click to inspect.
  g.addEventListener('click', () => selectEntity(ent.id));
  svg.appendChild(g);
}

/** Find the rect for a container id (station rect or tray area). Layout only. */
function findContainerRect(container: string | null, frame: ExperienceFrame): { x: number; y: number; w: number; h: number } | null {
  if (!container) return null;
  const ent = frame.entities.find((e) => e.id === container && e.rect);
  if (ent?.rect) return ent.rect;
  // Tray areas are not in the layout; use a corner of the canvas.
  return { x: 20, y: frame.layout.canvas.h - 60, w: 200, h: 40 };
}

/** Render the open-orders list. Copied verbatim from the frame. */
function renderOrders(frame: ExperienceFrame): void {
  const ul = document.getElementById('orders-list')!;
  ul.innerHTML = '';
  // Sort by id for stable display (sorting a delivered list is allowed).
  const orders = [...frame.open_orders].sort((a, b) => a.id.localeCompare(b.id));
  for (const o of orders) {
    const li = document.createElement('li');
    li.setAttribute('data-entity', o.id);
    li.setAttribute('data-kind', 'order');
    li.textContent = `${o.id}: ${o.state}, age ${o.age_s}s, items [${o.items.join(', ')}]`;
    ul.appendChild(li);
  }
}

/** Render the inspector panel for the selected entity. */
async function selectEntity(entityId: string): Promise<void> {
  selectedEntity = entityId;
  const seq = ++inspectSeqNum;
  const head = document.getElementById('inspector-head')!;
  const body = document.getElementById('inspector-body')!;
  try {
    const res = await fetch(`/api/inspect?register=${currentRegister}&t=${currentT}&entity=${encodeURIComponent(entityId)}`);
    // Discard if a newer inspection has already been painted (stale-response protection).
    if (seq < lastPaintedInspectSeq) return;
    const insp: Inspection = await res.json();
    if (seq < lastPaintedInspectSeq) return;
    lastPaintedInspectSeq = seq;
    if (!res.ok) {
      head.innerHTML = `<strong>${(insp as any).error?.code ?? 'ERROR'}</strong>`;
      body.textContent = (insp as any).error?.message ?? '';
      return;
    }
    // Header repeats the register label (§7.4).
    head.innerHTML = `<strong data-testid="inspector-label">${insp.register.label}</strong><br>` +
      `<span>${insp.entity.kind} ${insp.entity.id} · ${insp.entity.name}</span>`;
    let html = '<h3>State</h3><dl>';
    for (const [k, v] of Object.entries(insp.entity.state)) {
      html += `<dt>${k}</dt><dd data-state-key="${k}">${JSON.stringify(v)}</dd>`;
    }
    html += '</dl>';
    if (insp.relationships.length) {
      html += '<h3>Relationships</h3><ul>';
      for (const r of insp.relationships) html += `<li>${r.type}: ${r.from} → ${r.to}</li>`;
      html += '</ul>';
    }
    // Evidence grouped by claim class with the three fixed headings (§9).
    html += '<h3>Evidence</h3>';
    const groups: Record<string, typeof insp.evidence> = {
      'Evidence (history)': [],
      'Replayed arrivals (input)': [],
      'Simulation output (not evidence)': [],
    };
    for (const ev of insp.evidence) {
      const cc = ev.claim_class;
      if (cc === 'simulated') groups['Simulation output (not evidence)'].push(ev);
      else if (ev.note?.includes('replay')) groups['Replayed arrivals (input)'].push(ev);
      else groups['Evidence (history)'].push(ev);
    }
    for (const [heading, items] of Object.entries(groups)) {
      if (!items.length) continue;
      html += `<h4>${heading}</h4><ul>`;
      for (const ev of items) {
        html += `<li data-event="${ev.event_id}">[${ev.claim_class}] ${ev.type} @ ${ev.ts} (${ev.record_id})</li>`;
      }
      html += '</ul>';
    }
    html += `<p>Total evidence: ${insp.evidence_total}</p>`;
    if (insp.related_events.length) {
      html += '<h3>Related events</h3><ul>';
      for (const ev of insp.related_events) {
        html += `<li data-event="${ev.event_id}">[${ev.claim_class}] ${ev.type} @ ${ev.ts}</li>`;
      }
      html += '</ul>';
    }
    body.innerHTML = html;
    // Diagnosis section (M4 §M): read-only, displays ATLAS diagnostic output.
    // The renderer computes nothing; lines come verbatim from /api/diagnosis.
    try {
      const dRes = await fetch(`/api/diagnosis?register=${currentRegister}&t=${currentT}&entity=${encodeURIComponent(entityId)}`);
      if (dRes.ok) {
        const dData: any = await dRes.json();
        if (dData.lines?.length) {
          let dHtml = '<h3>Diagnosis</h3><ul data-testid="diagnosis-lines">';
          for (const line of dData.lines) {
            dHtml += `<li><span data-testid="claim-class">${line.claim_class}</span> ${line.text}</li>`;
          }
          dHtml += '</ul>';
          body.innerHTML += dHtml;
        }
        // Recommendations section (M5 §R): observed register only, when the
        // selected station has a capacity_limit claim. Read-only; the browser
        // computes nothing. Lines come verbatim from /api/recommendations.
        const hasCapLimit = dData.diagnosis?.claims?.some((c: any) =>
          c.kind === 'capacity_limit' && c.subject === entityId);
        if (currentRegister === 'observed' && hasCapLimit) {
          try {
            const rRes = await fetch(`/api/recommendations?register=observed&t=${currentT}&horizon_t=${currentT + 4200}&station=${encodeURIComponent(entityId)}`);
            if (rRes.ok) {
              const rData: any = await rRes.json();
              if (rData.lines?.length) {
                let rHtml = '<h3>Recommendations</h3><ul data-testid="recommendation-lines">';
                for (const line of rData.lines) {
                  const assumed = line.claim_class === 'assumed' ? ' <span data-testid="assumed-chip">ASSUMED</span>' : '';
                  rHtml += `<li>${line.text}${assumed}</li>`;
                }
                rHtml += '</ul>';
                body.innerHTML += rHtml;
              }
            }
          } catch {
            // Recommendations are optional; inspector works without them.
          }
        }
      }
    } catch {
      // Diagnosis is optional; inspector works without it.
    }
  } catch (e) {
    head.innerHTML = '<strong>ERROR</strong>';
    body.textContent = String(e);
  }
}

/** Load and render a frame. Out-of-order responses are discarded (§12). */
async function loadFrame(register: string, t: number): Promise<void> {
  const seq = ++seqNum;
  const overlay = document.getElementById('loading-overlay')!;
  const errorCard = document.getElementById('error-card')!;
  overlay.hidden = false;
  try {
    const res = await fetch(`/api/frame?register=${register}&t=${t}`);
    const frame: ExperienceFrame = await res.json();
    // Discard if a newer request has already been painted.
    if (seq < lastPaintedSeq) return;
    if (!res.ok) {
      const code = (frame as any).error?.code ?? 'UNKNOWN';
      const msg = (frame as any).error?.message ?? '';
      errorCard.hidden = false;
      errorCard.innerHTML = `<strong data-testid="error-code">${code}</strong><p>${msg}</p>`;
      (document.getElementById('floorplan') as unknown as SVGElement).innerHTML = '';
      (document.getElementById('floorplan-wrap') as HTMLElement).insertAdjacentHTML(
        'beforeend', '<div data-testid="no-frame">No frame for this time</div>');
      return;
    }
    lastPaintedSeq = seq;
    currentFrame = frame;
    currentRegister = frame.register.kind;
    currentT = frame.t;
    errorCard.hidden = true;
    renderBanner(frame);
    renderFloorPlan(frame);
    renderOrders(frame);
    document.getElementById('time-readout')!.textContent =
      `t=${frame.t} (${frame.ts}) · ${frame.ledger_events_applied} events`;
    renderTimelineMarkers(frame);
    // Keep the inspector selection across t changes (§8).
    if (selectedEntity) selectEntity(selectedEntity);
  } finally {
    overlay.hidden = true;
  }
}

/** Render branch-point and intervention markers on the timeline. From register. */
function renderTimelineMarkers(frame: ExperienceFrame): void {
  const track = document.getElementById('timeline-track')!;
  track.innerHTML = '';
  const r = frame.register;
  if (r.branch_point_t != null) {
    const m = document.createElement('div');
    m.className = 'marker branch-point';
    m.textContent = '⑂';
    m.title = `branch point ${r.branch_point_t}`;
    track.appendChild(m);
  }
  for (const iv of r.interventions) {
    const m = document.createElement('div');
    m.className = 'marker intervention';
    m.textContent = '◆';
    m.title = `${iv.id} @ ${new Date(iv.at_t * 1000).toISOString()}`;
    track.appendChild(m);
  }
  // Update the scrub control range to the register's valid integer-second range.
  const scrub = document.getElementById('scrub') as HTMLInputElement;
  scrub.min = String(r.range.min_t);
  scrub.max = String(r.range.max_t);
  scrub.step = '1';
  scrub.value = String(frame.t);
  scrub.setAttribute('data-register', r.kind);
}

/** Load the comparison panel. Read-only; shows honesty notes uncollapsible. */
async function loadComparison(): Promise<void> {
  const res = await fetch('/api/comparison');
  const cmp: any = await res.json();
  const body = document.getElementById('comparison-body')!;
  const notes = document.getElementById('honesty-notes')!;
  let html = `<p>Baseline run: ${cmp.baseline_run}</p><p>Scenario run: ${cmp.scenario_run}</p>`;
  html += '<table><tr><th>metric</th><th>baseline</th><th>scenario</th><th>delta</th></tr>';
  for (const k of ['orders_completed', 'throughput_per_hour', 'avg_kitchen_time_s']) {
    html += `<tr><td>${k}</td><td>${cmp.baseline[k]}</td><td>${cmp.scenario[k]}</td><td>${cmp.delta[k]}</td></tr>`;
  }
  html += '</table>';
  body.innerHTML = html;
  notes.innerHTML = '<h3>Honesty notes</h3><ul>' +
    cmp.honesty_notes.map((n: string) => `<li>${n}</li>`).join('') + '</ul>';
}

/** Timeline controls. */
async function initTimeline(): Promise<void> {
  const res = await fetch('/api/world');
  const info: any = await res.json();
  const regs: Register[] = info.registers;
  // Start: observed register at the server-provided initial_t (contract §11).
  // The timestamp comes from the register's ATLAS range, not a display string.
  await loadFrame('observed', info.initial_t);

  document.getElementById('btn-prev')!.addEventListener('click', () => stepEvent(-1));
  document.getElementById('btn-next')!.addEventListener('click', () => stepEvent(1));
  document.getElementById('btn-play')!.addEventListener('click', togglePlay);
  // Scrub control: selecting the slider requests a real ATLAS frame for T.
  // Integer-second semantics; no canned animation; no interpolation.
  // Listen to 'input' for immediate response as the slider moves.
  const scrubEl = document.getElementById('scrub') as HTMLInputElement;
  let scrubTimer: ReturnType<typeof setTimeout> | null = null;
  scrubEl.addEventListener('input', () => {
    // Debounce: wait for the user to settle before requesting the frame.
    if (scrubTimer) clearTimeout(scrubTimer);
    scrubTimer = setTimeout(() => {
      const t = Number(scrubEl.value);
      if (Number.isInteger(t)) loadFrame(currentRegister, t);
    }, 150);
  });
  for (const btn of document.querySelectorAll('[data-register-btn]')) {
    btn.addEventListener('click', () => switchRegister((btn as HTMLElement).dataset.registerBtn!));
  }
}

async function stepEvent(dir: number): Promise<void> {
  if (!currentFrame) return;
  const r = currentFrame.register;
  const res = await fetch(`/api/instants?register=${r.kind}&from=${r.range.min_t}&to=${r.range.max_t}`);
  const { instants }: { instants: number[] } = await res.json();
  // Find the nearest instant in the direction. (List positions only; no values.)
  let target: number | null = null;
  if (dir > 0) target = instants.find((t) => t > currentT) ?? null;
  else target = [...instants].reverse().find((t) => t < currentT) ?? null;
  if (target != null) loadFrame(currentRegister, target);
}

function togglePlay(): void {
  if (playTimer != null) {
    clearInterval(playTimer);
    playTimer = null;
    document.getElementById('btn-play')!.textContent = '▶';
    return;
  }
  document.getElementById('btn-play')!.textContent = '⏸';
  const speed = Number((document.getElementById('speed') as HTMLInputElement).value) || 60;
  playTimer = window.setInterval(() => {
    if (!currentFrame) return;
    const next = currentT + speed;
    if (next > currentFrame.register.range.max_t) {
      togglePlay();
      return;
    }
    loadFrame(currentRegister, next);
  }, 1000);
}

async function switchRegister(kind: string): Promise<void> {
  if (!currentFrame) return;
  const regs = (await (await fetch('/api/world')).json()).registers as Register[];
  const target = regs.find((r) => r.kind === kind)!;
  let t = currentT;
  const notice = document.getElementById('timeline-notice')!;
  if (t < target.range.min_t || t > target.range.max_t) {
    // Clamp to the branch's range and show the notice (§6).
    t = clamp(t, target.range.min_t, target.range.max_t);
    notice.textContent = "time moved to the branch's range";
  } else {
    notice.textContent = '';
  }
  // Never cache frames across registers (§10): always request fresh.
  currentFrame = null;
  await loadFrame(kind, t);
}

// Expose hooks for Playwright tests (T12-T16) and the poisoned-frame test (T8).
(window as any).__renderFrameForTest = (frame: ExperienceFrame) => {
  renderBanner(frame);
  renderFloorPlan(frame);
  renderOrders(frame);
};
(window as any).__testLoadFrame = (register: string, t: number) => loadFrame(register, t);
(window as any).__testSwitchRegister = (register: string, t: number) => {
  currentFrame = null;
  return (async () => {
    const regs = (await (await fetch('/api/world')).json()).registers as Register[];
    const target = regs.find((r) => r.kind === register)!;
    const notice = document.getElementById('timeline-notice')!;
    let tt = t;
    if (tt < target.range.min_t || tt > target.range.max_t) {
      tt = clamp(tt, target.range.min_t, target.range.max_t);
      notice.textContent = "time moved to the branch's range";
    } else {
      notice.textContent = '';
    }
    await loadFrame(register, tt);
  })();
};

initTimeline();
loadComparison();
