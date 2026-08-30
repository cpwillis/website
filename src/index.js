// cpwillis.dev mirrors this profile from gitfolio, and falls back to the static page in public/
// if gitfolio is slow or down. /terms and /privacy are always served locally: they are referenced
// by other projects and must not depend on gitfolio being up.

const TIMEOUT_MS = 3000

// Paths gitfolio owns. Everything else is served from public/.
const PROXIED = p => p === '/' || p.startsWith('/api/') || p.startsWith('/shot/') || p === '/favicon.svg'

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
      const res = await fetch(upstream, {
        method: req.method,
        headers: {
          accept: req.headers.get('accept') || '*/*',
          'user-agent': req.headers.get('user-agent') || '',
          // so gitfolio recognises a repo pointing back at this site and does not show it
          'x-forwarded-host': url.hostname,
        },
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (res.status >= 500 || res.status === 0) throw new Error(res.status)
      return new Response(res.body, { status: res.status, headers: res.headers })
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
