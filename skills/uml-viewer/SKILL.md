---
name: uml-viewer
description: Inspect a local project's architecture with the Node CLI and optional browser/MCP integration, without executing project code or controlling an agent.
---

Use the installed `uml-viewer` CLI, or `node /absolute/uml-viewer/dist/node/cli.js` from a built checkout. Use the existing isolated checkout; do not create a worktree unless explicitly requested.

1. Identify the explicit canonical project root. Check that Node.js 24 and the built CLI are available with `uml-viewer --help`. For a source checkout, run `npm ci && npm run build` in the viewer checkout, not in the analyzed project.
2. Analyze with `uml-viewer scan --project /absolute/project --lang php --out /tmp/graph.json`. A supplied `--policy policy.edn` or JSON file configures namespace prefix, levels, foreign collapse and exclusions. Exit 2 means partial output: inspect diagnostics and do not claim complete analysis. Never execute source code or run its tests to scan it.
3. For a browser, run `uml-viewer serve --project /absolute/project` and verify the printed canonical root/project ID. Use `--open` only in a desktop session. It binds loopback and chooses an available port. Do not assume a service on a familiar port belongs to this project, and do not terminate an unrelated process to obtain a port.
4. For data-only work, read the JSON snapshot directly, or use MCP when separately configured. Discover project/snapshot IDs via `project_info`; then use both IDs in graph/element/proposal tools. The CLI and MCP share the same core and state directory.
5. Keep actual code and proposals distinct. Update proposals with the expected version; on conflict, retrieve the current record and merge deliberately. Do not silently retry with a newer version to overwrite someone else's changes.
6. Receive selection/discussion only through explicit session context. Use a unique session ID; `get_context` returns only what was deliberately shared with it. A browser click does not imply permission to broadcast selection to all clients. Check context snapshot freshness.
7. Closing a tab or disconnecting MCP must not stop an agent or another client's service. Only stop a viewer process you started when the task needs it.

Installing this skill **does not register MCP tools**. See `docs/INTEGRATION.md` for separate Codex and Claude Code configuration examples. Do not automatically modify user configs. No LLM keys, PHP/Composer, Java/Clojure, Quil, tmux or companion agent are needed for Node scan/serve/MCP.
