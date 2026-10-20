# Developer instructions

These shared rules apply to Codex, Claude Code and human contributors.

- Node.js 24 LTS + npm is the primary build/runtime path. `npm ci`, `npm run build`, `npm test`, `npm run test:browser` and `npm pack` validate it. Use the existing checkout in isolated cloud tasks; do not create a Git worktree unless explicitly requested.
- Keep core independent of Node I/O, HTTP, browser and agents. Language adapters operate on source strings. Project filesystem access, persistence and processes belong to service/CLI; viewer emits generic events.
- Do not execute analyzed code, autoload PHP, run Composer/Cargo/Python/Clojure or analyzed-project tests. Do not start, control or stop users' agents or unrelated processes.
- Keep original `src`, `spec`, `php` and committed EDN reference fixtures as migration references. A fix to Node behavior must be verified against normalized semantic fixtures, not coordinate snapshots.
- Never merge proposals into the actual graph. Preserve explicit project, snapshot and session scope; use optimistic versions and filesystem locking for shared proposal writes.
- Canonicalize source paths and enforce the registered project root, including symlinks. Render source as text. Keep loopback, Host/Origin checks, action tokens and input validation intact.
- Import metric absence as absence. Never substitute passing trivial checks, disabled assertions, synthetic performance numbers or unknown data with zero.
- Do not overwrite agent/user configs, publish to npm or push to an unauthorized destination. Skill and MCP examples are opt-in instructions.
- Browser tests use a system Chromium (`CHROMIUM_PATH` may override). Avoid introducing browser or legacy-language tools as mandatory runtime dependencies.
- Record actual checks and known limits in `docs/VALIDATION.md` and update `docs/MIGRATION.md` when supported behavior changes.
