import { phpAdapter } from './php.js';
import { typescriptAdapter } from './typescript.js';
import { pythonAdapter, rustAdapter, clojureAdapter } from './modules.js';
import {
  edgeId,
  type LanguageAdapter,
  type AnalysisResult,
  type GraphEdge,
} from '../core/model.js';
const languages = [
  phpAdapter,
  typescriptAdapter,
  pythonAdapter,
  rustAdapter,
  clojureAdapter,
];
/** Language-qualified module identities prevent collisions in mixed repositories. */
export const polyglotAdapter: LanguageAdapter = {
  id: 'polyglot',
  extensions: [...new Set(languages.flatMap((a) => a.extensions))],
  analyze(files, policy) {
    const out: AnalysisResult = { nodes: [], edges: [], diagnostics: [] };
    for (const adapter of languages) {
      const selected = files.filter((f) =>
        adapter.extensions.some((ext) => f.file.endsWith(ext)),
      );
      if (!selected.length) continue;
      const graph = adapter.analyze(selected, policy);
      const ids = new Map(
        graph.nodes.map((n) => [
          n.id,
          n.foreign ? n.id : `${adapter.id}.${n.id}`,
        ]),
      );
      out.nodes.push(...graph.nodes.map((n) => ({ ...n, id: ids.get(n.id)! })));
      out.edges.push(
        ...graph.edges.map((e) => {
          const from = ids.get(e.from)!,
            to = ids.get(e.to)!;
          return { ...e, from, to, id: edgeId(from, to, e.kind, e.label) };
        }),
      );
      out.diagnostics.push(...graph.diagnostics);
    }
    // Only literal invoke names with one unambiguous command owner get an exact edge.
    const commands = new Map<string, string[]>();
    for (const n of out.nodes)
      for (const c of (n.commands as string[] | undefined) ?? [])
        commands.set(c, [...(commands.get(c) ?? []), n.id]);
    for (const n of out.nodes)
      for (const invoke of (n.invokes as string[] | undefined) ?? []) {
        const targets = commands.get(invoke) ?? [];
        if (targets.length === 1) {
          const kind: GraphEdge['kind'] = 'dependency';
          out.edges.push({
            id: edgeId(n.id, targets[0], kind, invoke),
            from: n.id,
            to: targets[0],
            kind,
            label: invoke,
            sources: [{ file: n.file ?? '', line: n.line ?? 1, via: 'invoke' }],
          });
        } else
          out.diagnostics.push({
            file: n.file ?? '',
            line: n.line,
            message: `Unresolved invoke ${invoke}: ${targets.length ? 'ambiguous command owners' : 'no command declaration'}`,
            severity: 'warning',
          });
      }
    out.nodes = [...new Map(out.nodes.map((n) => [n.id, n])).values()];
    return out;
  },
};
