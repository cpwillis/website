// Mirrors gitfolio at cpwillis.dev, falling back to public/ when gitfolio is slow or down.
// /terms and /privacy stay local: other projects link them, so they must not depend on gitfolio.

const TIMEOUT_MS = 3000
const HEALTH_OK_TTL = 60    // how long a healthy verdict is trusted
const HEALTH_BAD_TTL = 30   // shorter when degraded, so recovery shows quickly

// Exact paths only. A prefix match sends /api/anything upstream, where gitfolio's SPA fallback
// answers 200, so a dead URL would look alive. Everything else comes from public/ and 404s.
// Icons are gitfolio's too: it redirects the legacy paths to the sized avatar, so they never stale.
const ICONS = new Set(['/favicon.svg', '/favicon.ico', '/apple-touch-icon.png'])
const PROXIED = p =>
  p === '/' || p === '/api/repos' || ICONS.has(p) || /^\/sc\/[^/]+\/[^/]+$/.test(p)

// The shell 200s even with a broken feed behind it, so ask the feed itself. Cached, so it costs
// one upstream call a minute rather than one per visitor.
async function feedHealthy(origin, user) {
  const k = new Request(`https://health/${user}`)
  const cache = caches.default
  const hit = await cache.match(k)
  if (hit) return (await hit.text()) === '1'
  let ok = false
  try {
    const r = await fetch(new URL(`/api/repos?user=${encodeURIComponent(user)}`, origin), {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    ok = r.ok
  } catch {
    ok = false
  }
  await cache.put(k, new Response(ok ? '1' : '', {
    headers: { 'cache-control': `max-age=${ok ? HEALTH_OK_TTL : HEALTH_BAD_TTL}` },
  }))
  return ok
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url)
    const path = url.pathname

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return new Response('method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } })
    }
    if (!PROXIED(path)) return env.ASSETS.fetch(req)

    const origin = env.GITFOLIO_ORIGIN
    const user = env.GITFOLIO_USER
    if (!origin || !user) return fallback(req, env, path)

    // '/' is that user's portfolio; the dynamic routes name the user, so gitfolio's default never applies.
    const upstream = new URL(path === '/' ? `/${user}` : path, origin)
    for (const [k, v] of url.searchParams) upstream.searchParams.set(k, v)
    if (path !== '/') upstream.searchParams.set('user', user)

    try {
      // Probe alongside the fetch: serialising them doubles the worst case for no extra information.
      // A broken feed means the static page is the better answer for '/'.
      const [res, healthy] = await Promise.all([
        fetch(upstream, {
          method: req.method,
          headers: {
            accept: req.headers.get('accept') || '*/*',
            'user-agent': req.headers.get('user-agent') || '',
            // lets gitfolio spot a repo pointing back here and hide it
            'x-forwarded-host': url.hostname,
          },
          redirect: 'manual',
          signal: AbortSignal.timeout(TIMEOUT_MS),
        }),
        path === '/' ? feedHealthy(origin, user) : true,
      ])
      if (!healthy) return fallback(req, env, path)
      // A 404 from gitfolio answers one resource, it does not mean the mirror is unusable, so pass
      // it through with its own body rather than replacing it with a blank one. Only a server error
      // is an outage. "/" is the exception: a profile page that will not render should become the
      // static page whatever the status, including GitHub throttling surfacing as 429.
      // 3xx and 304 pass through for the browser, via redirect:'manual'.
      if (res.status >= 500 || (path === '/' && res.status >= 400)) throw new Error(res.status)
      const out = new Response(res.body, { status: res.status, headers: res.headers })
      if (path !== '/') return out
      // gitfolio stamps its own host into the title, canonical and og tags, which would hand this
      // domain's ranking to the generator's demo. Claim them for the personal site instead.
      const home = `https://${url.hostname}/`
      return new HTMLRewriter()
        .on('title', { element: e => e.setInnerContent(user) })
        .on('meta[name="description"]', { element: e => e.setAttribute('content', `Projects and open-source work by ${user}.`) })
        .on('link[rel="canonical"]', { element: e => e.setAttribute('href', home) })
        .on('meta[property="og:title"]', { element: e => e.setAttribute('content', user) })
        .on('meta[property="og:url"]', { element: e => e.setAttribute('content', home) })
        // gitfolio's footer credits itself at "/", which here is this page
        .on('#gen', { element: e => e.setAttribute('href', origin) })
        .transform(out)
    } catch {
      return fallback(req, env, path)
    }
  },
}

// Only '/' has a fallback. The dynamic routes just stop existing, which the static page expects.
function fallback(req, env, path) {
  // no-store: a proxied 404 is usually a screenshot that has not been captured yet, and a browser
  // that caches it stops asking, leaving an empty preview long after the image exists.
  if (path !== '/') return new Response(null, { status: 404, headers: { 'cache-control': 'no-store' } })
  return env.ASSETS.fetch(new Request(new URL('/', req.url), req))
}
