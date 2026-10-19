import {
  proposalSchema,
  type GraphNode,
  type Proposal,
  type Group,
} from './model.js';
/** Normalize historical proposals without inventing implemented architecture. */
export function migrateProposals(data: any): Proposal[] {
  const entry = (x: any): string | Group =>
    typeof x === 'string'
      ? x
      : {
          id: String(x.id ?? x.label),
          label: String(x.label ?? x.id),
          nses: (x.nses ?? []).map(entry),
        };
  let input = data.proposals;
  if (!input && !data.proposal && data.packages?.length)
    input = [
      {
        id: 'legacy-packages',
        name: 'Imported package grouping',
        layers: data.packages.map((p: any) => ({
          id: p.id,
          label: p.label ?? p.id,
          nses: p.nses ?? p.classes?.map((c: any) => c.id) ?? [],
        })),
      },
    ];
  if (!input && data.proposal) {
    const p = data.proposal;
    input = Array.isArray(p)
      ? [{ id: 'proposal', name: 'Proposal', layers: p }]
      : [{ id: p.id ?? 'proposal', name: p.name ?? 'Proposal', ...p }];
  }
  return (input ?? []).map((p: any, i: number) =>
    proposalSchema.parse({
      schemaVersion: 1,
      id: String(p.id ?? `proposal-${i}`),
      name: String(p.name ?? p.label ?? `Proposal ${i + 1}`),
      version: p.version ?? 1,
      notice: p.notice,
      layers: (p.layers ?? []).map((l: any, j: number) => ({
        id: String(l.id ?? l.label ?? `layer-${j}`),
        label: String(l.label ?? l.id ?? `Layer ${j + 1}`),
        nses: (l.nses ?? []).map(entry),
      })),
      omit: p.omit ?? [],
    }),
  );
}
/** Import existing function metrics and mutation outcomes; missing measurements stay absent. */
export function attachMetrics(
  nodes: GraphNode[],
  documents: any[],
): GraphNode[] {
  return nodes.map((n) => {
    const metrics: Record<string, unknown> = { ...n.metrics };
    const members = new Map<string, Record<string, unknown>>();
    for (const doc of documents) {
      if (doc.entries)
        for (const e of doc.entries) {
          if (e.namespace !== n.ns && e.namespace !== n.id) continue;
          const m: Record<string, unknown> = {};
          if (e.crap !== undefined) m.crap = e.crap;
          if (e.coverage !== undefined) m.coverage = e.coverage;
          if (e.complexity !== undefined) m.complexity = e.complexity;
          members.set(e.name, { ...members.get(e.name), ...m });
        }
      if (doc.namespace === n.ns || doc.namespace === n.id) {
        if (doc.outcomes) {
          const counts: Record<string, number> = {};
          for (const value of Object.values(doc.outcomes) as string[])
            counts[value] = (counts[value] ?? 0) + 1;
          metrics.mutation = counts;
          if (doc['tested-at']) metrics.testedAt = doc['tested-at'];
        }
        if (doc.metrics) Object.assign(metrics, doc.metrics);
      }
      const imported =
        doc.classes ??
        doc.nodes ??
        doc.packages?.flatMap((p: any) => p.classes) ??
        [];
      const m = imported.find((c: any) => c.id === n.id || c.ns === n.ns);
      if (m) {
        for (const k of [
          'crap',
          'coverage',
          'cc',
          'killed',
          'survived',
          'uncovered',
        ])
          if (m[k] !== undefined) metrics[k] = m[k];
        Object.assign(metrics, m.metrics ?? {});
      }
    }
    const rows = [...members].map(([name, metrics]) => ({ name, ...metrics }));
    if (rows.length) metrics.functions = rows;
    return { ...n, ...(Object.keys(metrics).length ? { metrics } : {}) };
  });
}
