// Wardrive Go stats dashboard — renders docs/data/stats.json (committed by the scheduled GA4 fetch).
// Pure client-side, no secrets. Semi-live: re-polls the STATIC json every 90s (zero GA4 cost — cost is bounded
// by the cron, not by viewers). A range selector (24h/7d/28d/90d) switches the whole board client-side; the
// realtime (last 30 min) block is always on top.
const ACCENT = '#19e0b4', ACCENT2 = '#16c0ff', MUTED = '#7d97a0', GRID = '#1f2e33';
const $ = (id) => document.getElementById(id);
const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US'));
const show = (id) => { const e = $(id); if (e) e.style.display = ''; };
const hide = (id) => { const e = $(id); if (e) e.style.display = 'none'; };

const LABELS = {
  notable_spotted: 'Notable devices found', notable_aircraft: 'Notable aircraft', drone_detected: 'Drones detected',
  capture: 'Handshakes / PMKIDs captured', capture_cracked: 'Passwords cracked', upload: 'Uploads',
  adapter_engaged: 'Wi-Fi adapters engaged', sdr_connected: 'SDR sessions', cluster_linked: 'Mesh cluster links',
  language_set: 'Language changed', export: 'Data exports', tool_opened: 'Tools opened', secret_unlock: 'Secret unlocks',
  app_version_active: 'Active app versions', session_start: 'Sessions started', screen_view: 'Screens viewed',
  user_engagement: 'User engagement', first_open: 'New installs', app_update: 'App updated', app_remove: 'Uninstalls',
  os_update: 'OS updated', app_exception: 'Crashes', app_clear_data: 'Data cleared'
};
const pretty = (name) => LABELS[name] || String(name || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const CENTROIDS = {
  US:[39.8,-98.6],CA:[56.1,-106.3],MX:[23.6,-102.6],BR:[-14.2,-51.9],AR:[-38.4,-63.6],CL:[-35.7,-71.5],
  CO:[4.6,-74.3],PE:[-9.2,-75.0],VE:[6.4,-66.6],GB:[55.4,-3.4],IE:[53.4,-8.2],FR:[46.2,2.2],ES:[40.5,-3.7],
  PT:[39.4,-8.2],DE:[51.2,10.5],NL:[52.1,5.3],BE:[50.5,4.5],LU:[49.8,6.1],CH:[46.8,8.2],AT:[47.5,14.6],
  IT:[41.9,12.6],PL:[51.9,19.1],CZ:[49.8,15.5],SK:[48.7,19.7],HU:[47.2,19.5],RO:[45.9,24.97],BG:[42.7,25.5],
  GR:[39.1,21.8],HR:[45.1,15.2],RS:[44.0,21.0],SI:[46.2,15.0],SE:[60.1,18.6],NO:[60.5,8.5],FI:[61.9,25.7],
  DK:[56.3,9.5],IS:[64.9,-19.0],EE:[58.6,25.0],LV:[56.9,24.6],LT:[55.2,23.9],UA:[48.4,31.2],BY:[53.7,27.9],
  RU:[61.5,105.3],TR:[39.0,35.2],IL:[31.0,34.8],SA:[23.9,45.1],AE:[23.4,53.8],QA:[25.3,51.2],IN:[22.0,79.0],
  PK:[30.4,69.3],BD:[23.7,90.4],LK:[7.9,80.8],CN:[35.9,104.2],JP:[36.2,138.3],KR:[36.5,127.9],TW:[23.7,121.0],
  HK:[22.3,114.2],TH:[15.9,100.99],VN:[14.1,108.3],PH:[12.9,121.8],MY:[4.2,101.98],SG:[1.35,103.8],
  ID:[-0.8,113.9],AU:[-25.3,133.8],NZ:[-41.8,171.8],ZA:[-30.6,22.9],EG:[26.8,30.8],MA:[31.8,-7.1],
  NG:[9.1,8.7],KE:[-0.02,37.9]
};
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const colorScale = (frac) => {
  const a = frac < 0.5 ? mix([22,192,255],[25,224,180], frac/0.5) : mix([25,224,180],[255,207,74],(frac-0.5)/0.5);
  return `rgb(${a[0]},${a[1]},${a[2]})`;
};
const rgba = (rgb, a) => rgb.replace('rgb(', 'rgba(').replace(')', `,${a})`);
const isoOf = (f) => (f.properties.ISO_A2 || f.properties.ISO_A2_EH || '').toUpperCase();

function ago(iso) {
  const t = Date.parse(iso); if (isNaN(t)) return iso || 'unknown';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s/60)} min ago`;
  if (s < 86400) return `${Math.round(s/3600)} h ago`;
  return `${Math.round(s/86400)} d ago`;
}
function card(k, v, sub, accent) {
  return `<div class="card"><div class="k">${k}</div><div class="v${accent ? ' accent' : ''}">${v}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;
}
function list(el, rows, nameKey, countKey, unit) {
  if (!el) return;
  if (!rows || !rows.length) { el.innerHTML = `<div class="sub" style="color:var(--muted)">no data yet</div>`; return; }
  const max = Math.max(...rows.map(r => r[countKey] || 0)) || 1;
  el.innerHTML = rows.map(r => {
    const pct = Math.round(((r[countKey] || 0) / max) * 100);
    return `<div class="row"><span class="nm">${String(r[nameKey] ?? '—')}</span><span class="track"><span class="fill" style="width:${pct}%"></span></span><span class="ct">${fmt(r[countKey])}${unit || ''}</span></div>`;
  }).join('');
}

