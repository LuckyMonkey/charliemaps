# RTFM — mandatory Codex operating rules

1. **Read before writing.** Start with this repository's README, the relevant code, and the applicable HIG, architecture docs, runbooks, and nested AGENTS.md files. For transit, read `transit/README.md`, `transit/docs/ARCHITECTURE.md`, and `transit/docs/CODEX_HANDOFF.md`. **For deployment work, read `transit/docs/DEPLOY_FRIDGE.md` first.** Say which documents you read; identify missing ones instead of guessing.
2. **Inspect before replacing.** Check the existing implementation, dependencies, Git status, and configuration. Reuse working components. Do not invent new conventions when existing ones apply.
3. **Respect the scope.** Change only what the request requires. Preserve unrelated features and user changes. Do not alter production, deploy, delete data, or commit secrets unless the user explicitly authorizes the specific action; even when deployment is requested, follow `transit/docs/DEPLOY_FRIDGE.md` and validate before changing Caddy.
4. **Prove it works.** Run the relevant build, tests, and functional checks. For UI work, inspect the rendered interface if a browser is available; otherwise mark visual verification as NOT DONE.
5. **No fake completion.** Report actual tests and results. Do not say "done" when it has not been verified. Never claim that mocked or sample transit data is live.
6. **Stop digging.** After two failed attempts at the same problem, stop speculative edits and report the error, evidence, and next diagnostic step.

## Charlie Maps transit

- Work under `transit/` on `feat/transit-neo4j`; leave the existing neighborhood/photo map untouched unless explicitly instructed.
- Neo4j is the only transit database. No SQLite, PostgreSQL, PostGIS, or MongoDB for the transit system.
- Keep static schedules, dated runs, physical vehicles, and realtime observations separate.
- For a Fridge deployment request, use `transit/docs/DEPLOY_FRIDGE.md`: build production images, check the Charlie Maps stack first, then add only the LAN-only Caddy route after validation. Never touch WingMaps' GIS or Neo4j. No public exposure without explicit approval.

**RTFM is a prerequisite, not a suggestion.**
