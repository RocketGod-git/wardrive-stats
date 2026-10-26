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

// The realtime list shows what people do in the app, not GA4's own bookkeeping (engagement pings, session and screen
// views, OS/app updates, cleared data, crashes, uninstalls), the app's version heartbeat or settings switches.
const EVENT_HIDE = new Set(['user_engagement', 'session_start', 'screen_view', 'app_version_active', 'os_update',
  'app_update', 'app_clear_data', 'app_exception', 'app_remove', 'language_set', 'notif_toggle', 'chat_stats_view']);

const LABELS = {
  notable_spotted: 'Notable devices spotted', notable_aircraft: 'Notable aircraft', drone_detected: 'Remote ID drones',
  capture: 'Captures', capture_cracked: 'Passwords cracked', upload: 'Uploads',
  adapter_engaged: 'Wi-Fi adapters engaged', sdr_connected: 'SDR connections', cluster_linked: 'Mesh cluster peer joins',
  language_set: 'Language changed', export: 'Data exports', tool_opened: 'Tools opened', secret_unlock: 'Secret unlocks',
  app_version_active: 'Active app versions', session_start: 'Sessions started', screen_view: 'Screens viewed',
  user_engagement: 'User engagement', first_open: 'New installs', app_update: 'App updated', app_remove: 'Uninstalls',
  os_update: 'OS updated', app_exception: 'Crashes', app_clear_data: 'Data cleared', device_used: 'Gear connected',
  theme_set: 'Themes changed', chat_opened: 'Chatroom visits', chat_sent: 'Chat messages'
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
// One time filter for the whole page. 'live' = the globe shows who's in the app right now, the cards show the last 24 h.
let DATA = null, RANGE = 'live';
try { RANGE = localStorage.getItem('statsRange') || 'live'; } catch (e) {}
const RANGE_ORDER = [['live', 'Live'], ['1d', '24h'], ['7d', '7 days'], ['28d', '28 days'], ['90d', '90 days']];

function legacyRange(d) {   // backward-compat for the pre-"ranges" schema (brief deploy gap)
  return { totals: { active: (d.active || {}).d28, events: (d.totals28d || {}).events, sessions: (d.totals28d || {}).sessions,
      newUsers: (d.totals28d || {}).newUsers, engagementMinutes: (d.totals28d || {}).engagementMinutes },
    newReturning: d.newReturning || {}, events: d.events28d || [], countries: d.countries || [], cities: [],
    versions: d.versions || [], devices: d.devices || [], android: d.android || [], languages: [],
    hours: d.hours || [], weekdays: d.weekdays || [], timeseries: d.timeseries || [] };
}
function currentRange() {
  if (DATA.ranges) {
    if (RANGE === 'live') return DATA.ranges['1d'] || DATA.ranges['28d'] || {};
    if (!DATA.ranges[RANGE]) RANGE = DATA.ranges['28d'] ? '28d' : Object.keys(DATA.ranges)[0];
    return DATA.ranges[RANGE] || {};
  }
  return legacyRange(DATA);
}

function render(d) {
  const live = LIVE_OK && DATA ? DATA.realtime : null;   // keep the fresher Worker realtime over the snapshot's
  DATA = d;
  if (live) DATA.realtime = live;
  $('content').style.display = '';
  $('stamp').textContent = LIVE_OK ? 'live' : 'updated ' + ago(d.generatedAt);
  $('sampleBadge').style.display = d.sample ? '' : 'none';
  renderRealtime(DATA.realtime || {});
  buildRangeChips(d);
  renderRange();
}

// GA4 reports the platform as Android / iOS; the page says iPhone.
const PLATFORM_ORDER = ['Android', 'iOS'];
const platName = (p) => p === 'iOS' ? 'iPhone' : (p || 'Other');
// The same phone icons as the app's Boards screen (Material android / phone_iphone).
const PLAT_ICON = {
  Android: '<path d="M17.6 9.48l1.84-3.18c.16-.31.04-.69-.26-.85-.29-.15-.65-.06-.83.22l-1.88 3.24c-2.86-1.21-6.08-1.21-8.94 0L5.65 5.67c-.19-.29-.58-.38-.87-.2-.28.18-.37.54-.22.83L6.4 9.48C3.3 11.25 1.28 14.44 1 18h22c-.28-3.56-2.3-6.75-5.4-8.52zM7 15.25c-.69 0-1.25-.56-1.25-1.25s.56-1.25 1.25-1.25 1.25.56 1.25 1.25-.56 1.25-1.25 1.25zm10 0c-.69 0-1.25-.56-1.25-1.25s.56-1.25 1.25-1.25 1.25.56 1.25 1.25-.56 1.25-1.25 1.25z"/>',
  iOS: '<path d="M15.5 1h-8C6.12 1 5 2.12 5 3.5v17C5 21.88 6.12 23 7.5 23h8c1.38 0 2.5-1.12 2.5-2.5v-17C18 2.12 16.88 1 15.5 1zm-4 21c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm4.5-4H7V4h9v14z"/>'
};
// iPhones report from app 2.15, the first iOS version with analytics.
const PLAT_SINCE = { iOS: 'app 2.15+' };
// Realtime hero: the live total, then one tile per platform with its share of who's in the app right now.
function rtHero(total, rows) {
  const counts = PLATFORM_ORDER.map(p => ((rows || []).find(r => r.platform === p) || {}).users || 0);
  const sum = counts.reduce((a, b) => a + b, 0);
  const tiles = PLATFORM_ORDER.map((p, i) => {
    const n = counts[i], pct = sum ? Math.round(n / sum * 100) : 0;
    return `<div class="rt-plat ${p === 'iOS' ? 'ios' : 'android'}">` +
      (PLAT_SINCE[p] ? `<span class="since">${PLAT_SINCE[p]}</span>` : '') +
      `<span class="ic"><svg viewBox="0 0 24 24" aria-hidden="true">${PLAT_ICON[p]}</svg></span>` +
      `<div class="body"><div class="n">${fmt(n)}</div><div class="l">${platName(p)}<b>${pct}%</b></div>` +
      `<div class="share"><i style="width:${pct}%"></i></div></div></div>`;
  }).join('');
  return `<div class="rt-total"><div class="live"><span class="dot"></span>LIVE NOW</div>` +
    `<div class="n">${fmt(total)}</div><div class="l">wardrivers in the app</div></div>` + tiles;
}

function renderRealtime(rt) {
  $('rtHero').innerHTML = rtHero(rt.activeUsers, rt.platforms);
  const evs = (rt.events || []).filter(e => !EVENT_HIDE.has(e.name)).slice(0, 10);
  const emax = Math.max(...evs.map(e => e.count || 0), 1);
  $('rtEvents').innerHTML = evs.map(e => `
    <div class="evrow"><div style="flex:1">
      <div style="display:flex"><span class="nm">${pretty(e.name)}</span><span class="ct">${fmt(e.count)}</span></div>
      <div class="bar" style="width:${Math.round((e.count/emax)*100)}%"></div></div></div>`).join('') || '<div class="sub">quiet right now</div>';
}

function buildRangeChips(d) {
  const el = $('rangeSel');
  if (!d.ranges) { el.innerHTML = ''; return; }
  const avail = RANGE_ORDER.filter(([k]) => k === 'live' || d.ranges[k]);
  if (!avail.some(([k]) => k === RANGE)) RANGE = 'live';
  el.innerHTML = avail.map(([k, lbl]) => `<button class="rchip${k === RANGE ? ' on' : ''}" data-r="${k}">${lbl}</button>`).join('');
  el.querySelectorAll('.rchip').forEach(b => b.onclick = () => {
    RANGE = b.dataset.r;
    try { localStorage.setItem('statsRange', RANGE); } catch (e) {}
    buildRangeChips(DATA); renderRange();
  });
}

// Every section below the globe uses the Window filter: each section header says which window it shows.
function windowLabel() {
  return RANGE === 'live' ? 'last 24h' : ((RANGE_ORDER.find(([k]) => k === RANGE) || [])[1] || '');
}
function renderRange() {
  const r = currentRange(), t = r.totals || {};
  document.querySelectorAll('.cat-head').forEach(h => {
    let w = h.querySelector('.win');
    if (!w) { w = document.createElement('span'); w.className = 'win'; h.appendChild(w); }
    w.textContent = windowLabel();
  });
  const plats = r.platforms || [];
  // A platform GA4 hasn't processed into this window yet (a new app stream takes up to a day) shows its realtime count.
  const rtPlats = (DATA.realtime || {}).platforms || [];
  const pcard = (label, p) => {
    const x = plats.find(z => z.platform === p), live = rtPlats.find(z => z.platform === p);
    if (x) return card(label, fmt(x.users), 'active users');
    if (live && live.users) return card(label, fmt(live.users), 'right now');
    return card(label, '0', 'active users');
  };
  const newPct = t.active ? Math.round(Math.min(t.newUsers || 0, t.active) / t.active * 100) : null;
  $('cards').innerHTML = [
    card('Active users', fmt(t.active), r.label || '', true),
    pcard('Android', 'Android'),
    pcard('iPhone', 'iOS'),
    card('New users', fmt(t.newUsers), newPct != null ? `${newPct}% of active` : ''),
    card('Sessions', fmt(t.sessions), t.engagementRate != null ? `${t.engagementRate}% engaged` : ''),
    card('Time in app', fmtDur(t.avgEngagementSec), 'per user')
  ].join('');
  renderGlobe();
  if ((r.timeseries || []).length) { show('tsPanel'); drawTimeseries(r.timeseries); } else hide('tsPanel');
  drawHours(r.hours || []); drawDow(r.weekdays || []);
  list($('countries'), notReported(r.countries, 'country').slice(0, 15), 'country', 'users');
  list($('cities'), (r.cities || []).filter(c => c.city !== 'Not reported' && c.city !== 'Unknown'), 'city', 'users');
  list($('languages'), r.languages, 'language', 'users');
  drawPlatforms(plats);
  // Snapshots from before the platform split carry plain lists; show them as Android-only until the next fetch.
  platGroups('versions', r.versions, 'version');
  platGroups('phones', r.phones || r.devices, 'model');
  platGroups('os', r.os || r.android, 'os');
  renderFun(r.fun || {});
}

// One list per platform (Android first), each with its own scale.
function platGroups(id, rows, key) {
  const el = $(id); if (!el) return;
  const all = (rows || []).map(x => x.platform ? x : Object.assign({ platform: 'Android' }, x));
  const groups = PLATFORM_ORDER.filter(p => all.some(x => x.platform === p));
  if (!groups.length) { el.innerHTML = `<div class="collecting">${COLLECTING}</div>`; return; }
  el.innerHTML = groups.map(p => `<div class="plat-group"><div class="dev-kind ${p === 'iOS' ? 'ios' : 'android'}">${platName(p)}</div><div class="list" id="${id}_${p}"></div></div>`).join('');
  groups.forEach(p => list($(`${id}_${p}`), all.filter(x => x.platform === p).map(x => ({ name: esc(x[key]), n: x.users })), 'name', 'n'));
}
function drawPlatforms(plats) {
  const rows = PLATFORM_ORDER.map(p => ({ name: platName(p), users: ((plats || []).find(z => z.platform === p) || {}).users || 0 }))
    .filter(r => r.users > 0);
  funDonut('platChart', rows, 'users', null, ['#3ddc84', '#d6dde0']);
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
const SKIN_NAMES = { TPP: "The Pirates' Plunder", WIGLE: 'WiGLE', WDGWARS: 'WDGWars', BBS: 'BBS', PRO: 'PRO',
  PACMAN: 'Pac-Man', SONAR_BLUE: 'Sonar Blue' };
const TARGET_NAMES = { wigle: 'WiGLE', wdgw: 'WDGWars', wardrift: 'Wardrift' };
const SECRET_NAMES = { theme: 'Secret themes', admin: 'Admin console', wpasec: 'WPA-SEC mode', peen: 'PEEN mode',
  boobs: 'BOOBS', chat: 'Chatroom', wardrift: 'Wardrift' };
const lookup = (map) => (v) => map[v] || map[String(v).toUpperCase()] || map[String(v).toLowerCase()] || titleEnum(v);
const FUN_LABEL = {
  notable: lookup(NOTABLE_NAMES), aircraft: lookup(AIRCRAFT_NAMES), skin: lookup(SKIN_NAMES), secret: lookup(SECRET_NAMES),
  target: lookup(TARGET_NAMES),
  targets: (v) => v === 'none' ? 'None (no uploads)' : String(v).split('+').map(lookup(TARGET_NAMES)).join(' + '),
  ext: (v) => (v === 'true' || v === 'yes') ? 'External adapter' : (v === 'false' || v === 'no') ? 'Phone radio only' : v,
  capture: (v) => ({ handshake: '4-way handshakes', pmkid: 'PMKIDs' }[v] || titleEnum(v)),
  adapter: (v) => v === 'phone' ? 'Phone only (no adapter)' : v,
  // tool / SDR / drone labels arrive human-readable; only SHOUTY_SNAKE enum values get title-cased
  plain: (v) => v === 'unknown' ? 'Unknown' : (/_/.test(v) && /^[A-Z0-9_]+$/.test(v) ? titleEnum(v) : v)
};

const notReported = (rows, key) => (rows || []).map(r => r[key] === 'Unknown' ? Object.assign({}, r, { [key]: 'Not reported' }) : r);

// Older app versions reported the adapter as a log line ("adapter: none (last engaged: Realtek …", driver names, USB ids)
// cut at 36 characters; newer ones join every engaged adapter with " + " (also cut at 36). Each value is split into its
// adapters and every adapter gets its own row: a user with two adapters counts once for each.
const SERIAL_BOARD = 'USB serial board (unidentified)';
const FULL_CHIP = /^(Atheros AR\d{4}|Realtek RTL\d{4}[A-Z]{0,2}|MediaTek MT\d{4}[A-Z]{1,2}|Ralink RT\d{4})$/i;
const VENDORS = ['Atheros', 'Realtek', 'MediaTek', 'Ralink'];
// One adapter entry → its Wi-Fi chip; 'phone' = no external adapter; null = not a Wi-Fi adapter (SDR, mesh radio) or a
// fragment too short to name. [cut] = this entry is the tail of a value cut off at 36 characters.
function adapterName(v, cut) {
  let s = String(v || '').replace(/^adapter:\s*/i, '').replace(/\uFFFD/g, '·').trim();
  if (/^none/i.test(s)) {
    const m = s.match(/last engaged:\s*(.*)$/i);
    if (!m) return 'phone';
    s = m[1];
  }
  s = s.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)/ig, '').replace(/\s*\([^)]*$/, '').trim();
  const parts = s.split('·').map(x => x.trim()).filter(Boolean);
  if (!parts.length) return 'phone';
  const head = parts[0];
  // SDRs and mesh radios share the USB list but aren't Wi-Fi adapters (they're counted under Top devices).
  if (/^(rtl-?sdr|hackrf|portapack|sdr|nesdr|nooelec|airspy|rad1o|lora|mesh)/i.test(head)) return null;
  // Raw USB-serial bridges: a board the app hadn't identified yet.
  if (/^(usb ser|esp32|cp210|ch9102|ch34|ftdi|ft232)/i.test(head)) return SERIAL_BOARD;
  const low = head.toLowerCase();
  // Values cut off at 36 characters kept only part of the name ("MediaTe", "Realtek RTL88"). Atheros = the AR9271 (the
  // only Atheros chip supported); the others can't be narrowed to a model. Anything else that was cut is dropped.
  if (cut && FULL_CHIP.test(head)) return head;
  for (const v of VENDORS) {
    const vl = v.toLowerCase();
    if ((low.length >= 3 && vl.startsWith(low)) || (cut && low.startsWith(vl))) return v === 'Atheros' ? 'Atheros AR9271' : v + ' (model not reported)';
  }
  return cut ? null : head;
}
// The set of adapters in one reported value (empty = phone only).
function rowAdapters(raw) {
  let s = String(raw || '');
  let cut = s.length >= 36;
  // Cut right after a separator ("A + B +"): the last name is whole, only what followed it was lost.
  if (/\s\+\s*$/.test(s)) { s = s.replace(/\s\+\s*$/, ''); cut = false; }
  const parts = s.split(' + ');
  const out = new Set();
  parts.forEach((p, i) => {
    const n = adapterName(p, cut && i === parts.length - 1);
    if (n && n !== 'phone') out.add(n);
  });
  return out;
}
function adapterRows(rows) {
  const by = {};
  (rows || []).forEach(r => {
    const set = rowAdapters(r.name);
    (set.size ? [...set] : ['phone']).forEach(n => { by[n] = (by[n] || 0) + (r.users || 0); });
  });
  return Object.entries(by).map(([name, users]) => ({ name, users })).sort((a, b) => b.users - a.users);
}
// External adapter vs phone, from the raw adapter values (the old has_ext_adapter value only said whether an adapter
// was receiving at that moment, so it read "phone only" for nearly everyone).
function extRows(rows) {
  let phone = 0, ext = 0;
  (rows || []).forEach(r => { if (rowAdapters(r.name).size) ext += r.users || 0; else phone += r.users || 0; });
  return [{ name: 'true', users: ext }, { name: 'false', users: phone }].filter(r => r.users > 0);
}

