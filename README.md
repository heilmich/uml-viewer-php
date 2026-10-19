# UML Viewer — Node.js + browser

A standalone local architecture viewer with static PHP analysis, a reusable TypeScript core, a React viewer, CLI and stdio MCP integration. Analyzed code is never executed. PHP, Composer, Java/Clojure, Quil, tmux, agents and LLM APIs are **not runtime requirements**.

Requires **Node.js 24 LTS** and npm. The historical implementation and its tests remain in `src/`, `spec/` and `php/` as a behavioral reference; [the previous README](docs/LEGACY.md) describes that implementation only.

```sh
npm ci
npm run build
npm test
node dist/node/cli.js serve --project ./examples/php-shop --policy ./examples/php-shop.policy.edn --open
```

The server binds loopback and selects an available port by default. Its first stdout line reports the URL, canonical project root and project ID. Omit `--open` for headless use. A fixed port can be selected with `--port 4317`; an occupied port fails rather than attaching to another process/project. No command starts, controls or terminates Codex or Claude Code.

To install a locally packed version:

```sh
npm pack
npm install /absolute/path/heilmich-uml-viewer-0.1.0.tgz
npx uml-viewer serve --project /absolute/path/to/project
```

The tarball includes compiled CLI, TypeScript declarations and browser assets. Only package contributors need the build/test toolchain. This task does not publish to npm. Package licensing is currently `UNLICENSED`; historical code retains its existing notices.

## Commands

```sh
uml-viewer scan --project /absolute/path --lang php --policy policy.edn --out graph.json
uml-viewer scan --project /absolute/path --facts --out php-facts.json
uml-viewer convert --input old-policy.edn --out policy.json
uml-viewer import --project /absolute/path --input old-ir.edn
uml-viewer metrics --project /absolute/path --input .metrics/crap.edn
uml-viewer metrics --project /absolute/path --input .metrics/mutate/some-namespace.edn
uml-viewer serve --project /absolute/path --open
uml-viewer mcp --project /absolute/path
```

`scan` prints JSON (or writes `--out`): exit **0** means complete analysis, **2** means partial analysis with diagnostics and usable output, **1** means an invalid command or operational failure. Dynamic targets produce warnings, never guessed external classes. `--facts` exposes the historical `files → errors/declarations` contract. `--lang` supports `php`, `typescript`, `javascript`, `python`, `rust`, `clojure`, `polyglot`; see [migration coverage](docs/MIGRATION.md) for granularity and checks.

Policies accept JSON or non-evaluating EDN. `convert` wraps preserved EDN data as `{schemaVersion:1, format:"legacy-edn", data:…}`; Node commands accept this envelope directly. Vector map keys such as `[:A :B]` become `"A|B"`. Reader evaluation and tagged readers are rejected. No JVM is invoked.

State is stored in the registered project's `.uml-viewer/`: configuration, snapshot, historical PHP facts, versioned proposals, and explicit per-session context. The scanner ignores that directory. Scans only read source files and write viewer state; they do not install dependencies in or run tests of the analyzed project. Symlink directories/files are excluded from analysis, and canonical source paths must remain inside the registered root.

## Viewer

The overview groups code by namespace. Select a component and use **Explore component**, or double click it, to drill down; breadcrumbs and Back navigate upward. Classes show fields/cases, methods, declaration locations and imported metrics. Click the file or a member to inspect plain-text source at its line. Pan, zoom, minimap, incoming/outgoing highlights, bundled-arrow inspection and details/arrows/externals switches help navigate larger graphs. Red arrows indicate dependency-rule violations. External nodes are hidden initially to reduce clutter; enable Externals to inspect them. Relationship labels are clickable buttons that open the bundle inspector.

**Actual code** and **PROPOSAL** modes are explicitly separate. New / Edit / Delete proposal actions persist proposals independently. The proposal editor accepts validated JSON: name, inner-first layers, namespace entries, nested groups and omissions. Editing a proposal never rewrites the actual graph or source code. Optimistic versions prevent concurrent clients from overwriting another client's changes. A conflict keeps your draft visible; reopen the current proposal and merge deliberately.

Navigation and viewport are saved in the browser's per-tab session storage and retained through compatible rescans. Selection stays local until **Send to session** is used with an explicit session ID. The server and MCP clients never receive every click implicitly. Diagnostics, incomplete scans, loading, empty projects and stale snapshots are visible. Imported metrics remain absent when unavailable; missing coverage is not zero coverage.

## Embedding and agent integration

[Integration contract and examples](docs/INTEGRATION.md) cover core/service/viewer exports, HTTP, events, MCP, Codex and Claude Code. The viewer can be mounted in an existing React application using `@heilmich/uml-viewer/viewer` and its CSS, with data and callbacks supplied by the host; it requires no second HTTP server.

The repository's [skill](skills/uml-viewer/SKILL.md) is an instruction entry point to the CLI. Installing it does not register MCP tools. Agent MCP settings must be configured separately; examples are documentation, never automatic changes to user settings.

## Development and verification

```sh
npm ci
npm run build
npm test
npm run test:browser
npm pack
```

Browser tests use a system Chromium at `/usr/bin/chromium`, or `CHROMIUM_PATH`. On other machines install Chromium with your package manager or Playwright, then set that variable to its executable. This is a development/test dependency, not a CLI/MCP runtime requirement.

`npm test` includes semantic parity with the committed `php-shop` graph, PHP syntax/name-resolution cases, policy, EDN/metrics/proposals, persistence, file confinement, HTTP protections, two projects, concurrent MCP clients and actual stdio subprocesses with a Node-only PATH. Browser tests exercise navigation, source escaping, proposal CRUD/persistence and rescanning. See [validation and measured performance](docs/VALIDATION.md); [developer rules](docs/DEVELOPMENT.md) apply to both agents.