// ---- state ----
let DATA = null, RANGE = '28d';
const RANGE_ORDER = [['1d', '24h'], ['7d', '7 days'], ['28d', '28 days'], ['90d', '90 days']];

function legacyRange(d) {   // backward-compat for the pre-"ranges" schema (brief deploy gap)
  return { totals: { active: (d.active || {}).d28, events: (d.totals28d || {}).events, sessions: (d.totals28d || {}).sessions,
      newUsers: (d.totals28d || {}).newUsers, engagementMinutes: (d.totals28d || {}).engagementMinutes },
    newReturning: d.newReturning || {}, events: d.events28d || [], countries: d.countries || [], cities: [],
    versions: d.versions || [], devices: d.devices || [], android: d.android || [], languages: [],
    hours: d.hours || [], weekdays: d.weekdays || [], screens: d.screens || [], timeseries: d.timeseries || [] };
}
function currentRange() {
  if (DATA.ranges) {
    if (!DATA.ranges[RANGE]) RANGE = DATA.ranges['28d'] ? '28d' : Object.keys(DATA.ranges)[0];
    return DATA.ranges[RANGE] || {};
  }
  return legacyRange(DATA);
}

function render(d) {
  DATA = d;
  $('content').style.display = '';
  $('stamp').textContent = 'updated ' + ago(d.generatedAt);
  $('sampleBadge').style.display = d.sample ? '' : 'none';
  renderRealtime(d.realtime || {});
  buildRangeChips(d);
  renderRange();
}

function renderRealtime(rt) {
  $('rtUsers').textContent = fmt(rt.activeUsers);
  const evs = rt.events || [];
  const emax = Math.max(...evs.map(e => e.count || 0), 1);
  $('rtEvents').innerHTML = evs.map(e => `
    <div class="evrow"><div style="flex:1">
      <div style="display:flex"><span class="nm">${pretty(e.name)}</span><span class="ct">${fmt(e.count)}</span></div>
      <div class="bar" style="width:${Math.round((e.count/emax)*100)}%"></div></div></div>`).join('') || '<div class="sub">quiet right now</div>';
}

function buildRangeChips(d) {
  const el = $('rangeSel');
  if (!d.ranges) { el.innerHTML = ''; return; }
  const avail = RANGE_ORDER.filter(([k]) => d.ranges[k]);
  if (!avail.some(([k]) => k === RANGE)) RANGE = d.ranges['28d'] ? '28d' : (avail[0] || ['28d'])[0];
  el.innerHTML = avail.map(([k, lbl]) => `<button class="rchip${k === RANGE ? ' on' : ''}" data-r="${k}">${lbl}</button>`).join('');
  el.querySelectorAll('.rchip').forEach(b => b.onclick = () => { RANGE = b.dataset.r; buildRangeChips(DATA); renderRange(); });
}

