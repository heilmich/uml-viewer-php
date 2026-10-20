# Validation report

Initial validation on 2026-10-19; independent review fixes and full suites revalidated on 2026-10-20 in the managed Linux cloud environment, using Node.js 24.19.0, npm 11.9.0 and Chromium 154.0.8037.57. Source reference: `d8a2c93b5f3e07616b4abd434b8c02768b760516` from the PHP branch. No npm publication or merge is part of this work.

| Check | Observed result |
| --- | --- |
| Frozen install | `npm ci` succeeded; package-lock v3 retained |
| Build / type validation | `npm run build` succeeded (TypeScript declarations, standalone browser assets, reusable viewer bundle) |
| Node test suite | **34 passed, 0 failed, 0 skipped** |
| Chromium functional test | **3 passed**: controlled embedding state and nested proposal navigation, plus namespace/class drill-down, aggregate violation inspector, source escaping, explicit session context isolation, proposal create/edit/delete, reload persistence and rescan |
| Legacy PHP semantic fixture | 25 source files, 25 declarations + 6 collapsed external nodes, 59 typed relations; node IDs, relationship semantics, violations and member text match committed `php-shop.legacy.edn` |
| Architecture rule | Exactly one intentional Domain → Infrastructure violating dependency, `Domain.Model.Order` → `Infrastructure.Clock.SystemClock` |
| PHP syntax / resolution | Aliases, grouped use, multiple namespaces/declarations, case-insensitive targets and stable identity, promoted readonly properties, enums/traits, DNF/intersection/union/nullable types, typed constants, attributes, anonymous classes, dynamic-target warnings, syntax errors and partial exit 2 |
| Other scanner families | Representative historical TypeScript/JavaScript, Python, Rust and Clojure scenarios ported and passed; mixed TypeScript invoke → Rust command edge passed |
| Imported data | Existing example EDN documents, CRAP/function metrics, mutation outcomes, legacy proposals/package groups; metrics survive rescans without filling unknown values with zero |
| Persistence / concurrency | Reopened project state, two clients sharing a proposal with one stale writer refused, isolated projects and sessions, conflicts return current versions |
| MCP transport | Actual stdio handshake with two independent Node subprocesses; closing one client leaves the other usable |
| File safety | Traversal and symlink escapes refused; source HTML remains visible text; analyzed code execution marker is never written |
| Packaging | `npm pack`, production-only tarball install and installed CLI scan; tarball contains CLI, public types, core entry and browser/viewer assets |
| Legacy-free workflow | Frozen installation, build and Node tests executed with PATH containing only Node, npm and the ordinary OS shell. Browser scenario also passed with that PATH plus a directly selected system Chromium binary. PHP, Composer, Java/Clojure and tmux were unavailable to these commands |

The installed CLI also scanned `php-shop` with a PATH containing **only Node**, producing a complete graph and the expected violation. Git commit metadata became null as intended; source fingerprints remained present. Stdio MCP was likewise tested with only Node on PATH. Browser/OS shared libraries and the shell used by npm scripts are normal platform prerequisites, not legacy-language runtimes.

## Real-project measurement

Baseline measured on 2026-10-19; timings were not rerun after the review fixes.

Repository: [symfony/console](https://github.com/symfony/console), branch `7.3`, commit `a28c3e5b4df406e8fae8e9b18c40557b5dfc430c`. No dependencies or analyzed-project tests were installed or run. Its test/build/dependency directories were excluded by the scanner.

- 126 PHP files, 126 project declarations, 70 external nodes, 622 typed relations; complete analysis, no syntax-error diagnostics.
- Observed analysis: **327.39 ms**.
- Observed cold browser navigation to first diagram paint: **656 ms** at 1440×1000, rendering 26 grouped project nodes and 79 bundled arrows with external nodes initially hidden.
- Pan/zoom, external visibility and detail/arrow switches are available. The layout keeps a readable minimum initial scale; larger graphs can extend outside the viewport and require pan/minimap navigation.

[benchmark.json](benchmark.json) contains the measured run. The browser timing includes HTTP, JavaScript bootstrap, layout and first paint; it is **not an isolated React/GPU render measurement or a throughput guarantee**. This is one real project/run, not a claim about arbitrarily large repositories. Reproduce after building with:

```sh
git clone --depth 1 --branch 7.3 https://github.com/symfony/console.git /tmp/console
printf '{"prefix":"Symfony.Component.Console"}\n' > /tmp/console-policy.json
node scripts/benchmark.mjs /tmp/console /tmp/console-policy.json /tmp/benchmark.json
```

## Known limits and remaining decisions

The original JVM/PHP/desktop suite was retained as a reference, not executed in the Node-only workflow. The Node tests explicitly port representative behavior; they do not prove equivalence for every possible language construct. Static analysis does not expand macros or evaluate runtime import/class targets. The PHP parser's promoted-DNF grammar fallback is documented in `MIGRATION.md`. Historical custom diagram coordinates are not reproduced; proposal editing is validated JSON.

The production browser build reports a chunk-size advisory (roughly 521 kB JavaScript before gzip, 163 kB gzip). This does not fail the build. The environment's Chromium reports the harmless FORCE_COLOR/NO_COLOR warning during Playwright execution.

No target host application was supplied; the embedding API and agent-neutral events are implemented and documented, but integration into a separate application is outside this task. Licensing remains `UNLICENSED` pending the repository owner's decision. No agent settings were overwritten and no unrelated processes were terminated. An independent GPT-6.1 Sol reviewer was run at high reasoning effort at the user’s request; all 13 confirmed findings were fixed and rechecked. See [REVIEW.md](REVIEW.md) for the findings and regression coverage.
