# CHARLIE MAPS — FRIDGE DEPLOYMENT RUNBOOK (for Codex)

> **READ THIS FIRST.** This is the new transit application under `transit/`. The repository root's `docker-compose.yml` deploys the **OLD** CharlieMaps PostGIS/photo application, not Charlie Maps transit. **NEVER run root Compose for this task.**

Goal: bring the new React/SVG + Node.js + dedicated Neo4j service online on Fridge, initially **LAN/tailnet-only** at `http://charlie.fridge.local`. Preserve the existing Fridge and WingMaps. UI is **DEMO** until GTFS importer + realtime collector are implemented; never claim live MBTA tracking.

## Known verified repo facts (as of 2026-11-15)

- GitHub: `LuckyMonkey/charliemaps`, branch `feat/transit-neo4j`.
- Transit lives in `transit/{web,api,graph}`.
- `transit/compose.yml` is **development only**: Vite hot reload on loopback 5177, Node tsx watcher on loopback 4100, dedicated Neo4j.
- Legacy root application uses **PostGIS/Postgres**; it must not be touched.
- Fridge patterns from `LuckyMonkey/fridge-homepage` and `LuckyMonkey/fridge-gis`:
  - apps installed under `/srv/apps/<app>`;
  - graph data under `/srv/data/<app>-graph/`;
  - Caddy: `/home/fridge/fridge-homepage/Caddyfile`, `fridge-caddy` container;
  - shared external Docker network **`fridge-homepage_default`**;
  - `gis-graph` is WingMaps' Neo4j. **DO NOT CONNECT CHARLIE MAPS TO IT.**
  - `(lan_only)` Caddy snippet checks **client IP**, not Host header. Import it first for any `.local` site. Use explicit `http://` so Caddy does not attempt public ACME for `.local`.
- The old `fridgeMbtaTracker` repo is reference material only. Do not deploy it for Charlie Maps.

## 0 — Read, inspect, and protect working state

1. Read root `AGENTS.md`, `transit/README.md`, `transit/docs/ARCHITECTURE.md`, `transit/docs/CODEX_HANDOFF.md`, and this file.
2. Inspect actual host paths, Docker service/network status, free RAM/disk, git status, active Caddy configuration, existing hostname/DNS, and any newer local changes. **Repo snapshots can be stale:** prefer the live host as source for running configuration.
3. Identify the checked-out repo and branch. If you must clone, use `/srv/apps/charlie-maps`, then switch to `feat/transit-neo4j`. If an existing directory has local changes, **do not reset, clean, or overwrite them**.
4. Before editing, say which exact files you'll change and how you'll roll back. Back up `/home/fridge/fridge-homepage/Caddyfile` before any ingress change.
5. **Stop if** Docker network `fridge-homepage_default` is missing or Fridge Caddy's actual path/network differs from this runbook; inspect and adapt before proceeding.

## 1 — Build a PRODUCTION stack, separate from dev

Do **not** expose the Vite dev server to the public internet and do **not** run `npm install` inside production containers at every startup.

Create in `transit/`, without overwriting the dev Compose file:
- `compose.fridge.yml` — dedicated prod stack (suggest Compose project `charlie-maps`);
- `api/Dockerfile` — multi-stage production image: install pinned dependencies, compile TypeScript, start Node on a built JS entrypoint (not `tsx watch`);
- `web/Dockerfile` — multi-stage Vite production build, static assets served via nginx;
- `web/nginx.conf` — SPA fallback `try_files $uri $uri/ /index.html`, same-origin `/api/` proxy to `charlie-maps-api:4100`, with buffering disabled for `/api/events` SSE;
- `.dockerignore` per build context; make sure local `.env` and secrets do not enter images.
- `package-lock.json` for each Node service, created and committed after dependency resolution. Use `npm ci` inside builds after lockfiles exist.

Prod service topology:

```text
http://charlie.fridge.local  [LAN/tailnet only]
            |
       fridge-caddy              (existing, NOT restarted)
            | external web network fridge-homepage_default
     charlie-maps-web:80        (nginx static React)
            | /api/*             /index.html + assets
     charlie-maps-api:4100      (Node, web + private graph networks)
            |
     charlie-maps-graph:7687    (Neo4j 5, private graph network ONLY)
            |
     /srv/data/charlie-maps-graph/{data,logs}
```

Rules:
- Keep Neo4j, DB browser 7474, and Bolt 7687 **unpublished** to host/LAN/public internet.
- Use container aliases exactly `charlie-maps-web`, `charlie-maps-api`, `charlie-maps-graph`, or adjust the runbook + proxy consistently. Check aliases using `docker network inspect`.
- Web container attaches to `fridge-homepage_default` and its application's web network; API attaches to web + private graph network; Neo4j attaches ONLY to private graph network. The web should not be able to connect directly to Bolt.
- Use private persisted Neo4j paths under `/srv/data/charlie-maps-graph/`, **not** `/srv/data/gis-graph/`, `/srv/data/food-graph/`, or `/srv/data/body-graph/`.
- Set strong unique Neo4j password in root-owned host `transit/.env` (mode 600; already gitignored). Never commit values; don't echo secrets into transcripts.
- Neo4j heap/page-cache should be bounded for Fridge; inspect available memory before setting limits. Avoid assuming a free gigabyte exists.
- Do not configure Caddy or DNS until the app builds and works inside its Docker network.
- Current API health endpoint checks Neo4j connectivity; `/api/network` may truthfully return `uninitialized`. That is expected before GTFS import.