function renderRange() {
  const r = currentRange(), t = r.totals || {};
  $('rangeTitle').textContent = (r.label || '28 days');
  $('cards').innerHTML = [
    card('Active users', fmt(t.active), 'in range', true),
    card('Events', fmt(t.events), ''),
    card('Sessions', fmt(t.sessions), ''),
    card('New users', fmt(t.newUsers), ''),
    card('Avg engagement', t.avgEngagementSec ? t.avgEngagementSec + 's' : '—', 'per user'),
    card('Events / session', t.eventsPerSession != null ? t.eventsPerSession : '—', ''),
    card('Engaged', t.engagementRate != null ? t.engagementRate + '%' : '—', 'sessions'),
    card('Engagement', fmt(t.engagementMinutes), 'minutes')
  ].join('');
  drawGlobe(r.countries || []);
  drawEvents(r.events || []);
  if ((r.timeseries || []).length) { show('tsPanel'); drawTimeseries(r.timeseries); } else hide('tsPanel');
  drawHours(r.hours || []); drawDow(r.weekdays || []); drawNewReturning(r.newReturning || {});
  list($('screens'), r.screens, 'name', 'views');
  list($('versions'), r.versions, 'version', 'users');
  list($('countries'), r.countries, 'country', 'users');
  list($('cities'), r.cities, 'city', 'users');
  list($('devices'), r.devices, 'model', 'users');
  list($('android'), r.android, 'os', 'users');
  list($('languages'), r.languages, 'language', 'users');
}

// ---- charts (destroy-before-recreate so range switches + polls don't leak or collide) ----
const CHARTS = {};
const mkChart = (id, cfg) => { const c = $(id); if (!c) return; CHARTS[id]?.destroy(); CHARTS[id] = new Chart(c, cfg); };
const baseAxis = (extra) => Object.assign({ grid: { color: GRID }, ticks: { color: MUTED, font: { family: 'JetBrains Mono', size: 10 } } }, extra || {});

