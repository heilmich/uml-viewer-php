import { Engine } from 'php-parser';
import {
  edgeId,
  type LanguageAdapter,
  type SourceFile,
  type Policy,
  type GraphNode,
  type GraphEdge,
  type AnalysisResult,
} from '../core/model.js';
// php-parser's AST is intentionally accessed behind this adapter, never exposed as the public graph contract.
type Ast = any;
export interface Dependency {
  name: string;
  via: string;
  line: number;
}
export interface Declaration {
  kind: string;
  name: string;
  short: string;
  namespace: string;
  line: number;
  endLine: number;
  abstract: boolean;
  final: boolean;
  readonly: boolean;
  extends: string[];
  implements: string[];
  traits: string[];
  backing: string | null;
  properties: any[];
  methods: any[];
  cases: any[];
  deps: Dependency[];
  unresolved: { via: string; line: number; expression: string }[];
}
export interface FileFacts {
  file: string;
  errors: string[];
  declarations: Declaration[];
}
const builtin = new Set(
  'int float string bool array object callable iterable void mixed never null false true resource self static parent'.split(
    ' ',
  ),
);
const nameOf = (n: Ast): string =>
  typeof n === 'string' ? n : (n?.name ?? n?.raw ?? '');
const line = (n: Ast) => n?.loc?.start?.line ?? 1;
function typeText(n: Ast, nullable = false): string | null {
  if (!n) return null;
  let text: string;
  if (n.kind === 'uniontype')
    text = n.types
      .map((t: Ast) =>
        t.kind === 'intersectiontype' ? `(${typeText(t)})` : typeText(t),
      )
      .join('|');
  else if (n.kind === 'intersectiontype')
    text = n.types.map((t: Ast) => typeText(t)).join('&');
  else text = nameOf(n).split('\\').at(-1) ?? '';
  return (nullable ? '?' : '') + text;
}
export function parsePhp(file: string, code: string): FileFacts {
  const result: FileFacts = { file, errors: [], declarations: [] };
  let ast: Ast;
  try {
    ast = new Engine({
      parser: { version: '8.4', suppressErrors: false },
      ast: { withPositions: true },
    } as any).parseCode(code, file);
  } catch (primary) {
    // php-parser 3.7's PHP 8.4 promotion lookahead rejects valid DNF promoted types.
    // Its PHP 8.3 grammar handles those without altering the source or its locations.
    try {
      ast = new Engine({
        parser: { version: '8.3', suppressErrors: false },
        ast: { withPositions: true },
      } as any).parseCode(code, file);
    } catch {
      result.errors.push((primary as Error).message);
      return result;
    }
  }

  function scope(children: Ast[], namespace: string) {
    const aliases = new Map<string, string>();
    for (const n of children)
      if (n.kind === 'usegroup')
        for (const item of n.items ?? []) {
          if ((item.type ?? n.type) && !['class'].includes(item.type ?? n.type))
            continue;
          const fqn = [n.name, item.name]
            .filter(Boolean)
            .join('\\')
            .replace(/^\\/, '');
          aliases.set(
            (nameOf(item.alias) || fqn.split('\\').at(-1)!).toLowerCase(),
            fqn,
          );
        }
    const resolve = (n: Ast): string | null => {
      const raw = nameOf(n);
      if (!raw || builtin.has(raw.toLowerCase())) return null;
      if (raw.startsWith('\\') || n?.resolution === 'fqn')
        return raw.replace(/^\\/, '');
      if (raw.toLowerCase().startsWith('namespace\\'))
        return [namespace, raw.slice(10)].filter(Boolean).join('\\');
      const parts = raw.split('\\');
      const alias = aliases.get(parts[0].toLowerCase());
      return alias
        ? [alias, ...parts.slice(1)].join('\\')
        : [namespace, raw].filter(Boolean).join('\\');
    };
    const display = (n: Ast, nullable = false): string | null => {
      if (!n) return null;
      const text =
        n.kind === 'uniontype'
          ? n.types
              .map((t: Ast) =>
                t.kind === 'intersectiontype' ? `(${display(t)})` : display(t),
              )
              .join('|')
          : n.kind === 'intersectiontype'
            ? n.types.map((t: Ast) => display(t)).join('&')
            : ((resolve(n) ?? nameOf(n)).split('\\').at(-1) ?? '');
      return (nullable ? '?' : '') + text;
    };
    const types = (n: Ast): string[] =>
      !n
        ? []
        : n.types
          ? [...new Set<string>(n.types.flatMap(types))]
          : [resolve(n)].filter((x): x is string => !!x);
    function visit(n: Ast, owner?: Declaration, headerTraits = new Set<Ast>()) {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n)) {
        n.forEach((x) => visit(x, owner, headerTraits));
        return;
      }
      if (n.kind === 'namespace') {
        scope(n.children ?? [], n.name ?? '');
        return;
      }
      if (n.kind === 'usegroup') return;
      const isClass = ['class', 'interface', 'trait', 'enum'].includes(n.kind);
      if (isClass && n.name && !n.isAnonymous) {
        const short = nameOf(n.name),
          fqn = [namespace, short].filter(Boolean).join('\\');
        const d: Declaration = {
          kind: n.kind,
          name: fqn,
          short,
          namespace,
          line: line(n),
          endLine: n.loc?.end?.line ?? line(n),
          abstract: !!n.isAbstract,
          final: !!n.isFinal,
          readonly: !!n.isReadonly,
          extends: (Array.isArray(n.extends)
            ? n.extends
            : n.extends
              ? [n.extends]
              : []
          )
            .map(resolve)
            .filter(Boolean),
          implements: (n.implements ?? []).map(resolve).filter(Boolean),
          traits: [],
          backing: typeText(n.valueType ?? n.type),
          properties: [],
          methods: [],
          cases: [],
          deps: [],
          unresolved: [],
        };
        const ownTraits = new Set<Ast>();
        for (const s of n.body ?? []) {
          if (s.kind === 'traituse') {
            ownTraits.add(s);
            d.traits.push(...s.traits.map(resolve).filter(Boolean));
          }
          if (s.kind === 'propertystatement')
            for (const p of s.properties ?? [])
              d.properties.push({
                name: nameOf(p.name),
                type: display(p.type, p.nullable),
                types: types(p.type),
                visibility: s.visibility || 'public',
                static: !!s.isStatic,
                readonly: !!p.readonly || d.readonly,
                promoted: false,
                line: line(p),
              });
          if (s.kind === 'method') {
            const params = (s.arguments ?? []).map((p: Ast) => {
              if (p.flags || p.flagsSet || p.readonly)
                d.properties.push({
                  name: nameOf(p.name),
                  type: display(p.type, p.nullable),
                  types: types(p.type),
                  visibility:
                    p.flags & 4
                      ? 'private'
                      : p.flags & 2
                        ? 'protected'
                        : 'public',
                  static: false,
                  readonly: !!p.readonly || d.readonly,
                  promoted: true,
                  line: line(p),
                });
              return {
                name: nameOf(p.name),
                type: display(p.type, p.nullable),
                types: types(p.type),
                variadic: !!p.variadic,
                byRef: !!p.byref,
                default: p.value !== null && p.value !== undefined,
              };
            });
            d.methods.push({
              name: nameOf(s.name),
              visibility:
                n.kind === 'interface' ? 'public' : s.visibility || 'public',
              static: !!s.isStatic,
              abstract: n.kind === 'interface' || !!s.isAbstract,
              final: !!s.isFinal,
              params,
              returns: display(s.type, s.nullable),
              returnTypes: types(s.type),
              line: line(s),
            });
          }
          if (s.kind === 'enumcase')
            d.cases.push({ name: nameOf(s.name), line: line(s) });
        }
        d.traits = [...new Set(d.traits)];
        result.declarations.push(d);
        visit(n.attrGroups, d, ownTraits);
        visit(n.body, d, ownTraits);
        return;
      }
      const add = (target: Ast, via: string) => {
        if (!owner) return;
        const name = resolve(target);
        if (name && !owner.deps.some((d) => d.name === name && d.via === via))
          owner.deps.push({ name, via, line: line(target?.loc ? target : n) });
      };
      const dynamic = (target: Ast, via: string) => {
        if (!owner) return;
        if (
          ['selfreference', 'staticreference', 'parentreference'].includes(
            target?.kind,
          )
        )
          return;
        if (target?.kind === 'name' || typeof target === 'string')
          add(target, via);
        else if (target && target.kind !== 'class') {
          owner.unresolved.push({
            via,
            line: line(n),
            expression: code.slice(
              target.loc?.start?.offset ?? 0,
              target.loc?.end?.offset ?? 0,
            ),
          });
        }
      };
      if (owner) {
        if (isClass) {
          if (n.extends) add(n.extends, 'new');
          for (const x of n.implements ?? []) add(x, 'new');
        }
        if (n.kind === 'new') dynamic(n.what, 'new');
        if (n.kind === 'staticlookup' || n.kind === 'staticpropertylookup')
          dynamic(n.what, 'static');
        if (n.kind === 'bin' && n.type === 'instanceof')
          dynamic(n.right, 'instanceof');
        if (n.kind === 'catch') for (const t of n.what ?? []) add(t, 'catch');
        if (n.kind === 'attribute') add(n.name, 'attribute');
        if (
          [
            'parameter',
            'property',
            'method',
            'function',
            'closure',
            'arrowfunc',
            'classconstant',
          ].includes(n.kind)
        )
          for (const t of types(n.type)) add('\\' + t, 'type');
        if (n.kind === 'traituse' && !headerTraits.has(n))
          for (const t of n.traits ?? []) add(t, 'use');
      }
      for (const [k, v] of Object.entries(n))
        if (
          ![
            'loc',
            'errors',
            'comments',
            'leadingComments',
            'trailingComments',
          ].includes(k) &&
          v &&
          typeof v === 'object'
        )
          visit(v, owner, headerTraits);
    }
    children.forEach((n) => visit(n));
  }
  scope(ast.children ?? [], '');
  return result;
}
export function factsToGraph(
  files: FileFacts[],
  policy: Policy,
): AnalysisResult {
  const declarations = new Map<string, Declaration & { file: string }>();
  for (const f of files)
    for (const d of f.declarations)
      if (!declarations.has(d.name.toLowerCase()))
        declarations.set(d.name.toLowerCase(), { ...d, file: f.file });
  const dotted = (n: string) => n.replace(/^\\/, '').replaceAll('\\', '.');
  const namespace = (n: string) => {
    const d = dotted(n),
      p = policy['ns-prefix'] ?? policy.prefix;
    return !p || d === p || d.startsWith(p + '.') ? d : p + '.' + d;
  };
  const idFor = (n: string) => {
    const ns = namespace(n);
    return ns.startsWith(policy.prefix + '.')
      ? ns.slice(policy.prefix.length + 1)
      : ns;
  };
  const ids = new Map([...declarations].map(([k, d]) => [k, idFor(d.name)]));
  const external = new Map<string, string>();
  const resolve = (n: string) => {
    const known = ids.get(n.toLowerCase());
    if (known) return known;
    const key = n.toLowerCase();
    if (!external.has(key)) external.set(key, dotted(n));
    return external.get(key)!;
  };
  const visibility: Record<string, string> = {
    public: '+',
    private: '-',
    protected: '#',
  };
  const nodes: GraphNode[] = [...declarations.values()].map((d) => ({
    id: idFor(d.name),
    name: d.short,
    ns: namespace(d.name),
    lang: 'php',
    kind: d.kind,
    file: d.file,
    line: d.line,
    endLine: d.endLine,
    abstract: d.abstract,
    final: d.final,
    readonly: d.readonly,
    stereotype:
      (
        {
          interface: 'interface',
          trait: 'trait',
          enum: 'enumeration',
        } as Record<string, string>
      )[d.kind] ?? (d.abstract ? 'abstract' : undefined),
    declaration: d,
    fields: [
      ...d.cases.map((c) => ({ ...c, text: c.name })),
      ...d.properties.map((p) => ({
        ...p,
        text: `${visibility[p.visibility] ?? '+'} ${p.name}${p.type ? ' : ' + p.type : ''}${p.static && p.readonly ? ' {static, readOnly}' : p.static ? ' {static}' : p.readonly ? ' {readOnly}' : ''}`,
      })),
    ],
    ops: d.methods.map((m) => ({
      ...m,
      text: `${m.name}(${m.params.map((p: any) => `${p.variadic ? '...' : ''}${p.byRef ? '&' : ''}${p.name}${p.type ? ': ' + p.type : ''}`).join(', ')})${m.returns ? ' : ' + m.returns : ''}`,
      ...(m.visibility !== 'public' ? { private: true } : {}),
    })),
  }));
  const edges = new Map<string, GraphEdge>();
  for (const d of declarations.values()) {
    const from = idFor(d.name);
    function add(
      target: string,
      kind: GraphEdge['kind'],
      via: string,
      ln: number,
      label?: string,
    ) {
      const to = resolve(target);
      if (from === to) return;
      const id = edgeId(from, to, kind, label);
      const source = { file: d.file, line: ln, via };
      const e = edges.get(id);
      if (e) e.sources.push(source);
      else
        edges.set(id, {
          id,
          from,
          to,
          kind,
          sources: [source],
          ...(label ? { label } : {}),
        });
    }
    d.extends.forEach((t) => add(t, 'inheritance', 'extends', d.line));
    d.implements.forEach((t) => add(t, 'implements', 'implements', d.line));
    d.traits.forEach((t) => add(t, 'inheritance', 'use', d.line, 'use'));
    d.deps.forEach((t) => add(t.name, 'dependency', t.via, t.line));
  }
  for (const id of external.values())
    nodes.push({ id, name: id, foreign: true });
  const diagnostics: AnalysisResult['diagnostics'] = files.flatMap((f) =>
    f.errors.map((message) => ({
      file: f.file,
      message,
      severity: 'error' as const,
    })),
  );
  for (const d of declarations.values())
    for (const u of d.unresolved)
      diagnostics.push({
        file: d.file,
        line: u.line,
        message: `Unresolved dynamic ${u.via}: ${u.expression}`,
        severity: 'warning',
      });
  return { nodes, edges: [...edges.values()], diagnostics, facts: { files } };
}
export const phpAdapter: LanguageAdapter = {
  id: 'php',
  extensions: ['.php'],
  analyze(files: SourceFile[], policy: Policy) {
    return factsToGraph(
      files.map((f) => parsePhp(f.file, f.code)),
      policy,
    );
  },
};
