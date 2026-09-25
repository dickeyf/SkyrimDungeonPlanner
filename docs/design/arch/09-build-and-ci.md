# 9. Build and CI

## Builds (`vite.config.ts`)

- `npm run build` → `dist/`: regular files (an `index.html`, one script, one stylesheet), served
  by any static web server.
- `npm run build:single` → `dist-single/index.html`: **one self-contained file** (about 760 kB,
  210 kB compressed) with every script, style and the favicon inlined
  (`vite-plugin-singlefile`). It is opened directly from disk in Chrome or Edge: the File System
  Access API, IndexedDB and localStorage all work on a `file://` page.
- The proof-of-concept pages (`poc/*.html`) are served by the dev server only.

## Docker image (`Dockerfile`, `docker/nginx.conf`)

A two-stage build: `node:22-alpine` runs `npm ci` and `npm run build`; the result is copied into
`nginxinc/nginx-unprivileged:alpine`, which runs nginx as a non-root user on port **8080**. The
app is served at `/`, with gzip, long-lived caching of the hashed assets and a Content Security
Policy allowing only the app's own origin (it needs no network access).

## GitHub Actions (`.github/workflows/`)

| Workflow | Runs on | Does |
| --- | --- | --- |
| `ci.yml` | push, pull request, `v*` tags | format check, lint, type check, unit tests, build |
| `codeql.yml` | push, pull request, weekly | CodeQL static analysis, `security-and-quality` queries |
| `security.yml` | push, pull request, weekly | `npm audit` (high and above), Trivy scan of dependencies, secrets and misconfigurations (fails on high or critical) |
| `single-file.yml` | push to main, `v*` tags | builds `SkyrimDungeonPlanner.html` as an artifact; on a tag, attaches it to the release |
| `docker.yml` | push, pull request, `v*` tags | builds the image, smoke-tests it on 8080, scans it with Trivy, pushes it to `ghcr.io/dickeyf/skyrimdungeonplanner` (not for pull requests) |

Dependabot (`.github/dependabot.yml`) proposes weekly updates of the npm packages, the actions
and the Docker base images. Third-party actions are pinned to a commit.
