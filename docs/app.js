// Wardrive Go stats dashboard — renders docs/data/stats.json (committed by the scheduled GA4 fetch).
// Pure client-side, no secrets. Semi-live: re-polls the STATIC json every 90s (zero GA4 cost — cost is bounded
// by the cron, not by viewers). A range selector (24h/7d/28d/90d) switches the whole board client-side; the
// realtime (last 30 min) block is always on top.
const ACCENT = '#19e0b4', ACCENT2 = '#16c0ff', MUTED = '#7d97a0', GRID = '#1f2e33';
const $ = (id) => document.getElementById(id);
const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US'));
const fmtDur = (s) => (!s ? '—' : s >= 3600 ? `${Math.floor(s/3600)}h ${Math.round(s%3600/60)}m` : s >= 60 ? `${Math.floor(s/60)}m ${s%60}s` : `${s}s`);
const show = (id) => { const e = $(id); if (e) e.style.display = ''; };
const hide = (id) => { const e = $(id); if (e) e.style.display = 'none'; };

const LABELS = {
  notable_spotted: 'Notable devices spotted', notable_aircraft: 'Notable aircraft', drone_detected: 'Remote ID drones',
  capture: 'Captures', capture_cracked: 'Passwords cracked', upload: 'Uploads',
  adapter_engaged: 'Wi-Fi adapters engaged', sdr_connected: 'SDR connections', cluster_linked: 'Mesh cluster peer joins',
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
// Activity is wildly skewed — one huge country (US) and a long tail — so LINEAR u/max pins almost every country to
// the bottom of the ramp (they all come out the same color). A LOG map spreads that tail across the whole ramp so
// the variation is actually visible. Returns 0..1.
const heatFrac = (u, max) => max > 1 ? Math.log1p(Math.max(0, u)) / Math.log1p(max) : 0;
// AURORA TEAL — ONE hue family (deep teal → brand accent → bright mint), so no country is an odd color out: the US
// is just the brightest teal, never a clashing gold. Lightness rides the log-spread magnitude; the numbers carry the
// exact value. Matches the rest of the dashboard (accent #19e0b4).
const AURORA = [[10, 70, 60], [25, 224, 180], [150, 255, 214]];
const landColor = (u, max) => {
  const f = heatFrac(u, max) * (AURORA.length - 1), i = Math.min(AURORA.length - 2, Math.floor(f));
  const a = mix(AURORA[i], AURORA[i + 1], f - i);
  return `rgba(${a[0]},${a[1]},${a[2]},0.74)`;
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
    card('Avg engagement', fmtDur(t.avgEngagementSec), 'per user'),
    card('Events / session', t.eventsPerSession != null ? t.eventsPerSession : '—', ''),
    card('Engaged', t.engagementRate != null ? t.engagementRate + '%' : '—', 'sessions'),
    card('Engagement', fmt(t.engagementMinutes), 'minutes')
  ].join('');
  drawGlobe(r.countries || []);
  drawEvents(r.events || []);
  if ((r.timeseries || []).length) { show('tsPanel'); drawTimeseries(r.timeseries); } else hide('tsPanel');
  drawHours(r.hours || []); drawDow(r.weekdays || []); drawNewReturning(r.newReturning || {});
  list($('screens'), screenRows(r.screens), 'name', 'views');
  list($('versions'), r.versions, 'version', 'users');
  list($('countries'), notReported(r.countries, 'country'), 'country', 'users');
  list($('cities'), r.cities, 'city', 'users');
  list($('devices'), r.devices, 'model', 'users');
  list($('android'), r.android, 'os', 'users');
  list($('languages'), r.languages, 'language', 'users');
  renderFun(r.fun || {}, r.events || []);
}