// Gear: the app's device_used event, one row per device model, grouped by kind.
// Wi-Fi adapters have their own panel (from the adapter property, which every app version reports), so they're left
// out here.
const DEVICE_KINDS = [['board', 'WardriveESP boards'], ['biscuit', 'Biscuit'], ['mesh', 'Mesh radios'],
  ['sdr', 'SDRs'], ['serial', 'Serial boards']];
function renderDevices(devices, kinds) {
  const el = $('funDevices'); if (!el) return;
  const rows = (devices || []).filter(r => r.kind !== 'wifi_adapter');
  if (!rows.length) {
    el.innerHTML = `<div class="collecting">Collecting — devices show up here as people update the app</div>`;
    return;
  }
  const kindUsers = {};
  (kinds || []).forEach(k => { kindUsers[k.name] = k.users || 0; });
  const known = DEVICE_KINDS.map(k => k[0]);
  const groups = DEVICE_KINDS.concat([...new Set(rows.map(r => r.kind))].filter(k => !known.includes(k)).map(k => [k, titleEnum(k)]));
  el.innerHTML = groups.filter(([k]) => rows.some(r => r.kind === k)).map(([k, label]) => {
    const n = kindUsers[k];
    return `<div class="dev-group"><div class="dev-kind">${esc(label)}${n ? `<span>${fmt(n)} user${n === 1 ? '' : 's'}</span>` : ''}</div>` +
      `<div class="list" id="funDev_${esc(k)}"></div></div>`;
  }).join('');
  groups.forEach(([k]) => {
    const g = rows.filter(r => r.kind === k).sort((a, b) => (b.users || 0) - (a.users || 0));
    if (g.length) list($('funDev_' + k), g.map(r => ({ name: esc(r.name), n: r.users })), 'name', 'n');
  });
}
// Settings only newer app versions report: say how many users that covers, so a small total reads right.
function coverage(id, rows) {
  const el = $(id); if (!el) return;
  const n = (rows || []).reduce((s, r) => s + (r.users || 0), 0);
  el.textContent = n ? `${fmt(n)} user${n === 1 ? '' : 's'} reporting` : '';
}
function funList(id, rows, countKey, labelFn, unit) {
  const el = $(id); if (!el) return;
  if (!rows || !rows.length) { el.innerHTML = `<div class="collecting">${COLLECTING}</div>`; return; }
  list(el, rows.map(r => ({ name: esc(labelFn ? labelFn(r.name) : r.name), n: r[countKey] })), 'name', 'n', unit);
}
function funDonut(id, rows, countKey, labelFn, colors) {
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
      backgroundColor: rows.map((_, i) => (colors || FUN_COLORS)[i % (colors || FUN_COLORS).length]), borderColor: '#0e1619', borderWidth: 3 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '62%', plugins: { legend: { position: 'bottom', labels: { color: MUTED, font: { family: 'JetBrains Mono', size: 11 }, boxWidth: 10, padding: 12 } } } } });
}
function renderFun(f) {
  const k = f.counts || {};
  $('findCards').innerHTML = [
    card('Notable devices', fmt(k.notable || 0), 'spotted', true),
    card('Captures', fmt(k.captures || 0), 'handshakes + PMKIDs'),
    card('Cracked', fmt(k.cracked || 0), 'Wi-Fi passwords'),
    card('Drones', fmt(k.drones || 0), 'Remote ID'),
    card('Aircraft', fmt(k.aircraft || 0), 'notable, flagged')
  ].join('');
  funList('funNotable', f.notable, 'count', FUN_LABEL.notable);
  funDonut('funCaptureChart', f.captureKinds, 'count', FUN_LABEL.capture);
  const fresh = (f.captureNew || []).find(r => r.name === 'yes'), capAll = (f.captureNew || []).reduce((s, r) => s + (r.count || 0), 0);
  $('covCaptures').textContent = fresh && capAll ? `${Math.round(fresh.count / capAll * 100)}% were new to that phone` : '';
  funDonut('funAircraftChart', f.aircraft, 'count', FUN_LABEL.aircraft);
  funList('funDrones', f.drones, 'count', FUN_LABEL.plain);

  funDonut('funExtChart', extRows(f.adapters), 'users', FUN_LABEL.ext);
  funList('funAdapters', adapterRows(f.adapters).filter(r => r.name !== 'phone'), 'users', FUN_LABEL.adapter);
  renderDevices(f.devices, f.deviceKinds);

  funList('funTools', f.tools, 'count', FUN_LABEL.plain);
  funList('funSkins', (f.skins || []).slice(0, 12), 'users', FUN_LABEL.skin); coverage('covSkins', f.skins);
  funList('funTargets', f.uploadTargets, 'users', FUN_LABEL.targets); coverage('covTargets', f.uploadTargets);
  funDonut('funUploadsChart', f.uploadsBy, 'count', FUN_LABEL.target);

  renderChat(f.chat || {});
  funList('funSecrets', f.secrets, 'count', FUN_LABEL.secret);
  renderWild(f.wild || {});
}

