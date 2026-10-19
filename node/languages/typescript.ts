import ts from 'typescript';
import path from 'node:path';
import {
  edgeId,
  type LanguageAdapter,
  type GraphNode,
  type GraphEdge,
} from '../core/model.js';
const title = (s: string) =>
  s
    .split(/[-_]/)
    .map((x) => x[0]?.toUpperCase() + x.slice(1))
    .join('');
/** Module-oriented AST adapter. Imports, interface factories, class implements and invokes share one graph. */
export const typescriptAdapter: LanguageAdapter = {
  id: 'typescript',
  extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
  analyze(files, policy) {
    const id = (file: string) =>
      file.replace(/\.[cm]?[jt]sx?$/, '').replaceAll('/', '.');
    const known = new Map(files.map((f) => [f.file, id(f.file)]));
    const nodes: GraphNode[] = [],
      edges: GraphEdge[] = [],
      diagnostics: any[] = [];
    const resolve = (file: string, target: string) => {
      const base = path.posix.normalize(
        path.posix.join(path.posix.dirname(file), target),
      );
      const found = target.startsWith('.')
        ? [
            base,
            ...[
              '.ts',
              '.tsx',
              '.js',
              '.jsx',
              '.mjs',
              '.cjs',
              '/index.ts',
              '/index.js',
            ].map((x) => base + x),
          ].find((x) => known.has(x))
        : undefined;
      return found ? known.get(found)! : target;
    };
    const asts = new Map(
      files.map((f) => [
        f.file,
        ts.createSourceFile(f.file, f.code, ts.ScriptTarget.Latest, true),
      ]),
    );
    const interfaces = new Map<string, Set<string>>();
    for (const f of files) {
      const set = new Set<string>();
      for (const n of asts.get(f.file)!.statements)
        if (ts.isInterfaceDeclaration(n)) set.add(n.name.text);
      interfaces.set(id(f.file), set);
    }
    const add = (
      from: string,
      to: string,
      kind: GraphEdge['kind'],
      file: string,
      line: number,
    ) => {
      if (from !== to)
        edges.push({
          id: edgeId(from, to, kind),
          from,
          to,
          kind,
          sources: [
            { file, line, via: kind === 'dependency' ? 'import' : 'type' },
          ],
        });
    };
    for (const f of files) {
      const ast = asts.get(f.file)!,
        from = id(f.file),
        ops: any[] = [],
        fields: any[] = [],
        invokes: string[] = [],
        bindings = new Map<string, { module: string; name: string }>();
      const ln = (n: ts.Node) =>
        ast.getLineAndCharacterOfPosition(n.getStart()).line + 1;
      for (const n of ast.statements)
        if (
          ts.isImportDeclaration(n) &&
          ts.isStringLiteral(n.moduleSpecifier)
        ) {
          const module = resolve(f.file, n.moduleSpecifier.text);
          const bind = n.importClause?.namedBindings;
          if (bind && ts.isNamedImports(bind))
            for (const e of bind.elements)
              bindings.set(e.name.text, {
                module,
                name: e.propertyName?.text ?? e.name.text,
              });
        }
      const implemented = (name: string, n: ts.Node) => {
        const binding = bindings.get(name);
        if (binding && interfaces.get(binding.module)?.has(binding.name))
          add(from, binding.module, 'implements', f.file, ln(n));
      };
      function visit(n: ts.Node) {
        const exported =
          ts.canHaveModifiers(n) &&
          ts
            .getModifiers(n)
            ?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
        if (
          exported &&
          (ts.isFunctionDeclaration(n) ||
            ts.isClassDeclaration(n) ||
            ts.isEnumDeclaration(n)) &&
          n.name
        ) {
          ops.push({
            name: n.name.text,
            text: n.getText(ast).split('{')[0].trim(),
            line: ln(n),
          });
          if (
            ts.isFunctionDeclaration(n) &&
            n.type &&
            ts.isTypeReferenceNode(n.type)
          )
            implemented(n.type.typeName.getText(ast), n);
          if (ts.isClassDeclaration(n))
            for (const c of n.heritageClauses ?? [])
              for (const t of c.types)
                if (c.token === ts.SyntaxKind.ImplementsKeyword)
                  implemented(t.expression.getText(ast), n);
        }
        if (ts.isVariableStatement(n) && exported)
          for (const d of n.declarationList.declarations)
            if (ts.isIdentifier(d.name)) {
              fields.push({
                name: d.name.text,
                text: d.name.text + (d.type ? ': ' + d.type.getText(ast) : ''),
                line: ln(d),
              });
              if (
                d.initializer &&
                (ts.isArrowFunction(d.initializer) ||
                  ts.isFunctionExpression(d.initializer))
              )
                ops.push({ name: d.name.text, text: d.name.text, line: ln(d) });
              if (d.type && ts.isTypeReferenceNode(d.type))
                implemented(d.type.typeName.getText(ast), d);
            }
        if (
          ts.isExportDeclaration(n) &&
          !n.isTypeOnly &&
          n.exportClause &&
          ts.isNamedExports(n.exportClause)
        )
          for (const e of n.exportClause.elements)
            if (!e.isTypeOnly)
              ops.push({ name: e.name.text, text: e.name.text, line: ln(e) });
        let target: string | undefined;
        if (
          (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) &&
          n.moduleSpecifier &&
          ts.isStringLiteral(n.moduleSpecifier)
        )
          target = n.moduleSpecifier.text;
        if (
          ts.isCallExpression(n) &&
          n.arguments[0] &&
          ts.isStringLiteral(n.arguments[0])
        ) {
          if (
            n.expression.getText(ast) === 'require' ||
            n.expression.kind === ts.SyntaxKind.ImportKeyword
          )
            target = n.arguments[0].text;
          if (/(?:^|\.)invoke$/.test(n.expression.getText(ast)))
            invokes.push(n.arguments[0].text);
        }
        if (target)
          add(from, resolve(f.file, target), 'dependency', f.file, ln(n));
        ts.forEachChild(n, visit);
      }
      visit(ast);
      for (const d of (ast as any).parseDiagnostics ?? [])
        diagnostics.push({
          file: f.file,
          line: ast.getLineAndCharacterOfPosition(d.start ?? 0).line + 1,
          message: ts.flattenDiagnosticMessageText(d.messageText, ' '),
          severity: 'error',
        });
      nodes.push({
        id: from,
        name: title(path.posix.basename(f.file).replace(/\.[cm]?[jt]sx?$/, '')),
        ns: [policy['ns-prefix'] ?? policy.prefix, from]
          .filter(Boolean)
          .join('.'),
        file: f.file,
        line: 1,
        lang: 'typescript',
        kind: 'module',
        ops,
        fields,
        invokes,
      });
    }
    for (const target of new Set(edges.map((e) => e.to)))
      if (!nodes.some((n) => n.id === target))
        nodes.push({ id: target, name: target, foreign: true });
    return {
      nodes,
      edges: [...new Map(edges.map((e) => [e.id, e])).values()],
      diagnostics,
    };
  },
};