## 2 — Prove services work *before* connecting Caddy

From the **transit directory**, and after setting the secret:

```sh
cd /srv/apps/charlie-maps/transit
docker compose --env-file .env -f compose.fridge.yml config --quiet
docker compose --env-file .env -f compose.fridge.yml build
docker compose --env-file .env -f compose.fridge.yml up -d
docker compose --env-file .env -f compose.fridge.yml ps
```

Then verify from the **existing Caddy container or another container attached to the Fridge web network**, using standard tools available there:

- `http://charlie-maps-web:80/` returns HTML referencing actual production-built assets.
- `http://charlie-maps-web:80/api/health` reaches Node via nginx and returns `status:"ready"` if Neo4j is available; otherwise diagnose.
- `http://charlie-maps-web:80/api/network` returns JSON with `mode:"uninitialized"` and empty lines before importer (NOT fictional live data).
- `http://charlie-maps-web:80/api/events` returns `text/event-stream` with a valid SSE event and heartbeat. Use an appropriately bounded streaming request.
- A browser can fetch the built JS/CSS assets; no 404s and no blank React screen.
- Build/typecheck success for BOTH API and web; examine logs and ensure no fatal errors.
- No services or routes other than Charlie Maps changed.

**If any of these fail, fix them before touching Caddy.** After two unsuccessful diagnosis/correction cycles, stop and report precise evidence.

## 3 — Connect to Fridge Caddy (only after checks pass)

Make a *small, reviewed* change to the actual Caddyfile; do not rewrite it. Add a separate local-only site block:

```caddy
# Charlie Maps transit — LAN/tailnet preview; independent of WingMaps /maps
http://charlie.fridge.local {
    import lan_only
    encode zstd gzip
    reverse_proxy charlie-maps-web:80
}
```

Do not modify the existing `go.fridge.run/maps` WingMaps routes, `fridge.run`, or public headers. Do not use `http://maps.fridge.local` if already reserved.

**Validate Caddy's actual config before reload** using the existing `fridge-caddy` container, e.g.:

```sh
docker exec fridge-caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
```

Reload **without restarting the whole Fridge stack** only after successful validation:

```sh
docker exec fridge-caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
```

Make sure `charlie.fridge.local` resolves to Fridge's Caddy host on the LAN/tailnet, if needed using the existing local DNS method; never assume public DNS is already present.

From an authorized LAN/tailnet client, check:
- `http://charlie.fridge.local/` loads and is usable on mobile and desktop;
- `http://charlie.fridge.local/api/health` returns correct JSON;
- unrelated `go.fridge.run/maps`, `go.fridge.run/food`, and Fridge homepage still work.
- an unauthorized internet-origin client is rejected by `lan_only`, not just by hostname.

Optional public `transit.fridge.run` and auth are a **separate follow-on change** requiring an explicit ingress/DNS/security review. Do not publish a public hostname, issue wildcard DNS changes, or bypass Fridge IAM as part of the initial deployment.

## 4 — Debugging decision table

| Symptom | Check |
|---|---|
| Started old CharlieMaps/Postgres | Wrong working directory or Compose file. Stop **only the accidentally started project you own**, never unrelated Fridge containers. |
| Caddy 502 | `fridge-caddy` and `charlie-maps-web` must share `fridge-homepage_default`; check web service is listening on port 80. |
| API 502/404 from UI | Nginx `/api/` reverse_proxy target must be `charlie-maps-api:4100` and preserve the `/api` prefix. |
| API health 503 | Neo4j down, auth mismatch, Bolt hostname/network mismatch, insufficient resources, or DB still starting. |
| React white/blank | Test compiled assets and browser console; don't use `vite dev` in production. |
| `/api/network` empty | GTFS importer has NOT been implemented yet; **not** proof that deploy failed. |
| Train icons look fake | They ARE deliberately labeled sample/demo data. Do not represent them as live. |
| External 403 on `.local` | This is expected for clients outside authorized LAN/tailnet; validate from an authorized source. |
| Caddy validate fails | Restore backed-up Caddyfile, do not reload broken config. |

## 5 — Report back without pretending

Return **exactly**:
1. Git branch + commit deployed, absolute project path, and list of changed files;
2. precise services running and their Docker networks;
3. API health, home page, graph status, SSE, mobile/desktop results;
4. whether Caddy is connected, and from where it was tested;
5. **DEMO vs REAL**: import not implemented, no live MBTA, ETA routing not implemented;
6. blockers and the next concrete action; rollback instructions.

**No unrelated upgrades, database resets, `docker compose down -v`, destructive pruning, force pushes, or Caddy wholesale rewrites.**
