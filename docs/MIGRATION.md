# Migration inventory and behavior map

Reference branch: `claude/beautiful-hawking-urpv5z`. Read-only remote inspection confirmed its tip is still `d8a2c93b5f3e07616b4abd434b8c02768b760516`; no later changes were discarded. Work is on `migration/typescript-node`. The original source and tests remain available. No historical graph geometry is used to derive IDs.

| Historical feature | Node/browser implementation | Verification / scope |
| --- | --- | --- |
| `php/scan.php`, `collector.php`, nikic parser | `node/languages/php.ts`, php-parser **3.7.0** | `php-shop` normalized nodes, relationships, violations, member text equal the committed EDN fixture; complex legacy test case ported to Node |
| PHP declarations, aliases/group use, namespace, types | PHP AST adapter | Multiple declarations, case-insensitive lookup, interface inheritance, traits, enums, nullable/union/intersection/DNF, final/abstract/readonly, promotion, parameters, attributes, typed constants, anonymous classes |
| PHP dependency provenance and errors | Snapshot diagnostics + edge sources + unresolved facts | new, static, class constants, type hints, attributes, instanceof, catch, anonymous body dependencies; syntax errors give partial exit 2 |
| LanguageGraph registry | `LanguageAdapter`, `registerAdapter`, `adapters` | Core format independent of the selected language; unknown adapters fail explicitly |
| TypeScript / JavaScript scanner | `node/languages/typescript.ts`, TypeScript compiler AST | Module nodes, import/re-export/require/dynamic import, interface factories/implements, exported members and invoke names; not a TypeScript type checker or bundler resolver |
| Python scanner | `pythonAdapter`, Lezer AST | Module nodes, absolute/relative imports, imported bases, Protocol/ABC modules, simple annotated factories; no Python execution |
| Rust scanner | `rustAdapter`, Lezer AST | Reachable lib/main/mod trees, use paths, traits, impl relations, public functions and Tauri commands; does not expand macros or run Cargo |
| Clojure scanner | `clojureAdapter`, Lezer AST | clj/cljs/cljc ns require/use, prefix libspecs, Java imports, protocols, record/type implements and requiring-resolve; never evaluates forms |
| Policy and hierarchy | `node/core/graph.ts` | Namespace drill-down, longest-prefix inner/outer ranks, omissions, foreign collapse, relationship overrides and bundled provenance |
| Named proposals and nested groups | Versioned `.uml-viewer/proposals.json`, graph views + editor | Actual graph is immutable during proposal editing; nested groups, unassigned elements and per-proposal rank views |
| EDN policies/IR/examples | Safe `readEdn`, `convert`, `import` | Existing example documents import in Node; preserves all converted data; invented package groupings become explicitly labelled imported proposals |
| CRAP, coverage and mutation snapshots | `metrics`, `attachMetrics`, IR import | Existing `.metrics/crap.edn`, mutation outcome maps and IR metric fields; no fabricated measurements or automatic test execution |
| Desktop canvas/cards/source window | React Flow viewer | Component → class → members; pan/zoom, selection, highlighting, aggregate arrow inspector, source locations and escaped text |
| Local launch scripts / companion interaction | Node CLI, optional `--open`, stdio MCP | No companion or agent runtime required; no terminal control or agent process ownership |
| Selection mailbox | Explicit per-session context API | Projects and sessions are identified explicitly; clicks alone do not broadcast context |
| Integration portability | Exported TypeScript core/service/viewer + callbacks | Embeddable without another server; Codex/Claude examples configure MCP separately |

All five historical scanner families have Node implementations. This table describes their supported static surface; it is **not a claim that every original Clojure test was executed or that they implement a full compiler**. Historical tests that require the JVM/PHP/desktop stack were used as specifications, not installed as new runtime dependencies.

## Deliberate differences and static-analysis limits

- Layout is Dagre/React Flow, not Quil's geometry. Namespace grouping describes actual source; invented groups exist only in proposals. Legacy custom coordinates are preserved by conversion but do not drive the browser layout.
- Proposal changes are edited through validated JSON, not direct dragging of classes into packages. All proposal lifecycle actions are available in the browser and MCP.
- Dynamic PHP class targets remain unresolved warnings. Class names are matched without case. `self`, `static`, `parent` and builtins do not create external nodes. Duplicate declarations keep the first file in sorted order, matching the reference.
- PHP parsing uses the 8.4 grammar with an 8.3 grammar fallback for php-parser 3.7's promoted-DNF lookahead defect. Tests cover DNF promotion and asymmetric promoted visibility. Later PHP syntax not understood by the parser is reported as an error, never silently interpreted.
- Module adapters intentionally retain module granularity. They do not expand Clojure/Rust macros, resolve arbitrary Python runtime imports, or use arbitrary TypeScript path mappings. TypeScript runtime invoke names and Rust command names are available as node data for host integrations.
- No new coverage, CRAP or mutation measurements are produced. Existing data can be imported without the originating language tools. Missing metrics stay missing.
- Source scanning skips symlinks and standard dependency/test/cache/build directories. `excludes` adds relative path-prefix exclusions in policy. It does not use shell glob expansion.
- Git is optional metadata: without Git on PATH, commit is null while content fingerprints still identify dirty source changes.
- The local service binds loopback with same-origin/Host checks and an action token. It is not an authenticated multi-user web host. Processes are owned by the command that launched them; tab/client disconnects never terminate other services.

`--lang polyglot` analyzes all supported source extensions with language-qualified project IDs and connects literal TypeScript invoke names to unambiguous Rust command owners. Ambiguous/missing command targets are warnings rather than invented edges.
