import React, {
  useMemo,
  useState,
  useCallback,
  useRef,
  useEffect,
} from 'react';
import {
  ReactFlow,
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
  ReactFlowProvider,
  useReactFlow,
  Background,
  Controls,
  MiniMap,
  MarkerType,
  type Node,
  type Edge,
} from '@xyflow/react';
import dagre from '@dagrejs/dagre';
import { viewAt } from '../node/core/graph.js';
import type {
  Snapshot,
  Proposal,
  ViewState,
  GraphNode,
} from '../node/core/model.js';
function RelationshipEdge(props: EdgeProps) {
  const [edgePath, x, y] = getBezierPath(props);
  const data = props.data as { text: string; inspect: () => void };
  return (
    <>
      <BaseEdge
        path={edgePath}
        markerEnd={props.markerEnd}
        style={props.style}
        interactionWidth={30}
      />
      <EdgeLabelRenderer>
        <button
          className="edge-label nodrag nopan"
          style={{
            transform: `translate(-50%, -50%) translate(${x}px,${y + (props.source < props.target ? -18 : 18)}px)`,
          }}
          onClick={data.inspect}
        >
          {data.text}
        </button>
      </EdgeLabelRenderer>
    </>
  );
}
const edgeTypes = { relationship: RelationshipEdge };
export type ViewerEvent =
  | { type: 'selection'; ids: string[]; projectId: string; snapshotId: string }
  | { type: 'navigation'; path: string }
  | { type: 'proposal'; proposalId: string | null }
  | { type: 'source'; elementId: string; line?: number }
  | { type: 'rescan' }
  | {
      type: 'share';
      sessionId: string;
      ids: string[];
      proposalId: string | null;
    };
