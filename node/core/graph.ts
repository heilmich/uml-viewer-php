import {
  edgeId,
  matches,
  type GraphNode,
  type GraphEdge,
  type Policy,
  type Snapshot,
  type Proposal,
  type Group,
} from './model.js';
export function rankOf(id: string, ranks: Map<string, number>) {
  return [...ranks]
    .filter(([p]) => matches(id, p))
    .sort((a, b) => b[0].length - a[0].length)[0]?.[1];
}
export function leaves(entries: (string | Group)[]): string[] {
  return entries.flatMap((x) => (typeof x === 'string' ? [x] : leaves(x.nses)));
}
export function markViolations(edges: GraphEdge[], levels: string[][]) {
  const ranks = new Map(
    levels.flatMap((g, i) => g.map((x) => [x, i] as const)),
  );
  return edges.map((e) => {
    const f = rankOf(e.from, ranks),
      t = rankOf(e.to, ranks);
    return {
      ...e,
      violating:
        e.kind === 'dependency' && f !== undefined && t !== undefined && f < t,
    };
  });
}
export function applyPolicy(
  nodes: GraphNode[],
  edges: GraphEdge[],
  policy: Policy,
) {
  const remap = new Map<string, string>();
  const kept: GraphNode[] = [];
  for (const n of nodes) {
    if (policy.omit.some((p) => matches(n.id, p))) continue;
    if (!n.foreign || policy.foreign === undefined) kept.push(n);
    else {
      const p = policy.foreign
        .filter((p) => matches(n.id, p))
        .sort((a, b) => b.length - a.length)[0];
      if (p) {
        remap.set(n.id, p);
        if (!kept.some((n) => n.id === p))
          kept.push({ id: p, name: p, foreign: true });
      }
    }
  }
  const ids = new Set(kept.map((n) => n.id));
  const mapped = edges
    .map((e) => ({
      ...e,
      from: remap.get(e.from) ?? e.from,
      to: remap.get(e.to) ?? e.to,
    }))
    .filter(
      (e) =>
        e.from !== e.to &&
        ids.has(e.from) &&
        ids.has(e.to) &&
        !policy['omit-edges'].some(([f, t]) => f === e.from && t === e.to),
    )
    .map((e) => {
      const kind = policy['edge-kinds'][`${e.from}|${e.to}`] ?? e.kind;
      return { ...e, kind, id: edgeId(e.from, e.to, kind, e.label) };
    });
  const dedup = new Map<string, GraphEdge>();
  for (const e of mapped) {
    const prev = dedup.get(e.id);
    if (prev)
      prev.sources = [...prev.sources, ...e.sources].filter(
        (x, i, a) =>
          a.findIndex((y) => JSON.stringify(x) === JSON.stringify(y)) === i,
      );
    else dedup.set(e.id, e);
  }
  return {
    nodes: kept.sort((a, b) => a.id.localeCompare(b.id)),
    edges: markViolations(
      [...dedup.values()],
      policy.levels.map((g) => (Array.isArray(g) ? g : g.nses)),
    ).sort((a, b) => a.id.localeCompare(b.id)),
  };
}
export interface Diagram {
  nodes: (GraphNode & { count?: number; drill?: boolean })[];
  edges: (GraphEdge & { members: GraphEdge[] })[];
}
export function viewAt(
  snapshot: Pick<Snapshot, 'nodes' | 'edges'> &
    Partial<Pick<Snapshot, 'policy'>>,
  path = '',
  proposal?: Proposal,
): Diagram {
  let nodes = snapshot.nodes,
    edges = snapshot.edges;
  const owners = new Map<string, string>();
  const virtual: GraphNode[] = [];
  if (proposal) {
    nodes = nodes.filter((n) => !proposal.omit.some((p) => matches(n.id, p)));
    for (const layer of proposal.layers) {
      virtual.push({
        id: `proposal.${layer.id}`,
        name: layer.label,
        kind: 'component',
      });
      for (const n of nodes)
        if (leaves(layer.nses).some((p) => matches(n.id, p)))
          owners.set(n.id, `proposal.${layer.id}`);
    }
    edges = markViolations(
      edges,
      proposal.layers.map((l) => leaves(l.nses)),
    );
    if (path.startsWith('proposal.')) {
      const layer = proposal.layers.find((l) => `proposal.${l.id}` === path);
      if (layer) {
        const groups = layer.nses.filter(
          (x): x is Group => typeof x !== 'string',
        );
        for (const g of groups) {
          virtual.push({
            id: `group.${g.id}`,
            name: g.label,
            kind: 'component',
          });
          for (const n of nodes)
            if (leaves(g.nses).some((p) => matches(n.id, p)))
              owners.set(n.id, `group.${g.id}`);
        }
        nodes = nodes.filter((n) =>
          leaves(layer.nses).some((p) => matches(n.id, p)),
        );
      }
    }
    if (path.startsWith('group.')) {
      let found: Group | undefined;
      function find(xs: (string | Group)[]) {
        for (const x of xs)
          if (typeof x !== 'string') {
            if (`group.${x.id}` === path) found = x;
            find(x.nses);
          }
      }
      proposal.layers.forEach((l) => find(l.nses));
      if (found)
        nodes = nodes.filter((n) =>
          leaves(found!.nses).some((p) => matches(n.id, p)),
        );
    }
  }
  const visible = new Map<
    string,
    GraphNode & { count?: number; drill?: boolean }
  >();
  const mapping = new Map<string, string>();
  for (const n of nodes) {
    let id: string | undefined;
    if (n.foreign) id = n.id;
    else if (proposal && !path) id = owners.get(n.id) ?? n.id.split('.')[0];
    else if (proposal && path.startsWith('proposal.'))
      id = owners.get(n.id)?.startsWith('group.') ? owners.get(n.id) : n.id;
    else if (path.startsWith('group.')) id = n.id;
    else if (!path) id = n.id.split('.')[0];
    else if (n.id.startsWith(path + '.'))
      id = n.id
        .split('.')
        .slice(0, path.split('.').length + 1)
        .join('.');
    else if (n.id === path) id = n.id;
    else
      id = n.id
        .split('.')
        .slice(0, Math.max(1, path.split('.').length))
        .join('.');
    if (!id) continue;
    mapping.set(n.id, id);
    const direct = n.id === id;
    const current = visible.get(id);
    if (current) current.count = (current.count ?? 1) + 1;
    else
      visible.set(id, {
        ...(direct
          ? n
          : (virtual.find((v) => v.id === id) ?? {
              id,
              name: id.split('.').at(-1)!,
              kind: 'component',
            })),
        count: 1,
        drill: !direct,
      });
  }
  const bundled = new Map<string, GraphEdge & { members: GraphEdge[] }>();
  for (const e of edges) {
    const from = mapping.get(e.from),
      to = mapping.get(e.to);
    if (!from || !to || from === to) continue;
    const k = `${from}|${to}`;
    const old = bundled.get(k);
    if (old) {
      old.members.push(e);
      old.violating ||= e.violating;
    } else
      bundled.set(k, {
        ...e,
        id: edgeId(from, to, 'bundle'),
        from,
        to,
        members: [e],
      });
  }
  const configured = snapshot.policy?.order;
  const order = Array.isArray(configured)
    ? !path
      ? configured
      : []
    : (configured?.[path] ?? []);
  const rank = (id: string) => {
    const index = order.findIndex(
      (p) => matches(id, p) || id.split('.').at(-1) === p,
    );
    return index < 0 ? Number.MAX_SAFE_INTEGER : index;
  };
  return {
    nodes: [...visible.values()].sort(
      (a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id),
    ),
    edges: [...bundled.values()],
  };
}
export function importLegacyGraph(data: any) {
  const nodes: GraphNode[] = (
    data.classes ??
    data.packages?.flatMap((p: any) => p.classes) ??
    []
  )
    .concat(data.foreign ?? [])
    .map((n: any) => ({
      ...n,
      foreign: n.foreign ?? n.shape === 'oval',
      metrics:
        n.metrics ??
        Object.fromEntries(
          ['crap', 'coverage', 'cc', 'killed', 'survived', 'uncovered']
            .filter((k) => n[k] !== undefined)
            .map((k) => [k, n[k]]),
        ),
    }));
  const edges: GraphEdge[] = (data.edges ?? []).map((e: any) => ({
    ...e,
    id: edgeId(e.from, e.to, e.kind, e.label),
    sources: e.sources ?? [],
  }));
  return { nodes, edges };
}
