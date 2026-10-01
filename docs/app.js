// Wardrive Go stats dashboard — renders docs/data/stats.json (committed by the scheduled GA4 fetch).
// Pure client-side, no secrets. Cache-busted so the in-app WebView always gets the freshest commit.
const ACCENT = '#19e0b4', ACCENT2 = '#16c0ff', MUTED = '#7d97a0', GRID = '#1f2e33';
const $ = (id) => document.getElementById(id);
const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US'));

// Human labels for raw GA4 event names. Unknown events fall back to Title-Cased snake_case so a newly-added
// app event still reads cleanly before it's added here.
const LABELS = {
  notable_spotted: 'Notable devices found',
  notable_aircraft: 'Notable aircraft',
  drone_detected: 'Drones detected',
  capture: 'Handshakes / PMKIDs captured',
  capture_cracked: 'Passwords cracked',
  upload: 'Uploads',
  adapter_engaged: 'Wi-Fi adapters engaged',
  sdr_connected: 'SDR sessions',
  cluster_linked: 'Mesh cluster links',
  language_set: 'Language changed',
  export: 'Data exports',
  tool_opened: 'Tools opened',
  secret_unlock: 'Secret unlocks',
  app_version_active: 'Active app versions',
  session_start: 'Sessions started',
  screen_view: 'Screens viewed',
  user_engagement: 'User engagement',
  first_open: 'New installs'
};
const pretty = (name) => LABELS[name] ||
  String(name || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

function ago(iso) {
  const t = Date.parse(iso); if (isNaN(t)) return iso || 'unknown';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s/60)} min ago`;
  if (s < 86400) return `${Math.round(s/3600)} h ago`;
  return `${Math.round(s/86400)} d ago`;
}

function card(k, v, sub, accent) {
  return `<div class="card"><div class="k">${k}</div>
    <div class="v${accent ? ' accent' : ''}">${v}</div>
    ${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;
}

function list(el, rows, nameKey, countKey, unit) {
  if (!rows || !rows.length) { el.innerHTML = `<div class="sub" style="color:var(--muted)">no data yet</div>`; return; }
  const max = Math.max(...rows.map(r => r[countKey] || 0)) || 1;
  el.innerHTML = rows.map(r => {
    const pct = Math.round(((r[countKey] || 0) / max) * 100);
    return `<div class="row">
      <span class="nm">${String(r[nameKey] ?? '—')}</span>
      <span class="track"><span class="fill" style="width:${pct}%"></span></span>
      <span class="ct">${fmt(r[countKey])}${unit || ''}</span></div>`;
  }).join('');
}

function render(d) {
  $('content').style.display = '';
  $('stamp').textContent = 'updated ' + ago(d.generatedAt);
  if (d.sample) $('sampleBadge').style.display = '';

  // Realtime
  const rt = d.realtime || {};
  $('rtUsers').textContent = fmt(rt.activeUsers);
  const evs = rt.events || [];
  const emax = Math.max(...evs.map(e => e.count || 0), 1);
  $('rtEvents').innerHTML = evs.map(e => `
    <div class="evrow"><div style="flex:1">
      <div style="display:flex"><span class="nm">${pretty(e.name)}</span><span class="ct">${fmt(e.count)}</span></div>
      <div class="bar" style="width:${Math.round((e.count/emax)*100)}%"></div>
    </div></div>`).join('') || '<div class="sub">quiet right now</div>';

  // Headline cards
  const a = d.active || {}, t = d.totals28d || {};
  $('cards').innerHTML = [
    card('Active · today', fmt(a.d1), 'users', true),
    card('Active · 7 days', fmt(a.d7), 'users'),
    card('Active · 28 days', fmt(a.d28), 'users'),
    card('Events · 28 days', fmt(t.events), 'logged'),
    card('Sessions · 28 days', fmt(t.sessions), ''),
    card('Engagement', fmt(t.engagementMinutes), 'minutes')
  ].join('');

  // Charts
  const ts = d.timeseries || [];
  drawTimeseries(ts);
  drawEvents(d.events28d || []);

  // Lists
  list($('versions'), d.versions, 'version', 'users');
  list($('countries'), d.countries, 'country', 'users');
  list($('devices'), d.devices, 'model', 'users');
  list($('android'), d.android, 'os', 'users');
}

function baseAxis(extra) {
  return Object.assign({ grid: { color: GRID }, ticks: { color: MUTED, font: { family: 'JetBrains Mono', size: 10 } } }, extra || {});
}

function drawTimeseries(ts) {
  const labels = ts.map(p => p.date.slice(5));
  new Chart($('tsChart'), {
    type: 'line',
    data: { labels, datasets: [
      { label: 'active users', data: ts.map(p => p.activeUsers), borderColor: ACCENT, backgroundColor: 'rgba(25,224,180,.12)', fill: true, tension: .35, pointRadius: 0, borderWidth: 2, yAxisID: 'y' },
      { label: 'notable spotted', data: ts.map(p => p.notable), borderColor: ACCENT2, backgroundColor: 'transparent', tension: .35, pointRadius: 0, borderWidth: 2, yAxisID: 'y1' }
    ]},
    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { labels: { color: MUTED, font: { family: 'JetBrains Mono', size: 10 }, boxWidth: 10 } } },
      scales: { x: baseAxis(), y: baseAxis({ position: 'left' }), y1: baseAxis({ position: 'right', grid: { drawOnChartArea: false, color: GRID } }) } }
  });
}

function drawEvents(evs) {
  const top = evs.slice(0, 11);
  new Chart($('evChart'), {
    type: 'bar',
    data: { labels: top.map(e => pretty(e.name)), datasets: [{ data: top.map(e => e.count),
      backgroundColor: top.map((_, i) => i === 0 ? ACCENT : 'rgba(22,192,255,.55)'), borderRadius: 5 }] },
    options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { x: baseAxis(), y: baseAxis() } }
  });
}

fetch('data/stats.json?t=' + Date.now())
  .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
  .then(render)
  .catch(e => {
    $('error').style.display = '';
    $('error').textContent = 'Could not load stats.json — ' + e.message +
      '. If this is a fresh deploy, the scheduled job hasn’t run yet (or the GA4 secret isn’t set).';
    $('stamp').textContent = 'error';
  });