// ---- Fun data: breakdowns by the app's CUSTOM dimensions (user properties + event params) ----
// Custom dimensions aren't retroactive, so every card has a friendly "collecting" state until values arrive.
const COLLECTING = 'No data for this range yet';
const FUN_COLORS = [ACCENT, 'rgba(22,192,255,.75)', '#ffcf4a', '#ff4d6d', 'rgba(25,224,180,.42)',
  'rgba(22,192,255,.38)', MUTED, 'rgba(255,207,74,.5)', 'rgba(255,77,109,.5)', '#2a3f45'];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const titleEnum = (s) => String(s || '').toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const NOTABLE_NAMES = {
  SURVEILLANCE: 'Flock & surveillance cams', TRACKER: 'Trackers', FORENSIC: 'Forensic / IMSI catchers',
  CCTV: 'CCTV cameras', FLEET: 'Fleet cams & cellular routers', EMERGENCYVEH: 'Emergency services routers', TRAFFIC: 'ALPR cameras', BODYCAM: 'Body cams',
  DRONE: 'Drones (by maker)', RFTOOL: 'RF attack tools', HACKTOOL: 'Hacking gadgets', FLIPPER: 'Flipper Zeros',
  GLASSES: 'Smart glasses', ACTIONCAM: 'Action cams', POLICE: 'Two-way radios', POLICERADAR: 'Police radar',
  LIGHTBAR: 'Emergency light bars', GUNSHOT: 'Gunshot sensors', MEDICAL: 'Medical / EMS gear',
  RETAIL: 'Retail tracking beacons', SPYCAM: 'Hidden spy cams', ADULTTOY: 'Adult toys', MESH: 'Mesh radios',
  RAIL: 'Train Wi-Fi', HEALTH: 'Health devices', HOMECAM: 'Home cams', KARR: 'KARR immobilizers',
  USERFLAG: 'Flagged by users'
};
const AIRCRAFT_NAMES = { EMERGENCY: 'Emergency squawks', SPECIAL: 'Special (VIP, blimps, display teams)',
  MILITARY: 'Military', POLICE: 'Police / government', MEDEVAC: 'Medevac' };
// Alert-switch ids (Settings › Notable alerts): a notable category name, or one of these, or AIRCRAFT_<class>.
const NOTIF_NAMES = Object.assign({}, NOTABLE_NAMES, { FINDMY_APPLE: 'Apple Find My', FINDMY_GOOGLE: 'Google Find My',
  REMOTEID_DRONE: 'Remote ID drones' });
const SKIN_NAMES = { TPP: "The Pirates' Plunder", WIGLE: 'WiGLE', WDGWARS: 'WDGWars', BBS: 'BBS', PRO: 'PRO',
  PACMAN: 'Pac-Man', SONAR_BLUE: 'Sonar Blue' };
const TARGET_NAMES = { wigle: 'WiGLE', wdgw: 'WDGWars', wardrift: 'Wardrift' };
const SECRET_NAMES = { theme: 'Secret themes', admin: 'Admin console', wpasec: 'WPA-SEC mode', peen: 'PEEN mode',
  boobs: 'BOOBS', chat: 'Chatroom' };
const lookup = (map) => (v) => map[v] || map[String(v).toUpperCase()] || map[String(v).toLowerCase()] || titleEnum(v);
const FUN_LABEL = {
  notable: lookup(NOTABLE_NAMES), aircraft: lookup(AIRCRAFT_NAMES), skin: lookup(SKIN_NAMES), secret: lookup(SECRET_NAMES),
  target: lookup(TARGET_NAMES),
  notif: (v) => /^AIRCRAFT_/i.test(v) ? 'Aircraft · ' + lookup(AIRCRAFT_NAMES)(String(v).slice(9)) : lookup(NOTIF_NAMES)(v),
  targets: (v) => v === 'none' ? 'None (no uploads)' : String(v).split('+').map(lookup(TARGET_NAMES)).join(' + '),
  ext: (v) => (v === 'true' || v === 'yes') ? 'External adapter' : (v === 'false' || v === 'no') ? 'Phone radio only' : v,
  dark: (v) => v === 'on' ? 'Dark map' : v === 'off' ? 'Light map' : v,
  capture: (v) => ({ handshake: '4-way handshakes', pmkid: 'PMKIDs' }[v] || titleEnum(v)),
  format: (v) => ({ CSV: 'CSV', GZIP: 'CSV.gz', ZIP: 'ZIP' }[v] || v),
  alerts: (v) => v === '0' ? 'None — all alerts on' : v === '5' ? '5 (app default)' : `${v} switch${v === '1' ? '' : 'es'} off`,
  adapter: (v) => v === 'phone' ? 'Phone only (no adapter)' : v,
  // Sticks that don't report "Blog V3/V4" over USB (older V3s and clones) arrive as plain "RTL-SDR".
  sdr: (v) => v === 'RTL-SDR' ? 'RTL-SDR (model not reported)' : v,
  // tool / SDR / drone labels arrive human-readable; only SHOUTY_SNAKE enum values get title-cased
  plain: (v) => v === 'unknown' ? 'Unknown' : (/_/.test(v) && /^[A-Z0-9_]+$/.test(v) ? titleEnum(v) : v)
};

