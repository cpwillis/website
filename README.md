# website

Cloudflare Worker behind `cpwillis.dev`. It does three things:

- Mirrors one [gitfolio](https://github.com/cpwillis/gitfolio) profile page at `/`, rewriting title, description,
  canonical and og tags so the ranking belongs to this domain rather than the generator's.
- Serves `/terms` and `/privacy`, the shared policies the owner's other personal projects link to.
- Falls back to the static page in `public/` when gitfolio's feed is unhealthy.

The policies live here, not in each project, so one edit covers all of them and a gitfolio outage cannot take them
down. They come straight off the asset router and never touch the worker. Their canonical is `https://cpwillis.dev/...`,
so link to those URLs from other repos rather than copying the pages.

## Routing

`src/index.js` proxies exactly the paths gitfolio owns: `/`, `/api/repos`, `/shot/<name>.png`, and the three icon paths.
Everything else is served from `public/` and 404s properly. The list is duplicated in `assets.run_worker_first` in
`wrangler.jsonc`; keep the two in step. A prefix match is deliberately avoided: gitfolio's SPA fallback answers 200 for
any unknown `/api/*`, so a nonexistent URL would look like it exists.

The page shell also answers 200 when the feed behind it is broken, so the worker probes `/api/repos` directly and serves
the static page if that fails. The verdict is cached in `caches.default` for 60s healthy, 30s degraded.

## Local

```
npx wrangler@4 dev
```

No package.json, no install step. There is nothing to run locally for gitfolio: `GITFOLIO_ORIGIN` points at the deployed
`gitfolio.cpwillis.dev`, so `/` proxies the live site. Point that var elsewhere in `wrangler.jsonc` to test against a
local gitfolio.

No tests.

## Deploy

```
npx wrangler@4 deploy
```

The custom domain is declared in `wrangler.jsonc`, not only in the dashboard, so a redeploy from a clean checkout keeps
it. `public/sitemap.xml` is hand-maintained: add a page, add its URL.
