// Live realtime stats for the dashboard: GA4 Realtime API, cached ~15 s so any number of viewers costs one set of
// GA4 calls per window. Secrets (Cloudflare Worker secrets, never in this repo): GA4_SA = the service-account JSON,
// GA4_PROPERTY_ID = the numeric property id. Returns the same shape as stats.json's `realtime` block.
const TTL_S = 15;
const SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';

let token = null, tokenExp = 0;

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlStr = (s) => b64url(new TextEncoder().encode(s));

async function accessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  if (token && now < tokenExp - 60) return token;
  const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const head = b64urlStr(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64urlStr(JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: sa.token_uri, iat: now, exp: now + 3600 }));
  const sig = b64url(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${head}.${claim}`)));
  const r = await fetch(sa.token_uri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${head}.${claim}.${sig}`,
  });
  if (!r.ok) throw new Error(`token ${r.status}`);
  const j = await r.json();
  token = j.access_token; tokenExp = now + (j.expires_in || 3600);
  return token;
}

async function realtime(env, tok, body) {
  const pid = String(env.GA4_PROPERTY_ID).replace('properties/', '').trim();
  const r = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${pid}:runRealtimeReport`, {
    method: 'POST',
    headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`realtime ${r.status}`);
  return (await r.json()).rows || [];
}

const num = (v) => Math.round(Number(v) || 0);
const desc = (metricName) => [{ metric: { metricName }, desc: true }];
const platform = (v) => ({ android: 'Android', ios: 'iOS' }[String(v).toLowerCase()] || v || 'Other');

async function build(env) {
  const sa = JSON.parse(env.GA4_SA);
  const tok = await accessToken(sa);
  const [total, events, countries, platforms] = await Promise.all([
    realtime(env, tok, { metrics: [{ name: 'activeUsers' }] }),
    realtime(env, tok, { dimensions: [{ name: 'eventName' }], metrics: [{ name: 'eventCount' }], orderBys: desc('eventCount'), limit: 24 }),
    realtime(env, tok, { dimensions: [{ name: 'country' }, { name: 'countryId' }], metrics: [{ name: 'activeUsers' }], orderBys: desc('activeUsers'), limit: 40 }),
    realtime(env, tok, { dimensions: [{ name: 'platform' }], metrics: [{ name: 'activeUsers' }], limit: 5 }),
  ]);
  return {
    generatedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    activeUsers: total[0] ? num(total[0].metricValues[0].value) : 0,
    events: events.map((x) => ({ name: x.dimensionValues[0].value, count: num(x.metricValues[0].value) })),
    countries: countries.map((x) => {
      const nm = x.dimensionValues[0].value;
      return { country: nm === '(not set)' || !nm ? 'Not reported' : nm, code: x.dimensionValues[1].value, users: num(x.metricValues[0].value) };
    }),
    platforms: platforms.map((x) => ({ platform: platform(x.dimensionValues[0].value), users: num(x.metricValues[0].value) })),
  };
}

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, OPTIONS' };

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const url = new URL(request.url);
    if (!url.pathname.endsWith('/api/live')) return new Response('not found', { status: 404, headers: CORS });
    const cache = caches.default;
    const key = new Request(`${url.origin}${url.pathname}`, { method: 'GET' });
    const hit = await cache.match(key);
    if (hit) return hit;
    try {
      const body = JSON.stringify(await build(env));
      const res = new Response(body, {
        headers: { ...CORS, 'content-type': 'application/json', 'cache-control': `public, max-age=${TTL_S}` },
      });
      ctx.waitUntil(cache.put(key, res.clone()));
      return res;
    } catch (e) {
      return new Response(JSON.stringify({ error: String(e.message || e) }), {
        status: 502, headers: { ...CORS, 'content-type': 'application/json', 'cache-control': 'no-store' },
      });
    }
  },
};
