# Integration contract

## Core and service

```ts
import {Project, serve, policySchema, viewAt, registerAdapter} from '@heilmich/uml-viewer';
const project = await Project.open('/absolute/project');
const snapshot = await project.scan({language: 'php', policy: {prefix: 'App'}});
const overview = viewAt(snapshot);
// Optional: run a standalone local HTTP service.
const local = await serve(project, {port: 0});
// The caller owns local.server and decides when to close it.
```

`node/core/model.ts` exports TypeScript types and Zod schemas (`snapshotSchema`, `policySchema`, `proposalSchema`, `nodeSchema`, `edgeSchema`). `schemaVersion: 1` is required for snapshots/proposals. Validate imported JSON with those schemas. Graph IDs use namespace/module identity, never coordinates or array order; edge IDs encode source, target, type and trait label.

A snapshot includes explicit project ID and canonical root, analyzer version, timestamp, optional commit, content fingerprint (including paths and uncommitted source text), language, completion flag, file count, duration, nodes, typed edges, source provenance and diagnostics. Each scan receives a fresh snapshot ID even if source contents are unchanged; importing metrics also creates a new snapshot ID. The content fingerprint identifies the scanned source, while the snapshot ID identifies that particular result. View state is a separate `ViewState` object, not part of the actual graph. Facts retain `files`, per-file `errors` and `declarations`; extra source/unresolved information is additive.

Proposals have independent IDs, names, versions, layers, nested groups and omissions. Layers are inner-first. `updateProposal(id, expectedVersion, proposal)` creates at version 0 and increments on success. Conflict returns the current record; deletion also requires the expected version. Revisions persist in `proposal-versions.json`, including deletion tombstones, so deleting and recreating or reimporting a proposal cannot revive an old writer’s version. Imported stacked diagrams carry optional `scope: {nodeIds, edgeIds}` to preserve each diagram’s membership. Omitting `scope` during an update preserves it; explicit `scope: null` removes the restriction. A filesystem lock serializes writers across processes, and files are replaced atomically. If a writer crashes while holding the lock, a later command fails explicitly after ten seconds: remove `write.lock` only after verifying the writer is gone. Do not automatically steal a live lock.

A registered adapter accepts source strings and a policy, returning nodes, edges and diagnostics. It does not read arbitrary files or execute project code. The service owns file enumeration and canonical root confinement. `registerAdapter` rejects duplicate language IDs.

## Embedded viewer (no second server)

```tsx
import {Viewer, type ViewerEvent} from '@heilmich/uml-viewer/viewer';
import '@heilmich/uml-viewer/viewer.css';

<Viewer
  snapshot={snapshot}
  proposals={proposals}
  state={sessionViewState}
  onStateChange={saveSessionViewState}
  onEvent={(event: ViewerEvent) => handleInHost(event)}
/>
```

Mount in an element with available width/height. The standalone styles provide a full-height layout; a host can override `.viewer` height. Events cover `selection` (project + snapshot + IDs), `navigation`, `proposal`, `source` (element + optional member line), `rescan`, and explicit `share` (session + selection + proposal). They contain no agent-specific assumptions. Source rendering, scan scheduling, persistence and proposal action UI can be supplied by the host. `renderActions` accepts additional toolbar actions. Per-project/session state belongs to the embedding app. Updating the controlled `state` prop applies navigation path, proposal, selection and viewport without remounting. Nested proposal groups expose breadcrumbs and Back navigation to the immediate parent.

## HTTP service

`GET /api/bootstrap` discovers the registered project ID, snapshot ID and action token. Other routes require `?project=PROJECT_ID&snapshot=SNAPSHOT_ID`:

| Route | Method | Input / output |
| --- | --- | --- |
| `/api/graph` | GET | `{snapshot, stale}` |
| `/api/scan` | POST | New snapshot; current ID required |
| `/api/source&element=ID` | GET | `{file, line, code}` as JSON text; use `&element` after the required query |
| `/api/proposals` | GET | Proposal list |
| `/api/proposals` | PUT | `{id, expectedVersion, proposal}` |
| `/api/proposals` | DELETE | `{id, expectedVersion}` |
| `/api/context&session=SESSION_ID` | GET / PUT | Explicit session context; use `&session` after the required query |

Mutations require `X-Uml-Token` from bootstrap. Host and Origin are validated; the server does not enable cross-origin access. A stale snapshot or proposal returns HTTP 409 with `current`. Source reads use registered graph elements and canonical paths; symlink escapes fail. A same-origin host should call the exported service/core directly when it does not need standalone HTTP.

## MCP

`uml-viewer mcp --project /absolute/project` starts a stdio MCP server. Stdout contains MCP messages only. No browser or HTTP server is necessary.

Tools: `project_info`, `get_graph`, `scan`, `get_element`, `get_proposals`, `update_proposal`, `delete_proposal`, `get_context`, `set_context`. Discover project/snapshot IDs via `project_info`; an initial `scan` accepts the explicit project ID before a snapshot exists. All snapshot-specific tools require both IDs. A mismatched project is refused. Stale IDs/proposal versions return structured tool errors with current values.

Context is explicit: `set_context` requires project, snapshot and session IDs, selection, proposal and discussion. `get_context` does not infer a session from a viewer tab or client connection. A context referencing an older snapshot is marked stale. Disconnecting a client closes only its own MCP process/transport.

### Codex example

Add deliberately to your Codex MCP settings, replacing paths; this repository never writes them:

```toml
[mcp_servers.uml_viewer]
command = "node"
args = ["/absolute/uml-viewer/dist/node/cli.js", "mcp", "--project", "/absolute/project"]
```

### Claude Code example

Example project MCP configuration (merge into your chosen settings manually):

```json
{
  "mcpServers": {
    "uml_viewer": {
      "command": "node",
      "args": ["/absolute/uml-viewer/dist/node/cli.js", "mcp", "--project", "/absolute/project"]
    }
  }
}
```

Use distinct registered projects/server names for simultaneous projects, and distinct explicit session IDs for conversations. Install or reference `skills/uml-viewer/SKILL.md` separately if desired. A skill provides instructions; it does not create MCP tools. CLI scan/serve works without either agent.

The browser-safe entry point `@heilmich/uml-viewer/core` exports only the graph model, validation, policy/hierarchy, EDN reader and migration helpers. It has no Node filesystem, HTTP or MCP imports. Use the package root for Node service/adapter integration and `/viewer` for React rendering.