// ---- Wild stats: notable finds by GA4's rough IP city (the app never sends a location) ----
const NOT_ENOUGH = 'Not enough data yet';
const plural = (n, one, many) => `${fmt(n)} ${n === 1 ? one : (many || one + 's')}`;
// Ranked list: rows of { name, cc?, count, note? }. Top spot gets a glowing badge.
function rankList(id, rows, empty) {
  const el = $(id); if (!el) return;
  if (!rows || !rows.length) { el.innerHTML = `<div class="collecting">${empty || NOT_ENOUGH}</div>`; return; }
  const max = Math.max(...rows.map(r => r.count || 0)) || 1;
  el.innerHTML = rows.map((r, i) => {
    const pct = Math.max(4, Math.round(((r.count || 0) / max) * 100));
    return `<div class="rrow"><span class="rk">${i + 1}</span>` +
      `<span class="nm">${esc(r.name)}${r.cc ? `<i class="cc">${esc(r.cc)}</i>` : ''}${r.note ? `<small>${esc(r.note)}</small>` : ''}</span>` +
      `<span class="track"><span class="fill" style="width:${pct}%"></span></span><span class="ct">${fmt(r.count)}</span></div>`;
  }).join('');
}
const kindRows = (kinds) => (kinds || []).map(k => ({ name: FUN_LABEL.notable(k.name), count: k.count }));
const kindCount = (kinds, name) => ((kinds || []).find(k => k.name === name) || {}).count || 0;
function renderWild(w) {
  const toys = w.toys || {}, cop = w.police || {}, eyes = w.eyes || {}, hack = w.hackers || {};
  const drones = w.drones || {}, caps = w.captures || {};
  const top = (toys.cities || [])[0];
  $('toyHero').innerHTML = `<div class="emo">💗</div><div><div class="n">${fmt(toys.total || 0)}</div>` +
    `<div class="l">adult toys caught buzzing</div>` +
    `<div class="s">${toys.users ? `found by ${plural(toys.users, 'wardriver')}` : NOT_ENOUGH}</div></div>` +
    `<div class="side"><div class="n2">${top ? esc(top.name) : 'Nobody yet'}</div><div class="l2">horniest city</div></div>`;
  rankList('wildToyCities', toys.cities);
  rankList('wildToyBrands', toys.brands, 'Brands roll in as people update the app');

  const radios = kindCount(cop.kinds, 'POLICE'), gear = (cop.total || 0) - radios;
  const mini = (k, v) => `<div class="mini"><div class="k">${k}</div><div class="v">${v}</div></div>`;
  $('copTiles').innerHTML = [mini('Cop gear', fmt(gear)), mini('Body cams', fmt(kindCount(cop.kinds, 'BODYCAM'))),
    mini('Police aircraft', fmt(cop.aircraft || 0)), mini('Two-way radios', fmt(radios))].join('');
  rankList('wildCopCities', cop.cities);
  rankList('wildCopKinds', kindRows(cop.kinds));
  rankList('wildCopAir', cop.aircraftCities);

  $('wildEyesSum').innerHTML = `<b>${fmt(eyes.total || 0)}</b> Flock cams, ALPR, gunshot sensors and IMSI catchers`;
  rankList('wildEyes', eyes.cities);
  $('wildHackSum').innerHTML = `<b>${fmt(hack.total || 0)}</b> Flipper Zeros, Pineapples, Pwnagotchis and friends`;
  rankList('wildHack', hack.cities);
  $('wildDroneSum').innerHTML = `<b>${fmt(drones.total || 0)}</b> Remote ID drones overhead`;
  rankList('wildDrones', drones.cities);
  $('wildCapSum').innerHTML = `<b>${fmt(caps.total || 0)}</b> handshakes and PMKIDs grabbed, <b>${fmt(caps.cracked || 0)}</b> cracked 🔓`;
  rankList('wildCaps', (caps.countries || []).map(c => ({ name: c.name, cc: c.cc, count: c.count,
    note: c.cracked ? `🔓 ${fmt(c.cracked)}` : '' })));
  $('wildNote').textContent = `Cities are Google's rough guess from the phone's IP. A spot needs ${w.minCount || 3}+ finds to make a board.`;
}
function renderChat(ch) {
  const el = $('funChat'); if (!el) return;
  const kinds = ch.byKind || [];
  if (!ch.openedUsers && !ch.sent && !kinds.length) { el.innerHTML = `<div class="collecting">${COLLECTING}</div>`; return; }
  const photos = (kinds.find(r => r.name === 'photo') || {}).count || 0;
  const mini = (k, v) => `<div class="mini"><div class="k">${k}</div><div class="v">${v}</div></div>`;
  el.innerHTML = `<div class="chat-stats">${[
    mini('Dropped in', fmt(ch.openedUsers || 0)), mini('Chatters', fmt(ch.senders || 0)),
    mini('Messages', fmt(ch.sent || 0)), mini('Photos', fmt(photos))
  ].join('')}</div>`;
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
// The globe follows the page's one time filter: Live = who's in the app right now, otherwise the selected window.
function renderGlobe() {
  const live = RANGE === 'live', r = currentRange();
  const el = $('globeSel');
  if (el) el.textContent = live ? '● live' : ((RANGE_ORDER.find(([k]) => k === RANGE) || [])[1] || '');
  drawGlobe(live ? ((DATA.realtime || {}).countries || []) : (r.countries || []));
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
setInterval(load, 90000);   // re-poll the static JSON every 90s (no GA4 cost)

// Realtime comes from the Cloudflare Worker (GA4 Realtime API, cached ~15 s at the edge); the snapshot's realtime
// block is the fallback when it can't be reached (e.g. the github.io mirror before the Worker is deployed).
const LIVE_URL = 'https://rocketgod.dev/wardrive-stats/api/live';
let LIVE_OK = false;
function pollLive() {
  fetch(LIVE_URL + '?t=' + Date.now(), { cache: 'no-store' })
    .then(r => r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)))
    .then(rt => {
      if (!rt || rt.error || !DATA) return;
      LIVE_OK = true;
      DATA.realtime = rt;
      renderRealtime(rt);
      if (RANGE === 'live') renderGlobe();
      $('stamp').textContent = 'live';
    })
    .catch(() => {
      if (LIVE_OK && DATA) $('stamp').textContent = 'updated ' + ago(DATA.generatedAt);
      LIVE_OK = false;
    });
}
pollLive();
setInterval(pollLive, 15000);

// ---- secret-codes modal ----
(function () {
  const m = $('secretModal'), open = () => m.style.display = 'flex', close = () => m.style.display = 'none';
  $('secretPill')?.addEventListener('click', open);
  $('secretClose')?.addEventListener('click', close);
  m?.addEventListener('click', e => { if (e.target === m) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
})();
