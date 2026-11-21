# Astro on Netlify Platform Starter

[Live Demo](https://astro-platform-starter.netlify.app/)

A modern starter based on Astro.js, Tailwind, and [Netlify Core Primitives](https://docs.netlify.com/core/overview/#develop) (Edge Functions, Image CDN, Blobs).

> **Status.** This repository is being turned into the frontend of the AMBS application. What it contains today is the Netlify starter below, with its demo isolated under `src/demo/` and **off by default**. Passing template tests are not an acceptance of the AMBS platform. Integration notes: [`docs/ambs-integration/`](docs/ambs-integration/README.md).

## Template Demo

The starter's showcase (the Revalidation, Image CDN, Edge Function and Blobs pages, the `/api/*` routes and the `/edge` rewrite) lives in `src/demo/` and is controlled by one switch, the `DEMO_ENABLED` environment variable:

| `DEMO_ENABLED`          | Pages and API routes                                         | `/edge` rewrite edge function          |
| :---------------------- | :----------------------------------------------------------- | :------------------------------------- |
| unset, or anything else | Not built. Their URLs answer `404`.                          | Deployed, but passes every request on. |
| `true`                  | Built. The API routes also check the switch on each request. | Rewrites `/edge`.                      |

Turning the demo off means a new build and deploy with the switch off: static demo pages stay in a deploy that was built with it on, and the `/revalidation` page is cached on the CDN for a year, so changing the variable alone does not remove them. `npm run build` followed by `npm run check:demo-off` fails if a demo route made it into a build that should not have one. To work on the demo locally: `DEMO_ENABLED=true npm run dev`. Known defects of the demo are listed in [`src/demo/README.md`](src/demo/README.md); they are left unfixed on purpose and the demo code must not be reused for application data.

## Astro Commands

All commands are run from the root of the project, from a terminal:

| Command                      | Action                                                               |
| :--------------------------- | :------------------------------------------------------------------- |
| `npm install`                | Installs dependencies                                                |
| `npm run dev`                | Starts local dev server at `localhost:4321`                          |
| `npm run build`              | Build your production site to `./dist/`                              |
| `npm run preview`            | Preview your build locally, before deploying                         |
| `npm run check`              | Type-check the project with `astro check`                            |
| `npm test`                   | Run the unit tests with Vitest                                       |
| `npm run test:known-defects` | Run the reproductions of known demo defects (not part of `npm test`) |
| `npm run check:demo-off`     | After a build: fail if any demo route was built                      |
| `npm run check:demo-on`      | After a build: fail if a demo route is missing                       |
| `npm run format`             | Format all files with Prettier                                       |
| `npm run format:check`       | Check formatting without changing files                              |
| `npm run astro ...`          | Run CLI commands like `astro add`, `astro check`                     |
| `npm run astro -- --help`    | Get help using the Astro CLI                                         |

## Deploying to Netlify

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/netlify-templates/astro-platform-starter)

## Developing Locally

| Prerequisites                                                                |
| :--------------------------------------------------------------------------- |
| [Node.js](https://nodejs.org/) v22.23.4+.                                    |
| (optional) [nvm](https://github.com/nvm-sh/nvm) for Node version management. |

1. Clone this repository, then run `npm install` in its root directory.

2. Recommended: link your local repository to a Netlify project. This will ensure you're using the same runtime version for both local development and your deployed project.

```
netlify link
```

3. Run the Astro.js development server:

```
npm run dev
```

## Configuration

Environment variables, set in the Netlify UI. All are optional.

| Variable                 | Effect                                                                                                                                                                                                                     |
| :----------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DEMO_ENABLED`           | Set to `true` to build and serve the template demo (see above). Off by default. Read at build time for the pages and routes, and at request time by the API routes and the `/edge` edge function. Redeploy after changing. |
| `PUBLIC_DISABLE_UPLOADS` | Set to `true` to turn off shape uploads: the Upload button is disabled, the Blobs page shows a notice, and `POST /api/blobs` answers `403`. Redeploy after changing.                                                       |
| `REVALIDATE_SECRET`      | Lets a caller purge any cache tag through `POST /api/revalidate`. Without it, only the tags of the demo page can be purged.                                                                                                |
| `URL`                    | Provided by Netlify at build time; nothing to set. It is the site's address, used for canonical URLs, `robots.txt` and the sitemap. Local builds omit those.                                                               |

Purging a tag of your own with the secret:

```
curl -X POST https://<your-site>/api/revalidate \
  -H "Authorization: Bearer $REVALIDATE_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"tags": ["my-tag"]}'
```

For local development, `PUBLIC_DISABLE_UPLOADS` can go in a `.env` file. `REVALIDATE_SECRET` is read from the process environment, not from `.env`, so pass it on the command line: `REVALIDATE_SECRET=... npm run dev`.

## API Routes

These routes belong to the template demo: they exist only while `DEMO_ENABLED=true`, and answer `404` otherwise. They are public, so each one limits what it accepts. Responses are JSON.

| Route                  | Does                               | Refuses                                                                                                                                         |
| :--------------------- | :--------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/blobs`       | Lists the names of stored shapes   |                                                                                                                                                 |
| `POST /api/blobs`      | Stores a shape under its name      | `400` anything the shape editor could not have produced, `413` bodies over 2 KB, `507` new shapes once 100 are stored, `403` if uploads are off |
| `GET /api/blob?key=…`  | Returns one stored shape           | `400` without a key, `404` for an unknown one                                                                                                   |
| `POST /api/revalidate` | Purges cache tags from Netlify CDN | `400` unless the body is `{ "tags": [...] }` with 1–10 strings, `403` for tags other than the demo page's without `REVALIDATE_SECRET`           |

Only the known fields of a shape are stored, and the app has no way to delete one. To remove shapes, use the Netlify CLI (`netlify blobs:delete shapes <name>`).

All of `/api/*` is rate limited to about 60 requests per minute per IP address; requests over the limit get `429`. The limit is enforced by Netlify from the config in `netlify/edge-functions/rate-limit.js` and is approximate under bursts.

## Edge Functions

- `netlify/edge-functions/rewrite.js` (template demo, only active while `DEMO_ENABLED=true`) rewrites `/edge` to `/edge/australia/` or `/edge/not-australia/` based on the visitor's country. The address bar stays on `/edge`.
- `netlify/edge-functions/rate-limit.js` carries the rate limit above. Its handler is empty, so allowed requests continue to the Astro server function.

## Checks and Dependency Updates

Every pull request runs `.github/workflows/ci.yml`: format check, type check, unit tests, a default build that must contain no demo route, and a second build with `DEMO_ENABLED=true` that must contain all of them. Netlify adds a deploy preview.

`npm test` covers the demo switch in both states (API routes, route registration, the `/edge` edge function), the API routes (input validation, limits, purge authorization) against an in-memory store, and the demo utilities. Reproductions of the demo's known defects are kept apart in `tests/known-defects/` and run with `npm run test:known-defects`; they pass while a defect exists, so they are not acceptance tests and are not part of `npm test` or CI. It does not cover the pages, the React components, or anything that only exists on Netlify: edge functions, the rate limit, the real blob store and cache purging. Check those on a deploy preview.

Dependabot (`.github/dependabot.yml`) opens one pull request a week with all minor and patch updates, and a separate one for each major version. A green minor-and-patch pull request is normally safe to merge. For a major version of anything that talks to Netlify (`astro`, `@astrojs/netlify`, `@netlify/*`), try uploading a shape and purging a tag on its deploy preview first, since the tests replace those services with stand-ins.
