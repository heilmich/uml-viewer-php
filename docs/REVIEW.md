# Independent review — 2026-10-20

At the user's request, an independent GPT-6.1 Sol agent at high reasoning effort reviewed the migration. It reported 13 confirmed defects. All were corrected, covered by regression tests and independently rechecked. Its final review reported no remaining confirmed defects in these fixes.

| Finding | Resolution |
| --- | --- |
| Metrics matched unrelated nodes whose namespaces were absent | Require a defined, nonempty namespace; prefer exact node ID matches |
| A scan could reuse an earlier snapshot ID after metrics import | Every scan and metrics import creates a fresh UUID |
| A declaration sharing a namespace prefix hid descendants | Preserve drill-down when a prefix contains both a declaration and children |
| PHP shared property declarations lost later properties' type/nullability | Apply the statement's type and nullable flag to every declarator |
| Embedded viewer ignored subsequent controlled state changes | Synchronize path, proposal, selection and viewport; preserve the explicit viewport on proposal changes |
| Python imports inside nested statements were ignored | Collect imports throughout the syntax tree |
| Python continued `from` imports invented a foreign `from` module | Normalize escaped newlines and distinguish the two import forms |
| Stacked legacy diagrams imported as an empty graph | Merge graph entities and retain per-diagram node/edge scopes in imported proposals |
| Legacy member strings and text-only members were rejected or lost display details | Normalize member representations, retaining types, arguments and return text |
| Nested proposal groups were flattened | Traverse direct children recursively and retain immediate-parent navigation and boundary relations |
| Aggregate relations ignored policy overrides and omissions | Apply component-level relationship policy after aggregation |
| Proposal layers did not supply fallback policy ranks | Derive ranks from normalized legacy proposal layers when explicit levels are absent |
| Delete/recreate reset proposal versions, permitting stale writes | Persist revision tombstones across deletion, recreation and reimport |

The follow-up review also caught two residual cases: switching only the proposal must retain an explicitly supplied viewport, and MCP proposal updates must retain imported scopes. Both were fixed. Actual MCP calls verify full proposal updates, older callers omitting scope, and explicit `scope: null` removal.

Validation after the fixes: `npm run build`, **34 Node tests**, and **3 Chromium tests** passed. The regression additions are `tests/review.test.ts` (12 tests) and `tests/browser/embedding.spec.ts` (2 tests). Browser coverage imports the exported viewer bundle and checks controlled session switching and nested breadcrumbs. The existing standalone workflow test also passes.

This review verifies the reported defects and regression scenarios; it does not establish equivalence for every historical language construct. The broader supported surface and static-analysis limits remain documented in [MIGRATION.md](MIGRATION.md) and [VALIDATION.md](VALIDATION.md).
