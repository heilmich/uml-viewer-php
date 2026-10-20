import '@xyflow/react/dist/style.css';
import './style.css';
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Viewer, type ViewerEvent } from './index.js';
import type { Snapshot, Proposal, ViewState } from '../node/core/model.js';
import { proposalSchema } from '../node/core/model.js';
function App() {
  const [boot, setBoot] = useState<any>(),
    [snapshot, setSnapshot] = useState<Snapshot>(),
    [proposals, setProposals] = useState<Proposal[]>([]),
    [stale, setStale] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState('Loading project…'),
    [source, setSource] = useState<any>(),
    [editing, setEditing] = useState<string | null>(null),
    [state, setState] = useState<Partial<ViewState>>({}),
    [active, setActive] = useState<string | null>(null),
    [editorError, setEditorError] = useState(''),
    [editorVersion, setEditorVersion] = useState(0);
  async function request(
    route: string,
    method = 'GET',
    data?: unknown,
    b = boot,
    s: Pick<Snapshot, 'id'> | undefined = snapshot,
    recover = true,
  ) {
    const separator = route.includes('?') ? '&' : '?';
    const response = await fetch(
      `/api/${route}${separator}project=${encodeURIComponent(b.project.id)}&snapshot=${encodeURIComponent(s?.id ?? b.snapshotId)}`,
      {
        method,
        headers: { 'Content-Type': 'application/json', 'X-Uml-Token': b.token },
        body: data === undefined ? undefined : JSON.stringify(data),
      },
    );
    const value = await response.json();
    if (!response.ok) {
      if (response.status === 409 && recover) {
        if (value.current?.snapshotId) {
          const fresh = await (await fetch('/api/bootstrap')).json();
          setBoot(fresh);
          const graph = await request(
            'graph',
            'GET',
            undefined,
            fresh,
            { id: fresh.snapshotId },
            false,
          );
          setSnapshot(graph.snapshot);
          setStale(graph.stale);
          setProposals(
            await request(
              'proposals',
              'GET',
              undefined,
              fresh,
              graph.snapshot,
              false,
            ),
          );
        } else {
          setProposals(
            await request('proposals', 'GET', undefined, b, s, false),
          );
        }
        throw Error(
          'Conflict: another client updated this proposal or snapshot. Current versions have been reloaded; copy your edits before reopening.',
        );
      }
      throw Error(value.error ?? 'Request failed');
    }
    return value;
  }
  useEffect(() => {
    (async () => {
      try {
        const b = await (await fetch('/api/bootstrap')).json();
        setBoot(b);
        const g = await request('graph', 'GET', undefined, b);
        setSnapshot(g.snapshot);
        setStale(g.stale);
        setProposals(
          await request('proposals', 'GET', undefined, b, g.snapshot),
        );
        const saved = sessionStorage.getItem(`uml:${b.project.id}`);
        if (saved) {
          const v = JSON.parse(saved);
          setState(v);
          setActive(v.proposalId ?? null);
        }
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy('');
      }
    })();
  }, []);
  useEffect(() => {
    if (source)
      document
        .getElementById('line-' + source.line)
        ?.scrollIntoView({ block: 'center' });
  }, [source]);
  useEffect(() => {
    if (!boot || !snapshot) return;
    const timer = setInterval(() => {
      request('graph')
        .then((x) => setStale(x.stale))
        .catch(() => {});
    }, 15000);
    return () => clearInterval(timer);
  }, [boot, snapshot]);
  async function event(e: ViewerEvent) {
    try {
      setError('');
      if (e.type === 'rescan') {
        setBusy('Analyzing source files…');
        const s = await request('scan', 'POST', {});
        setSnapshot(s);
        setStale(false);
        setProposals(await request('proposals', 'GET', undefined, boot, s));
      }
      if (e.type === 'proposal') setActive(e.proposalId);
      if (e.type === 'source') {
        const data = await request(
          'source?element=' + encodeURIComponent(e.elementId),
        );
        setSource({ ...data, line: e.line ?? data.line });
      }
      if (e.type === 'share') {
        await request(
          'context?session=' + encodeURIComponent(e.sessionId),
          'PUT',
          { selection: e.ids, proposalId: e.proposalId, discussion: '' },
        );
        setError(`Selection shared with session ${e.sessionId}.`);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  function edit(p?: Proposal) {
    setEditorVersion(p?.version ?? 0);
    setEditorError('');
    setEditing(
      JSON.stringify(
        p ?? {
          schemaVersion: 1,
          id: crypto.randomUUID(),
          name: 'New proposal',
          version: 1,
          notice: 'PROPOSAL — not instantiated in code',
          layers: [],
          omit: [],
        },
        null,
        2,
      ),
    );
  }
  async function save() {
    try {
      const draft = proposalSchema.parse(JSON.parse(editing!));
      await request('proposals', 'PUT', {
        id: draft.id,
        expectedVersion: editorVersion,
        proposal: draft,
      });
      setProposals(await request('proposals'));
      setEditing(null);
    } catch (e) {
      setEditorError((e as Error).message);
    }
  }
  async function remove() {
    const p = proposals.find((p) => p.id === active);
    if (!p) return;
    try {
      await request('proposals', 'DELETE', {
        id: p.id,
        expectedVersion: p.version,
      });
      setProposals(await request('proposals'));
      setActive(null);
      setState((s) => ({ ...s, proposalId: null }));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  if (!snapshot || busy === 'Loading project…')
    return (
      <main className="loading">
        <h1>Architecture viewer</h1>
        <p role="status">{busy || error}</p>
      </main>
    );
  return (
    <>
      <header className="appbar">
        <div className="logo">
          U<span>ML</span>
        </div>
        <div>
          <strong>Project architecture</strong>
          <small>{boot.project.root}</small>
        </div>
        <span className="local">
          LOCAL · {snapshot.metadata.language.toUpperCase()}
        </span>
      </header>
      {busy && (
        <div className="banner" role="status">
          {busy}
        </div>
      )}
      {stale && (
        <div className="banner warning">
          Snapshot is stale. Source files changed; rescan to refresh.
        </div>
      )}
      {error && (
        <div className="banner" role="alert">
          {error}
          <button onClick={() => setError('')}>Dismiss</button>
        </div>
      )}
      {snapshot.diagnostics.length > 0 && (
        <details className="diagnostics">
          <summary>
            {snapshot.diagnostics.length} analysis diagnostics
            {!snapshot.metadata.complete ? ' — incomplete result' : ''}
          </summary>
          {snapshot.diagnostics.map((d, i) => (
            <p key={i}>
              {d.file}:{d.line ?? ''} · {d.severity}: {d.message}
            </p>
          ))}
        </details>
      )}
      <Viewer
        key={boot.project.id}
        snapshot={snapshot}
        proposals={proposals}
        state={state}
        onStateChange={(s) => {
          setState(s);
          sessionStorage.setItem(`uml:${boot.project.id}`, JSON.stringify(s));
        }}
        onEvent={event}
        renderActions={
          <>
            <button onClick={() => edit()}>New proposal</button>
            <button
              disabled={!active}
              onClick={() => edit(proposals.find((p) => p.id === active))}
            >
              Edit / rename
            </button>
            <button disabled={!active} onClick={remove}>
              Delete proposal
            </button>
          </>
        }
      />
      {source && (
        <div className="overlay">
          <section className="source-dialog" role="dialog" aria-label="Source">
            <header>
              <strong>
                {source.file}:{source.line}
              </strong>
              <button onClick={() => setSource(null)}>Close source</button>
            </header>
            <pre>
              {source.code.split('\n').map((text: string, i: number) => (
                <div
                  key={i}
                  id={'line-' + (i + 1)}
                  className={i + 1 === source.line ? 'highlight' : ''}
                >
                  <span className="lineno">{i + 1}</span>
                  {text || ' '}
                </div>
              ))}
            </pre>
          </section>
        </div>
      )}
      {editing !== null && (
        <div className="overlay">
          <section
            className="editor-dialog"
            role="dialog"
            aria-label="Proposal editor"
          >
            <h2>Architecture proposal</h2>
            <p>
              Edit the name and layers. Each layer has id, label and nses;
              entries are namespace IDs or nested groups. Layers are ordered
              inner first. This never changes the actual graph.
            </p>
            <textarea
              aria-label="Proposal JSON"
              value={editing}
              onChange={(e) => setEditing(e.target.value)}
            />
            {editorError && <p role="alert">{editorError}</p>}
            <button onClick={save}>Save proposal</button>
            <button onClick={() => setEditing(null)}>Cancel</button>
          </section>
        </div>
      )}
    </>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
