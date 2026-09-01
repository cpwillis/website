// cpwillis.dev mirrors this profile from gitfolio, and falls back to the static page in public/
// if gitfolio is slow or down. /terms and /privacy are always served locally: they are referenced
// by other projects and must not depend on gitfolio being up.

const TIMEOUT_MS = 3000
const HEALTH_OK_TTL = 60    // how long a healthy verdict is trusted
const HEALTH_BAD_TTL = 30   // shorter when degraded, so recovery shows up quickly

// Exactly the paths gitfolio owns. A prefix match would forward /api/anything upstream, where the
// single-page-application fallback answers 200 with the profile page, so a URL that does not exist
// would look like it does. Everything else is served from public/, which 404s properly.
// The icons are gitfolio's too: it redirects the two legacy paths to the sized GitHub avatar, so
// they follow the profile picture instead of going stale as a committed copy would.
const ICONS = new Set(['/favicon.svg', '/favicon.ico', '/apple-touch-icon.png'])
const PROXIED = p =>
  p === '/' || p === '/api/repos' || ICONS.has(p) || /^\/shot\/[^/]+\.png$/.test(p)

// The page shell answers 200 even when the feed behind it is broken, so proxying the shell alone
// would serve a portfolio with an error message where the projects should be. Ask the feed directly,
// and cache the verdict so this costs one upstream call a minute rather than one per visitor.
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

    // '/' maps to that user's portfolio; the dynamic routes carry the user explicitly so this
    // never depends on whatever gitfolio's own default account happens to be.
    const upstream = new URL(path === '/' ? `/${user}` : path, origin)
    for (const [k, v] of url.searchParams) upstream.searchParams.set(k, v)
    if (path !== '/') upstream.searchParams.set('user', user)

    try {
      // Run the probe alongside the fetch. It is normally a cache hit, but when it is not, asking
      // first and fetching second doubles the worst-case wait for no extra information.
      // For the page itself, a broken feed means the static page is the better answer.
      const [res, healthy] = await Promise.all([
        fetch(upstream, {
          method: req.method,
          headers: {
            accept: req.headers.get('accept') || '*/*',
            'user-agent': req.headers.get('user-agent') || '',
            // so gitfolio recognises a repo pointing back at this site and does not show it
            'x-forwarded-host': url.hostname,
          },
          redirect: 'manual',
          signal: AbortSignal.timeout(TIMEOUT_MS),
        }),
        path === '/' ? feedHealthy(origin, user) : true,
      ])
      if (!healthy) return fallback(req, env, path)
      // Any failure upstream, including GitHub rate limiting surfacing as 429/503, means the
      // mirrored profile is not usable. Fall back rather than pass the error on. Redirects and 304
      // are passed through: redirect:'manual' hands them back for the browser to act on.
      if (res.status >= 400) throw new Error(res.status)
      const out = new Response(res.body, { status: res.status, headers: res.headers })
      if (path !== '/') return out
      // gitfolio writes its own host into the title, canonical and og tags, which on this domain
      // would hand the ranking to the generator's demo. This is the personal site, so it says so.
      const home = `https://${url.hostname}/`
      return new HTMLRewriter()
        .on('title', { element: e => e.setInnerContent(user) })
        .on('meta[name="description"]', { element: e => e.setAttribute('content', `Projects and open-source work by ${user}.`) })
        .on('link[rel="canonical"]', { element: e => e.setAttribute('href', home) })
        .on('meta[property="og:title"]', { element: e => e.setAttribute('content', user) })
        .on('meta[property="og:url"]', { element: e => e.setAttribute('content', home) })
        // gitfolio's footer credits itself at "/", which on this domain is this very page
        .on('#gen', { element: e => e.setAttribute('href', origin) })
        .transform(out)
    } catch {
      return fallback(req, env, path)
    }
  },
}

// Only the page itself has something to fall back to; the dynamic routes just stop existing,
// which is exactly what the static page expects since it never calls them.
function fallback(req, env, path) {
  if (path !== '/') return new Response(null, { status: 404 })
  return env.ASSETS.fetch(new Request(new URL('/', req.url), req))
}