const notReported = (rows, key) => (rows || []).map(r => r[key] === 'Unknown' ? Object.assign({}, r, { [key]: 'Not reported' }) : r);

// Older app versions reported the adapter as a log line ("adapter: none (last engaged: Realtek …", driver names, USB ids)
// cut at 36 characters. Reduce every value to the chip itself and merge the duplicates; "phone" = no external adapter.
function adapterName(v) {
  let s = String(v || '').replace(/^adapter:\s*/i, '').replace(/\uFFFD/g, '·').trim();
  if (/^none/i.test(s)) {
    const m = s.match(/last engaged:\s*(.*)$/i);
    if (!m) return 'phone';
    s = m[1];
  }
  s = s.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)?/ig, '').replace(/\($/, '').trim();
  const parts = s.split('·').map(x => x.trim()).filter(Boolean);
  if (!parts.length) return 'phone';
  const head = parts[0];
  // SDRs are not Wi-Fi adapters (older versions listed them here): no Wi-Fi adapter = phone.
  if (/^(rtl-?sdr|hackrf|portapack|sdr)/i.test(head)) return 'phone';
  if (/^usb ser/i.test(head) || /^esp32/i.test(head)) return 'ESP32 board';
  // Values cut off at 36 characters by older versions kept only part of the vendor ("MediaTe", "Realt").
  // Atheros = the AR9271 (the only Atheros chip supported); the others can't be narrowed to a model.
  const low = head.toLowerCase();
  if (low.length >= 3 && 'atheros'.startsWith(low)) return 'Atheros AR9271';
  for (const v of ['Realtek', 'MediaTek', 'Ralink']) {
    if (low.length >= 3 && v.toLowerCase().startsWith(low)) return v + ' (model not reported)';
  }
  return head;
}
function adapterRows(rows) {
  const by = {};
  (rows || []).forEach(r => { const n = adapterName(r.name); by[n] = (by[n] || 0) + (r.users || 0); });
  return Object.entries(by).map(([name, users]) => ({ name, users })).sort((a, b) => b.users - a.users);
}
// External adapter vs phone, from the adapter breakdown (the old has_ext_adapter value only said whether an adapter was
// receiving at that moment, so it read "phone only" for nearly everyone).
function extRows(adapters) {
  let phone = 0, ext = 0;
  adapters.forEach(r => { if (r.name === 'phone') phone += r.users; else ext += r.users; });
  return [{ name: 'true', users: ext }, { name: 'false', users: phone }].filter(r => r.users > 0);
}
// Screen names: the app names its screens from 3.1.173; older versions report none, so drop those rows.
function screenRows(rows) {
  return (rows || []).filter(r => r.name && r.name !== 'Unknown' && r.name !== 'Not reported' && r.name !== '(not set)')
    .map(r => Object.assign({}, r, { name: String(r.name).replace(/([a-z])([A-Z])/g, '$1 $2') }));
}