export interface ViewerProps {
  snapshot: Snapshot;
  proposals?: Proposal[];
  state?: Partial<ViewState>;
  onStateChange?: (state: ViewState) => void;
  onEvent?: (event: ViewerEvent) => void;
  renderActions?: React.ReactNode;
}
function Canvas({
  snapshot,
  proposals = [],
  state = {},
  onStateChange,
  onEvent,
  renderActions,
}: ViewerProps) {
  const [path, setPath] = useState(state.path ?? ''),
    [selected, setSelected] = useState(state.selectedId ?? ''),
    [proposalId, setProposal] = useState<string | null>(
      state.proposalId ?? null,
    ),
    [detail, setDetail] = useState(true),
    [showEdges, setShowEdges] = useState(true),
    [showExternal, setShowExternal] = useState(false),
    [bundle, setBundle] = useState<any>(null),
    [viewport, setViewport] = useState({
      x: state.x ?? 0,
      y: state.y ?? 0,
      zoom: state.zoom ?? 1,
    });
  const proposal = proposals.find((p) => p.id === proposalId);
  const diagram = useMemo(() => {
    const view = viewAt(snapshot, path, proposal);
    if (showExternal) return view;
    const nodes = view.nodes.filter((n) => !n.foreign);
    const ids = new Set(nodes.map((n) => n.id));
    return {
      nodes,
      edges: view.edges.filter((e) => ids.has(e.from) && ids.has(e.to)),
    };
  }, [snapshot, path, proposal, showExternal]);
  const { fitView } = useReactFlow();
  const firstFit = useRef(true);
  useEffect(() => {
    if (firstFit.current && state.zoom) {
      firstFit.current = false;
      return;
    }
    firstFit.current = false;
    const frame = requestAnimationFrame(() => {
      void fitView({ minZoom: 0.6, maxZoom: 1, padding: 0.15 });
    });
    return () => cancelAnimationFrame(frame);
  }, [path, proposalId, showExternal, fitView]);
  const currentView = useRef<ViewState>({
    path,
    selectedId: selected,
    proposalId,
    ...viewport,
  });
  const update = useCallback(
    (extra: Partial<ViewState>) => {
      currentView.current = { ...currentView.current, ...extra };
      onStateChange?.(currentView.current);
    },
    [onStateChange],
  );
  useEffect(() => {
    if (state.proposalId !== undefined) {
      setProposal(state.proposalId);
      currentView.current.proposalId = state.proposalId;
    }
  }, [state.proposalId]);

  const navigate = (p: string) => {
    setPath(p);
    setSelected('');
    setBundle(null);
    update({ path: p, selectedId: '' });
    onEvent?.({ type: 'navigation', path: p });
  };
  const data = useMemo(() => {
    const layout = new dagre.graphlib.Graph();
    layout.setGraph({ rankdir: 'LR', nodesep: 40, ranksep: 100 });
    layout.setDefaultEdgeLabel(() => ({}));
    for (const n of diagram.nodes)
      layout.setNode(n.id, { width: 230, height: detail ? 110 : 65 });
    for (const e of diagram.edges) layout.setEdge(e.from, e.to);
    dagre.layout(layout);
    const connected = new Set(
      diagram.edges
        .filter((e) => e.from === selected || e.to === selected)
        .flatMap((e) => [e.from, e.to]),
    );
    const nodes: Node[] = diagram.nodes.map((n) => {
      const pos = layout.node(n.id);
      return {
        id: n.id,
        position: { x: pos.x - 115, y: pos.y - 50 },
        selected: n.id === selected,
        data: {
          label: (
            <div className="box">
              <small>
                {n.foreign
                  ? 'EXTERNAL'
                  : n.drill
                    ? 'COMPONENT'
                    : (n.kind ?? 'CLASS')}
              </small>
              <strong>{n.name}</strong>
              {detail && (
                <span>
                  {n.drill
                    ? `${n.count} declarations · double click to explore`
                    : `${n.fields?.length ?? 0} fields · ${n.ops?.length ?? 0} methods`}
                </span>
              )}
            </div>
          ),
        },
        style: {
          width: 230,
          borderColor: n.foreign
            ? '#64748b'
            : n.id === selected
              ? '#0d9488'
              : '#cbd5e1',
          opacity:
            selected && !connected.has(n.id) && selected !== n.id ? 0.4 : 1,
          borderStyle: n.foreign ? 'dashed' : 'solid',
        },
      };
    });
    const edges: Edge[] = showEdges
      ? diagram.edges.map((e) => ({
          id: e.id,
          type: 'relationship',
          source: e.from,
          target: e.to,
          label: `${e.violating ? '⚠ ' : ''}${e.members.length > 1 ? `${e.members.length} relations` : (e.label ?? e.kind)}`,
          animated: !!selected && (e.from === selected || e.to === selected),
          markerEnd: { type: MarkerType.ArrowClosed },
          style: {
            stroke: e.violating
              ? '#dc2626'
              : selected && (e.from === selected || e.to === selected)
                ? '#0d9488'
                : '#94a3b8',
            strokeWidth: e.violating ? 3 : 1.5,
          },
          data: {
            bundle: e,
            text: `${e.violating ? '⚠ ' : ''}${e.members.length > 1 ? `${e.members.length} relations` : (e.label ?? e.kind)}`,
            inspect: () => setBundle(e),
          },
        }))
      : [];
    return { nodes, edges };
  }, [diagram, selected, detail, showEdges]);
  const picked =
    snapshot.nodes.find((n) => n.id === selected) ??
    diagram.nodes.find((n) => n.id === selected);
  const pickedBox = diagram.nodes.find((n) => n.id === selected);
  const [session, setSession] = useState('');
  return (
    <div className="viewer">
      <div className="toolbar">
        <div>
          <b>Architecture</b>
          <span className="muted">{snapshot.project.name}</span>
        </div>
        <select
          aria-label="Architecture mode"
          value={proposalId ?? ''}
          onChange={(e) => {
            const id = e.target.value || null;
            setProposal(id);
            setPath('');
            setSelected('');
            setBundle(null);
            update({ proposalId: id, path: '', selectedId: '' });
            onEvent?.({ type: 'proposal', proposalId: id });
          }}
        >
          <option value="">Actual code</option>
          {proposals.map((p) => (
            <option key={p.id} value={p.id}>
              PROPOSAL: {p.name}
            </option>
          ))}
        </select>
        <button onClick={() => onEvent?.({ type: 'rescan' })}>Rescan</button>
        <label>
          <input
            type="checkbox"
            checked={detail}
            onChange={(e) => setDetail(e.target.checked)}
          />{' '}
          Details
        </label>
        <label>
          <input
            type="checkbox"
            checked={showEdges}
            onChange={(e) => setShowEdges(e.target.checked)}
          />{' '}
          Arrows
        </label>
        <label>
          <input
            type="checkbox"
            checked={showExternal}
            onChange={(e) => setShowExternal(e.target.checked)}
          />{' '}
          Externals
        </label>
        {renderActions}
      </div>
      {proposal && (
        <div className="proposal-notice">
          PROPOSAL — not instantiated in code · {proposal.name} · version{' '}
          {proposal.version}
        </div>
      )}
      <nav aria-label="Breadcrumb">
        <button onClick={() => navigate('')}>Overview</button>
        {path && !path.startsWith('proposal.') && !path.startsWith('group.')
          ? path.split('.').map((s, i) => (
              <React.Fragment key={i}>
                {' '}
                /{' '}
                <button
                  onClick={() =>
                    navigate(
                      path
                        .split('.')
                        .slice(0, i + 1)
                        .join('.'),
                    )
                  }
                >
                  {s}
                </button>
              </React.Fragment>
            ))
          : path && <span> / {path}</span>}
        {path && (
          <button
            onClick={() =>
              navigate(
                path.includes('.') &&
                  !path.startsWith('proposal.') &&
                  !path.startsWith('group.')
                  ? path.split('.').slice(0, -1).join('.')
                  : '',
              )
            }
          >
            ← Back
          </button>
        )}
      </nav>
      <div className="workbench">
        <div className="canvas">
          {!snapshot.nodes.length ? (
            <div className="empty">
              <h2>No declarations found</h2>
              <p>Choose a source project and rescan.</p>
            </div>
          ) : (
            <ReactFlow
              nodes={data.nodes}
              edges={data.edges}
              edgeTypes={edgeTypes}
              defaultViewport={viewport}
              fitView={!state.zoom}
              fitViewOptions={{ minZoom: 0.6, maxZoom: 1, padding: 0.15 }}
              minZoom={0.05}
              maxZoom={3}
              onMoveEnd={(_, v) => {
                setViewport(v);
                update(v);
              }}
              onNodeClick={(_, n) => {
                setSelected(n.id);
                setBundle(null);
                update({ selectedId: n.id });
                onEvent?.({
                  type: 'selection',
                  ids: [n.id],
                  projectId: snapshot.project.id,
                  snapshotId: snapshot.id,
                });
              }}
              onNodeDoubleClick={(_, n) => {
                const box = diagram.nodes.find((x) => x.id === n.id);
                if (box?.drill) navigate(n.id);
              }}
              onEdgeClick={(_, e) => setBundle(e.data?.bundle)}
              nodesDraggable={false}
              zoomOnDoubleClick={false}
            >
              <Background gap={24} />
              <Controls />
              <MiniMap pannable zoomable />
            </ReactFlow>
          )}
        </div>
        <aside>
          <h2>
            {bundle ? 'Relationship bundle' : (picked?.name ?? 'Inspector')}
          </h2>
          {bundle ? (
            <>
              <p>
                {bundle.from} → {bundle.to}
              </p>
              {bundle.members.map((e: any) => (
                <div className="relation" key={e.id}>
                  <b>
                    {e.kind}
                    {e.label ? ' · ' + e.label : ''}
                    {e.violating ? ' · RULE VIOLATION' : ''}
                  </b>
                  <p>
                    {e.from} → {e.to}
                  </p>
                  {e.sources.map((s: any, i: number) => (
                    <small key={i}>
                      {s.file}:{s.line} · {s.via}
                      <br />
                    </small>
                  ))}
                </div>
              ))}
            </>
          ) : picked ? (
            <>
              <span className="pill">
                {picked.foreign
                  ? 'External dependency'
                  : (picked.kind ?? 'Class')}
              </span>
              <p className="mono">{picked.ns ?? picked.id}</p>
              {pickedBox?.drill && (
                <button onClick={() => navigate(picked.id)}>
                  Explore component
                </button>
              )}
              {picked.file && (
                <button
                  onClick={() =>
                    onEvent?.({ type: 'source', elementId: picked.id })
                  }
                >
                  {picked.file}:{picked.line ?? 1}
                </button>
              )}
              <h3>Fields / cases</h3>
              {picked.fields?.length ? (
                picked.fields.map((m, i) => (
                  <button
                    className="member"
                    key={i}
                    disabled={!picked.file}
                    onClick={() =>
                      onEvent?.({
                        type: 'source',
                        elementId: picked.id,
                        line: m.line,
                      })
                    }
                  >
                    {m.text ?? m.name}
                  </button>
                ))
              ) : (
                <p className="muted">None</p>
              )}
              <h3>Methods</h3>
              {picked.ops?.length ? (
                picked.ops.map((m, i) => (
                  <button
                    className="member"
                    key={i}
                    disabled={!picked.file}
                    onClick={() =>
                      onEvent?.({
                        type: 'source',
                        elementId: picked.id,
                        line: m.line,
                      })
                    }
                  >
                    {m.text ?? m.name}
                  </button>
                ))
              ) : (
                <p className="muted">None</p>
              )}
              <h3>Metrics</h3>
              {picked.metrics && Object.keys(picked.metrics).length ? (
                <pre>{JSON.stringify(picked.metrics, null, 2)}</pre>
              ) : (
                <p className="muted">No metrics imported</p>
              )}
            </>
          ) : (
            <p className="muted">
              Select a node or arrow. Double click a component to explore it.
              Drag the canvas to pan.
            </p>
          )}
          <div className="share">
            <h3>Share selection explicitly</h3>
            <input
              aria-label="Session ID"
              placeholder="Session ID"
              value={session}
              onChange={(e) => setSession(e.target.value)}
            />
            <button
              disabled={!session || !selected}
              onClick={() =>
                onEvent?.({
                  type: 'share',
                  sessionId: session,
                  ids: [selected],
                  proposalId,
                })
              }
            >
              Send to session
            </button>
            <small>Each session receives only explicitly shared context.</small>
          </div>
        </aside>
      </div>
      <footer>
        {snapshot.nodes.filter((n) => !n.foreign).length} declarations ·{' '}
        {snapshot.edges.length} relations · {snapshot.metadata.fileCount} files
        · {snapshot.metadata.durationMs} ms analysis{' '}
        <span>
          {snapshot.metadata.complete
            ? 'Complete snapshot'
            : 'INCOMPLETE SNAPSHOT'}
        </span>
      </footer>
    </div>
  );
}
export function Viewer(props: ViewerProps) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}
