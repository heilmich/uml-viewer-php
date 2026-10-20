import { migrateProposals } from './migration.js';
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
      policy.levels.length
        ? policy.levels.map((g) => (Array.isArray(g) ? g : g.nses))
        : (migrateProposals(policy)[0]?.layers.map((l) => leaves(l.nses)) ??
            []),
    ).sort((a, b) => a.id.localeCompare(b.id)),
  };
}
export interface Diagram {
  nodes: (GraphNode & { count?: number; drill?: boolean })[];
  edges: (GraphEdge & { members: GraphEdge[] })[];
}
export interface ProposalLocation {
  id: string;
  label: string;
  nses: (string | Group)[];
}
/** Ordered ancestry makes nested proposal views navigable without flattening groups. */
export function proposalTrail(
  proposal: Proposal,
  path: string,
): ProposalLocation[] {
  for (const layer of proposal.layers) {
    const root = { ...layer, id: `proposal.${layer.id}` };
    if (root.id === path) return [root];
    function find(
      entries: (string | Group)[],
      trail: ProposalLocation[],
    ): ProposalLocation[] | undefined {
      for (const entry of entries) {
        if (typeof entry === 'string') continue;
        const item = { ...entry, id: `group.${entry.id}` };
        if (item.id === path) return [...trail, item];
        const found = find(entry.nses, [...trail, item]);
        if (found) return found;
      }
      return undefined;
    }
    const found = find(layer.nses, [root]);
    if (found) return found;
  }
  return [];
}
export function viewAt(
  snapshot: Pick<Snapshot, 'nodes' | 'edges'> &
    Partial<Pick<Snapshot, 'policy'>>,
  path = '',
  proposal?: Proposal,
): Diagram {
  let nodes = snapshot.nodes.filter(
      (n) => !proposal?.omit.some((p) => matches(n.id, p)),
    ),
    edges = snapshot.edges;
  if (proposal?.scope) {
    const ids = new Set(proposal.scope.nodeIds),
      edgeIds = new Set(proposal.scope.edgeIds);
    nodes = nodes.filter((n) => ids.has(n.id));
    edges = edges.filter((e) => edgeIds.has(e.id));
  }
  const rootOwners = new Map<string, string>();
  const virtual = new Map<string, GraphNode>();
  if (proposal) {
    for (const layer of proposal.layers) {
      const id = `proposal.${layer.id}`;
      virtual.set(id, { id, name: layer.label, kind: 'component' });
      for (const n of nodes)
        if (leaves(layer.nses).some((p) => matches(n.id, p)))
          rootOwners.set(n.id, id);
    }
    edges = markViolations(
      edges,
      proposal.layers.map((l) => leaves(l.nses)),
    );
  }
  const trail = proposal ? proposalTrail(proposal, path) : [];
  const location = trail.at(-1);
  const groupOwners = new Map<string, string>();
  if (location)
    for (const entry of location.nses) {
      if (typeof entry === 'string') continue;
      const id = `group.${entry.id}`;
      virtual.set(id, { id, name: entry.label, kind: 'component' });
      for (const n of nodes)
        if (leaves(entry.nses).some((p) => matches(n.id, p)))
          groupOwners.set(n.id, id);
    }
  const inScope = (n: GraphNode) =>
    !n.foreign &&
    (!path ||
      (location
        ? leaves(location.nses).some((p) => matches(n.id, p))
        : matches(n.id, path)));
  const home = new Set(nodes.filter(inScope).map((n) => n.id));
  const adjacent = new Set<string>();
  for (const e of edges)
    if (home.has(e.from) || home.has(e.to)) {
      adjacent.add(e.from);
      adjacent.add(e.to);
    }
  const visible = new Map<
      string,
      GraphNode & { count?: number; drill?: boolean }
    >(),
    mapping = new Map<string, string>();
  for (const n of nodes) {
    const inside = home.has(n.id);
    if (path && !inside && !adjacent.has(n.id)) continue;
    if (n.foreign && !adjacent.has(n.id)) continue;
    let id: string;
    if (n.foreign) id = n.id;
    else if (proposal && !path) id = rootOwners.get(n.id) ?? n.id.split('.')[0];
    else if (location)
      id = inside
        ? (groupOwners.get(n.id) ?? n.id)
        : (rootOwners.get(n.id) ?? n.id.split('.')[0]);
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
    mapping.set(n.id, id);
    const direct = n.id === id,
      current = visible.get(id);
    if (current) {
      current.count = (current.count ?? 1) + 1;
      current.drill ||= !direct;
      if (!direct) current.kind = 'component';
    } else
      visible.set(id, {
        ...(direct
          ? n
          : (virtual.get(id) ?? {
              id,
              name: id.split('.').at(-1)!,
              kind: 'component',
            })),
        count: 1,
        drill: !direct,
        ...(path && !inside && !n.foreign ? { external: true } : {}),
      });
  }
  const bundled = new Map<string, GraphEdge & { members: GraphEdge[] }>();
  const kinds = snapshot.policy?.['edge-kinds'] ?? {},
    omitted = snapshot.policy?.['omit-edges'] ?? [];
  const strength: Record<GraphEdge['kind'], number> = {
    dependency: 0,
    association: 1,
    aggregation: 2,
    composition: 3,
    inheritance: 4,
    implements: 4,
  };
  for (const e of edges) {
    const from = mapping.get(e.from),
      to = mapping.get(e.to);
    if (
      !from ||
      !to ||
      from === to ||
      omitted.some(([f, t]) => from === f && to === t)
    )
      continue;
    const key = JSON.stringify([from, to]),
      old = bundled.get(key),
      override = kinds[`${from}|${to}`];
    if (old) {
      old.members.push(e);
      if (!override && strength[e.kind] > strength[old.kind]) {
        old.kind = e.kind;
        old.label = e.label;
      }
      old.violating ||= e.violating;
    } else
      bundled.set(key, {
        ...e,
        id: edgeId(from, to, 'bundle'),
        from,
        to,
        kind: override ?? e.kind,
        violating: override && override !== 'dependency' ? false : e.violating,
        members: [e],
      });
  }
  for (const e of bundled.values())
    if (kinds[`${e.from}|${e.to}`] && e.kind !== 'dependency')
      e.violating = false;
  const configured = snapshot.policy?.order,
    order = Array.isArray(configured)
      ? !path
        ? configured
        : []
      : (configured?.[path] ?? []);
  const rank = (id: string) => {
    const i = order.findIndex(
      (p) => matches(id, p) || id.split('.').at(-1) === p,
    );
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  return {
    nodes: [...visible.values()].sort(
      (a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id),
    ),
    edges: [...bundled.values()],
  };
}
function legacyMember(value: unknown) {
  if (typeof value === 'string') return { text: value };
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Error('Legacy member must be a string or object');
  const m = value as Record<string, any>;
  const text =
    m.text ??
    `${m.name ?? ''}${m.args?.length ? `(${m.args.join(', ')})` : ''}${m.type ? ` : ${m.type}` : ''}${m.returns ? ` : ${m.returns}` : ''}`;
  return { ...m, text };
}
export function legacyDiagrams(data: any): any[] {
  if (!data || typeof data !== 'object' || Array.isArray(data))
    throw Error('Expected an IR document');
  if (data.diagrams !== undefined) {
    if (!Array.isArray(data.diagrams) || !data.diagrams.length)
      throw Error('diagrams must be a non-empty array');
    return data.diagrams.flatMap(legacyDiagrams);
  }
  if (
    !['classes', 'nodes', 'packages', 'foreign'].some((k) =>
      Object.hasOwn(data, k),
    )
  )
    throw Error('IR document needs classes, packages, nodes or diagrams');
  return [data];
}
export function importLegacyGraph(data: any) {
  const nodes = new Map<string, GraphNode>(),
    edges = new Map<string, GraphEdge>();
  for (const diagram of legacyDiagrams(data)) {
    const raw =
      diagram.classes ??
      diagram.nodes ??
      diagram.packages?.flatMap((p: any) => p.classes ?? []) ??
      [];
    for (const n of [...raw, ...(diagram.foreign ?? [])]) {
      if (!n || typeof n !== 'object' || Array.isArray(n))
        throw Error('Legacy class must be an object');
      const name = n.name ?? n.id;
      if (typeof name !== 'string')
        throw Error('Legacy class needs name or id');
      const id = n.id ?? name.toLowerCase().replace(/\s+/g, '-');
      const crap =
        typeof n.crap === 'number'
          ? { mu: n.crap, max: n.crap, sigma: 0 }
          : n.crap && typeof n.crap === 'object'
            ? {
                ...n.crap,
                ...(n.crap.sigma === undefined && n.crap.sd !== undefined
                  ? { sigma: n.crap.sd }
                  : {}),
              }
            : n.crap;
      const metrics = {
        ...Object.fromEntries(
          ['coverage', 'cc', 'killed', 'survived', 'uncovered']
            .filter((k) => n[k] !== undefined && n[k] !== null)
            .map((k) => [k, n[k]]),
        ),
        ...(crap !== undefined && crap !== null ? { crap } : {}),
        ...n.metrics,
      };
      const normalized: GraphNode = {
        ...n,
        id,
        name,
        foreign: n.foreign ?? n.shape === 'oval',
        ...(n.fields ? { fields: n.fields.map(legacyMember) } : {}),
        ...(n.ops ? { ops: n.ops.map(legacyMember) } : {}),
        ...(Object.keys(metrics).length ? { metrics } : {}),
      };
      const previous = nodes.get(id);
      if (!previous) nodes.set(id, normalized);
      else {
        const mergeMembers = (
          a: GraphNode['fields'],
          b: GraphNode['fields'],
        ) => [
          ...new Map(
            [...(a ?? []), ...(b ?? [])].map((m) => [m.name ?? m.text, m]),
          ).values(),
        ];
        nodes.set(id, {
          ...previous,
          ...normalized,
          fields: mergeMembers(previous.fields, normalized.fields),
          ops: mergeMembers(previous.ops, normalized.ops),
          ...(previous.metrics || normalized.metrics
            ? { metrics: { ...previous.metrics, ...normalized.metrics } }
            : {}),
        });
      }
    }
    for (const e of diagram.edges ?? []) {
      if (typeof e.from !== 'string' || typeof e.to !== 'string')
        throw Error('Legacy relationship needs from and to IDs');
      const kind = e.kind ?? 'association',
        id = edgeId(e.from, e.to, kind, e.label);
      const old = edges.get(id);
      edges.set(id, {
        ...old,
        ...e,
        id,
        kind,
        sources: [...(old?.sources ?? []), ...(e.sources ?? [])],
      });
    }
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}
