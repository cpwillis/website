# website

Cloudflare Worker behind `cpwillis.dev`, static assets only. It does two things:

- Redirects `/` to the [GitHub profile](https://github.com/cpwillis).
- Serves `/terms` and `/privacy`, the shared policies the owner's other personal projects link to.

The policies live here, not in each project, so one edit covers all of them. Their canonical is
`https://cpwillis.dev/...`, so link to those URLs from other repos rather than copying the pages.

## Routing

`public/_redirects` sends `/` to the GitHub profile (302, so home can point elsewhere later without stale browser
caches) and `/favicon.ico` and `/apple-touch-icon.png` to the GitHub avatar. `public/favicon.svg` is a local copy of the
avatar. Everything else is served from `public/` and 404s properly.

## Local

```
npx wrangler@4 dev
```

No package.json, no install step, no tests.

## Deploy

```
npx wrangler@4 deploy
```

The custom domain is declared in `wrangler.jsonc`, not only in the dashboard, so a redeploy from a clean checkout keeps
it. `public/sitemap.xml` is hand-maintained: add a page, add its URL.