function drawTimeseries(ts) {
  mkChart('tsChart', { type: 'line',
    data: { labels: ts.map(p => p.date.slice(5)), datasets: [
      { label: 'active users', data: ts.map(p => p.activeUsers), borderColor: ACCENT, backgroundColor: 'rgba(25,224,180,.12)', fill: true, tension: .35, pointRadius: 0, borderWidth: 2, yAxisID: 'y' },
      { label: 'notable spotted', data: ts.map(p => p.notable), borderColor: ACCENT2, backgroundColor: 'transparent', tension: .35, pointRadius: 0, borderWidth: 2, yAxisID: 'y1' } ] },
    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { labels: { color: MUTED, font: { family: 'JetBrains Mono', size: 10 }, boxWidth: 10 } } },
      scales: { x: baseAxis(), y: baseAxis({ position: 'left' }), y1: baseAxis({ position: 'right', grid: { drawOnChartArea: false, color: GRID } }) } } });
}
function drawEvents(evs) {
  const top = evs.slice(0, 12);
  mkChart('evChart', { type: 'bar',
    data: { labels: top.map(e => pretty(e.name)), datasets: [{ data: top.map(e => e.count), backgroundColor: top.map((_, i) => i === 0 ? ACCENT : 'rgba(22,192,255,.55)'), borderRadius: 5 }] },
    options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: baseAxis(), y: baseAxis() } } });
}
function drawHours(hours) {
  const peak = Math.max(...hours.map(h => h.users), 1);
  mkChart('hourChart', { type: 'bar',
    data: { labels: hours.map(h => String(h.h).padStart(2, '0')), datasets: [{ data: hours.map(h => h.users), backgroundColor: hours.map(h => h.users === peak ? ACCENT : 'rgba(22,192,255,.5)'), borderRadius: 3 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: baseAxis(), y: baseAxis() } } });
}
function drawDow(wd) {
  const peak = Math.max(...wd.map(d => d.users), 1);
  mkChart('dowChart', { type: 'bar',
    data: { labels: wd.map(d => d.d), datasets: [{ data: wd.map(d => d.users), backgroundColor: wd.map(d => d.users === peak ? ACCENT : 'rgba(22,192,255,.5)'), borderRadius: 4 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: baseAxis(), y: baseAxis() } } });
}
function drawNewReturning(nr) {
  mkChart('nrChart', { type: 'doughnut',
    data: { labels: ['New users', 'Returning'], datasets: [{ data: [nr.new || 0, nr.returning || 0], backgroundColor: [ACCENT, 'rgba(22,192,255,.55)'], borderColor: '#0e1619', borderWidth: 3 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '62%', plugins: { legend: { position: 'bottom', labels: { color: MUTED, font: { family: 'JetBrains Mono', size: 11 }, boxWidth: 10, padding: 12 } } } } });
}

// ---- globe: country borders + choropleth + floating live numbers ----
let GLOBE, GEO;
function drawGlobe(countries) {
  const el = $('globe');
  const byIso = {}; countries.forEach(c => { if (c.code) byIso[c.code.toUpperCase()] = c.users; });
  const max = Math.max(...countries.map(c => c.users), 1);
  const labels = countries.map(c => { const ll = CENTROIDS[(c.code || '').toUpperCase()]; return ll ? { country: c.country, users: c.users, lat: ll[0], lng: ll[1] } : null; }).filter(Boolean);
  $('globeLegend').innerHTML = countries.slice().sort((a, b) => b.users - a.users).slice(0, 5).map(c =>
    `<span class="chip"><span class="d" style="background:${colorScale(c.users / max)}"></span>${c.country} <b>${fmt(c.users)}</b></span>`).join('');
  if (typeof Globe !== 'function') return;
  const w = el.clientWidth || 600, h = el.clientHeight || 440;
  if (!GLOBE) {
    GLOBE = Globe()(el).backgroundColor('rgba(0,0,0,0)')
      .globeImageUrl('https://cdn.jsdelivr.net/npm/three-globe@2.31.0/example/img/earth-dark.jpg')
      .showAtmosphere(true).atmosphereColor('#19e0b4').atmosphereAltitude(0.18);
    GLOBE.controls().autoRotate = true; GLOBE.controls().autoRotateSpeed = 0.5; GLOBE.controls().enableZoom = true;
    window.addEventListener('resize', () => GLOBE && GLOBE.width(el.clientWidth).height(el.clientHeight));
  }
  GLOBE.width(w).height(h).pointOfView({ lat: 25, lng: -30, altitude: 2.3 }, 0);
  GLOBE.labelsData(labels).labelLat(d => d.lat).labelLng(d => d.lng).labelText(d => fmt(d.users))
    .labelColor(d => colorScale(d.users / max)).labelSize(d => 2.8 + Math.sqrt(d.users / max) * 1.6)
    .labelDotRadius(d => 0.5 + Math.sqrt(d.users / max) * 0.4).labelResolution(2).labelAltitude(0.013)
    .labelLabel(d => `<div style="font-family:JetBrains Mono,monospace;font-size:12px;color:#e8f6f2"><b style="color:#19e0b4">${d.country}</b><br>${fmt(d.users)} active users</div>`);
  const applyPolys = (features) => GLOBE.polygonsData(features)
    .polygonCapColor(f => { const u = byIso[isoOf(f)]; return u ? rgba(colorScale(u / max), 0.55) : 'rgba(28,44,49,0.28)'; })
    .polygonSideColor(() => 'rgba(0,0,0,0)').polygonStrokeColor(() => 'rgba(125,151,160,0.45)')
    .polygonAltitude(f => byIso[isoOf(f)] ? 0.014 : 0.006).polygonsTransitionDuration(300)
    .polygonLabel(f => { const u = byIso[isoOf(f)]; return u ? `<div style="font-family:JetBrains Mono,monospace;font-size:12px;color:#e8f6f2"><b style="color:#19e0b4">${f.properties.ADMIN}</b><br>${fmt(u)} active users</div>` : '' });
  if (GEO) applyPolys(GEO);
  else fetch('data/countries-110m.geojson').then(r => r.json()).then(j => { GEO = j.features; applyPolys(GEO); }).catch(() => {});
}

// ---- load + semi-live refresh ----
function load() {
  fetch('data/stats.json?t=' + Date.now())
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(render)
    .catch(e => {
      if (DATA) return;  // keep showing the last good data on a transient poll failure
      $('error').style.display = ''; $('error').textContent = 'Could not load stats.json — ' + e.message + '.';
      $('stamp').textContent = 'error';
    });
}
load();
setInterval(load, 90000);   // semi-live: re-poll the static JSON every 90s (no GA4 cost)