function funList(id, rows, countKey, labelFn, unit) {
  const el = $(id); if (!el) return;
  if (!rows || !rows.length) { el.innerHTML = `<div class="collecting">${COLLECTING}</div>`; return; }
  list(el, rows.map(r => ({ name: esc(labelFn ? labelFn(r.name) : r.name), n: r[countKey] })), 'name', 'n', unit);
}
function funDonut(id, rows, countKey, labelFn) {
  const c = $(id); if (!c) return;
  const box = c.parentElement, empty = box.nextElementSibling;
  if (!rows || !rows.length) {
    CHARTS[id]?.destroy(); delete CHARTS[id];
    box.style.display = 'none'; if (empty) { empty.style.display = ''; empty.textContent = COLLECTING; }
    return;
  }
  box.style.display = ''; if (empty) empty.style.display = 'none';
  mkChart(id, { type: 'doughnut',
    data: { labels: rows.map(r => labelFn ? labelFn(r.name) : r.name), datasets: [{ data: rows.map(r => r[countKey] || 0),
      backgroundColor: rows.map((_, i) => FUN_COLORS[i % FUN_COLORS.length]), borderColor: '#0e1619', borderWidth: 3 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '62%', plugins: { legend: { position: 'bottom', labels: { color: MUTED, font: { family: 'JetBrains Mono', size: 11 }, boxWidth: 10, padding: 12 } } } } });
}
function renderFun(f, events) {
  const k = f.counts || {};
  const since = f.since ? new Date(f.since + 'T12:00:00') : null;
  const sinceEl = $('funSince');
  if (sinceEl) sinceEl.textContent = since && !isNaN(since)
    ? 'since ' + since.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
  $('funCards').innerHTML = [
    card('Notable devices', fmt(k.notable || 0), 'spotted', true),
    card('Handshakes', fmt(k.handshakes || 0), `${fmt(k.pmkids || 0)} PMKIDs`),
    card('Passwords', fmt(k.cracked || 0), 'cracked'),
    card('Drones', fmt(k.drones || 0), 'Remote ID'),
    card('Aircraft', fmt(k.aircraft || 0), 'notable, flagged'),
    card('Secret unlocks', fmt(k.secrets || 0), 'codes punched')
  ].join('');
  const adapters = adapterRows(f.adapters);
  funList('funAdapters', adapters, 'users', FUN_LABEL.adapter);
  funDonut('funExtChart', extRows(adapters), 'users', FUN_LABEL.ext);
  funList('funNotable', f.notable, 'count', FUN_LABEL.notable);
  funDonut('funAircraftChart', f.aircraft, 'count', FUN_LABEL.aircraft);
  funList('funTools', f.tools, 'count', FUN_LABEL.plain);
  funList('funSkins', f.skins, 'users', FUN_LABEL.skin);
  funList('funDrones', f.drones, 'count', FUN_LABEL.plain);
  funDonut('funCaptureChart', f.captureKinds, 'count', FUN_LABEL.capture);
  funList('funTargets', f.uploadTargets, 'users', FUN_LABEL.targets);
  funDonut('funUploadsChart', f.uploadsBy, 'count', FUN_LABEL.target);
  funDonut('funDarkChart', f.darkMap, 'users', FUN_LABEL.dark);
  funDonut('funExportChart', f.exportFormats, 'count', FUN_LABEL.format);
  funList('funNotif', f.notifToggles, 'count', FUN_LABEL.notif);
  funList('funAlertsOff', (f.alertsOff || []).slice().sort((a, b) => (parseInt(a.name, 10) || 0) - (parseInt(b.name, 10) || 0)), 'users', FUN_LABEL.alerts);
  funList('funSecrets', f.secrets, 'count', FUN_LABEL.secret);
  funList('funSdr', f.sdr, f.sdr && f.sdr[0] && f.sdr[0].users != null ? 'users' : 'count', FUN_LABEL.sdr);
  renderChat(f.chat || {});
}
function renderChat(ch) {
  const el = $('funChat'); if (!el) return;
  const kinds = ch.byKind || [], replies = ch.replies || [], views = ch.statsViews || [];
  if (!ch.openedUsers && !ch.sent && !kinds.length) { el.innerHTML = `<div class="collecting">${COLLECTING}</div>`; return; }
  const rTrue = (replies.find(r => r.name === 'true') || {}).count || 0;
  const rAll = replies.reduce((s, r) => s + (r.count || 0), 0);
  const mini = (k, v) => `<div class="mini"><div class="k">${k}</div><div class="v">${v}</div></div>`;
  el.innerHTML = `<div class="chat-stats">${[
    mini('Dropped in', fmt(ch.openedUsers || 0)), mini('Chatters', fmt(ch.senders || 0)),
    mini('Messages', fmt(ch.sent || 0)), mini('Replies', rAll ? Math.round(rTrue / rAll * 100) + '%' : '—'),
    ...views.map(v => mini(`${esc(lookup(TARGET_NAMES)(v.name))} views`, fmt(v.count)))
  ].join('')}</div><div class="list" id="funChatKinds"></div>`;
  if (kinds.length) funList('funChatKinds', kinds, 'count', (v) => titleEnum(v));
}

// ---- charts (destroy-before-recreate so range switches + polls don't leak or collide) ----
const CHARTS = {};
const mkChart = (id, cfg) => { const c = $(id); if (!c) return; CHARTS[id]?.destroy(); CHARTS[id] = new Chart(c, cfg); };
const baseAxis = (extra) => Object.assign({ grid: { color: GRID }, ticks: { color: MUTED, font: { family: 'JetBrains Mono', size: 10 } } }, extra || {});

function drawTimeseries(tsIn) {
  // Drop the final bucket: it's the CURRENT (still-accumulating) day/hour in the snapshot, so it always reads low
  // and drew a misleading cliff at the right edge. Charting only completed buckets ends the line on real data.
  const ts = (tsIn && tsIn.length > 2) ? tsIn.slice(0, -1) : (tsIn || []);
  mkChart('tsChart', { type: 'line',
    data: { labels: ts.map(p => p.date.slice(5)), datasets: [
      { label: 'active users', data: ts.map(p => p.activeUsers), borderColor: ACCENT, backgroundColor: 'rgba(25,224,180,.12)', fill: true, tension: .35, pointRadius: 0, borderWidth: 2, yAxisID: 'y' },
      { label: 'notable spotted', data: ts.map(p => p.notable), borderColor: ACCENT2, backgroundColor: 'transparent', tension: .35, pointRadius: 0, borderWidth: 2, yAxisID: 'y1' } ] },
    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { labels: { color: MUTED, font: { family: 'JetBrains Mono', size: 10 }, boxWidth: 10 } } },
      scales: { x: baseAxis(), y: baseAxis({ position: 'left' }), y1: baseAxis({ position: 'right', grid: { drawOnChartArea: false, color: GRID } }) } } });
}
// The EVENTS chart shows what people do in the app. Left out: GA4's own bookkeeping (engagement pings, session and
// screen views, OS/app updates, cleared data, crashes), the app's version heartbeat, and the capture / crack / upload
// events whose older app versions counted repeats or nothing at all (their accurate counts are in Fun data).
const EVENT_HIDE = new Set(['user_engagement', 'session_start', 'screen_view', 'app_version_active', 'os_update',
  'app_update', 'app_clear_data', 'app_exception', 'language_set', 'capture', 'capture_cracked', 'upload']);
function drawEvents(evs) {
  const top = evs.filter(e => !EVENT_HIDE.has(e.name)).slice(0, 12);
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
let GLOBE, GEO, ALL_LABELS = [], LABEL_MAX = 1, LALT = 2.3, NUM_POOL = [], NUM_RAF = null, GLOBE_NUM_OV = null, RINGS_READY = false;
// Dot size (globe-degrees) by magnitude — small + constant across zoom. Dots are real 3D objects, so the globe
// mesh occludes the far-side ones for free.
function dotRadiusFn(d) { return 0.26 + Math.sqrt(d.users / (LABEL_MAX || 1)) * 0.5; }
// Great-circle cosine between the sub-camera point and a label. > ~0 ⇒ the label is on the NEAR hemisphere (so it
// isn't hidden behind the globe). Lets us cull back-side numbers without touching three.js internals.
function frontCos(lat1, lng1, lat2, lng2) {
  const r = Math.PI / 180, a = lat1 * r, b = lat2 * r, dl = (lng2 - lng1) * r;
  return Math.sin(a) * Math.sin(b) + Math.cos(a) * Math.cos(b) * Math.cos(dl);
}
// On-screen number font (px) by magnitude — bounded so the greedy collision test stays predictable.
function numFont(users) { return Math.round(12 + Math.sqrt(users / (LABEL_MAX || 1)) * 12); }   // 12..24px
// THE FIX for overlapping numbers: our own absolutely-positioned HTML numbers over the globe canvas, re-laid-out
// in SCREEN space every frame. globe.gl's getScreenCoords projects each country centroid; we drop the ones behind
// the globe (frontCos) then greedily keep the biggest first, SKIPPING any whose box would overlap one already
// placed. So numbers never collide at any zoom — and zooming IN spreads countries apart on screen, which lets MORE
// numbers through automatically. Runs on rAF so it tracks the auto-rotation smoothly (no labelsData churn/flicker).
function layoutNums() {
  NUM_RAF = requestAnimationFrame(layoutNums);
  if (!GLOBE || typeof GLOBE.getScreenCoords !== 'function' || !GLOBE_NUM_OV) return;
  const el = $('globe'); if (!el) return;
  const W = el.clientWidth, H = el.clientHeight;
  const pov = GLOBE.pointOfView(); LALT = pov.altitude;
  const placed = []; let used = 0;
  for (const d of ALL_LABELS) {                              // already sorted by users DESC
    if (used >= NUM_POOL.length) break;
    if (frontCos(pov.lat, pov.lng, d.lat, d.lng) < 0.12) continue;      // behind the globe / past the limb
    const sc = GLOBE.getScreenCoords(d.lat, d.lng, 0.02);
    if (!sc || sc.x < 8 || sc.y < 8 || sc.x > W - 8 || sc.y > H - 8) continue;
    const txt = fmt(d.users), f = numFont(d.users);
    const hw = f * 0.60 * txt.length / 2 + 5, hh = f / 2 + 4;           // half-box + a little padding
    let hit = false;
    for (const p of placed) { if (Math.abs(sc.x - p.x) < hw + p.hw && Math.abs(sc.y - p.y) < hh + p.hh) { hit = true; break; } }
    if (hit) continue;
    placed.push({ x: sc.x, y: sc.y, hw, hh });
    const n = NUM_POOL[used++];
    if (n.textContent !== txt) n.textContent = txt;
    n.style.cssText = 'position:absolute;left:' + sc.x + 'px;top:' + sc.y + 'px;transform:translate(-50%,-50%);' +
      "font:700 " + f + "px 'JetBrains Mono',monospace;color:#eef6f3;white-space:nowrap;pointer-events:none;" +
      'text-shadow:0 1px 3px #000,0 0 8px rgba(0,0,0,.9),0 0 16px rgba(32,240,196,.4);';   // black legibility + teal aura
  }
  for (let i = used; i < NUM_POOL.length; i++) if (NUM_POOL[i].style.display !== 'none') NUM_POOL[i].style.display = 'none';
}
function drawGlobe(countries) {
  const el = $('globe');
  const byIso = {}; countries.forEach(c => { if (c.code) byIso[c.code.toUpperCase()] = c.users; });
  const max = Math.max(...countries.map(c => c.users), 1);
  LABEL_MAX = max;
  // ALL labelable countries (have a centroid), biggest first — syncLabels() slices this per zoom level.
  ALL_LABELS = countries.filter(c => CENTROIDS[(c.code || '').toUpperCase()]).slice().sort((a, b) => b.users - a.users)
    .map(c => { const ll = CENTROIDS[c.code.toUpperCase()]; return { country: c.country, users: c.users, lat: ll[0], lng: ll[1] }; });
  $('globeLegend').innerHTML = countries.slice().sort((a, b) => b.users - a.users).slice(0, 5).map(c =>
    `<span class="chip"><span class="d" style="background:${landColor(c.users, max)}"></span>${c.country} <b>${fmt(c.users)}</b></span>`).join('');
  if (typeof Globe !== 'function') return;
  if (!GLOBE) {
    GLOBE = Globe()(el).backgroundColor('rgba(0,0,0,0)')
      .globeImageUrl('https://cdn.jsdelivr.net/npm/three-globe@2.31.0/example/img/earth-dark.jpg')
      .showAtmosphere(true).atmosphereColor('#19e0b4').atmosphereAltitude(0.26);   // fatter teal glow halo
    GLOBE.controls().autoRotate = true; GLOBE.controls().autoRotateSpeed = 0.5; GLOBE.controls().enableZoom = true;
    GLOBE.width(el.clientWidth || 600).height(el.clientHeight || 440);
    GLOBE.pointOfView({ lat: 25, lng: -30, altitude: 2.3 }, 0);   // set ONCE — never on refresh, so the user's rotation/zoom is kept
    // DOTS ONLY — the numbers are drawn by the HTML overlay (layoutNums) so they can be decluttered in screen space.
    // The dots are real 3D objects pinned to the surface, so the globe mesh occludes the far-side ones automatically.
    GLOBE.labelLat(d => d.lat).labelLng(d => d.lng).labelText(() => '')
      .labelColor(() => 'rgba(120,224,255,0.92)').labelDotRadius(dotRadiusFn).labelResolution(2).labelAltitude(0.015)
      .labelLabel(d => `<div style="font-family:JetBrains Mono,monospace;font-size:12px;color:#e8f6f2"><b style="color:#19e0b4">${d.country}</b><br>${fmt(d.users)} active users</div>`);
    // RADAR RINGS — teal rings pulse outward from each active country (on-theme: signals rippling across the map).
    // Accessors set once, data fed per-draw. The color interpolator fades the ring as it expands; busier countries
    // (higher d.f) pulse faster and wider, so hot spots visibly throb.
    GLOBE.ringColor(() => (t) => `rgba(32,240,196,${((1 - t) * 0.55).toFixed(3)})`)
      .ringMaxRadius(d => 3 + d.f * 6).ringPropagationSpeed(1.7)
      .ringRepeatPeriod(d => 1700 - d.f * 950).ringAltitude(0.012);
    window.addEventListener('resize', () => GLOBE && GLOBE.width(el.clientWidth).height(el.clientHeight));
    // Build the number overlay once, then start the per-frame declutter loop.
    el.style.position = 'relative';
    GLOBE_NUM_OV = document.getElementById('globeNums');
    if (!GLOBE_NUM_OV) {
      GLOBE_NUM_OV = document.createElement('div'); GLOBE_NUM_OV.id = 'globeNums';
      GLOBE_NUM_OV.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:2';
      el.appendChild(GLOBE_NUM_OV);
    }
    if (!NUM_RAF) layoutNums();
  }
  // Grow the reusable number-element pool to cover the current data (capped — collision limits what's shown anyway).
  const want = Math.min(ALL_LABELS.length, 90);
  while (NUM_POOL.length < want) { const n = document.createElement('div'); n.style.display = 'none'; GLOBE_NUM_OV.appendChild(n); NUM_POOL.push(n); }
  GLOBE.labelsData(ALL_LABELS);   // a dot on every labelable country; numbers come from the overlay
  // SPREAD the pulses: walk countries biggest-first and keep a ring only if it's >22° (great-circle) from every
  // ring already kept — so clustered regions (Europe) don't clump into a mess — capped at 5. Classy, not cluttered,
  // and the biggest (US) always gets one. DEFER the first feed a beat so rings aren't built before the globe's
  // coord system settles (that spammed THREE "NaN radius" warnings).
  const COS_MIN = Math.cos(22 * Math.PI / 180);
  const ringPts = [];
  for (const d of ALL_LABELS) {
    if (ringPts.length >= 5) break;
    if (ringPts.some(c => frontCos(c.lat, c.lng, d.lat, d.lng) > COS_MIN)) continue;   // too close to an existing ring
    ringPts.push({ lat: d.lat, lng: d.lng, f: heatFrac(d.users, max) });
  }
  const feedRings = () => GLOBE.ringsData(ringPts);
  if (RINGS_READY) feedRings(); else setTimeout(() => { RINGS_READY = true; feedRings(); }, 800);
  const applyPolys = (features) => GLOBE.polygonsData(features)
    .polygonCapColor(f => { const u = byIso[isoOf(f)]; return u ? landColor(u, max) : 'rgba(28,44,49,0.26)'; })
    .polygonSideColor(() => 'rgba(0,0,0,0)')   // flat caps (per-country extruded side walls spammed NaN geometry on some countries)
    .polygonStrokeColor(f => byIso[isoOf(f)] ? 'rgba(140,255,222,0.6)' : 'rgba(90,120,120,0.16)')   // active borders glow teal
    .polygonAltitude(f => byIso[isoOf(f)] ? 0.02 : 0.006).polygonsTransitionDuration(300)
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

// ---- secret-codes modal ----
(function () {
  const m = $('secretModal'), open = () => m.style.display = 'flex', close = () => m.style.display = 'none';
  $('secretPill')?.addEventListener('click', open);
  $('secretClose')?.addEventListener('click', close);
  m?.addEventListener('click', e => { if (e.target === m) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
})();
