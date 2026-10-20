import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, mkdir, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Project } from '../node/service/project.js';
import { readEdn } from '../node/core/edn.js';
import { parsePhp, factsToGraph } from '../node/languages/php.js';
import { policySchema } from '../node/core/model.js';
const policy = policySchema.parse({ prefix: 'App' });
test('php-shop graph matches the committed legacy IR semantic fixture', async () => {
  const project = await Project.open('examples/php-shop/src');
  const p = readEdn(await readFile('examples/php-shop.policy.edn', 'utf8'));
  const graph = await project.scan({ policy: p, save: false });
  const legacy: any = readEdn(
    await readFile('tests/fixtures/php-shop.legacy.edn', 'utf8'),
  );
  assert.equal(graph.metadata.complete, true);
  assert.equal(graph.metadata.fileCount, 25);
  assert.deepEqual(
    graph.nodes.map((n) => n.id).sort(),
    legacy.classes.map((n: any) => n.id).sort(),
  );
  const edge = (e: any) =>
    JSON.stringify([e.from, e.to, e.kind, e.label ?? null, !!e.violating]);
  assert.deepEqual(graph.edges.map(edge).sort(), legacy.edges.map(edge).sort());
  assert.equal(graph.edges.filter((e) => e.violating).length, 1);
  assert.equal(
    graph.edges.find((e) => e.violating)?.from,
    'Domain.Model.Order',
  );
  for (const n of legacy.classes.filter((n: any) => !n.foreign)) {
    const actual = graph.nodes.find((x) => x.id === n.id)!;
    assert.deepEqual(
      actual.fields?.map((x) => x.text) ?? [],
      n.fields?.map((x: any) => x.text) ?? [],
    );
    assert.deepEqual(
      actual.ops?.map((x) => x.text) ?? [],
      n.ops?.map((x: any) => x.text) ?? [],
    );
  }
});
const complex = String.raw`<?php
namespace App\Domain;
use App\Domain\Shared\{HasName, Clock as Time};
use App\Attr\Audit;
#[Audit]
final class User extends Entity implements Identified {
 use HasName;
 private ?Email $email = null;
 public static int $count = 0;
 public const ?Level DEFAULT = null;
 public function __construct(public readonly UserId $id, private Role|Guest $role) {}
 public function rename(string $name, Tag ...$tags): static {
  $at = Time::now();
  try { $x = new Name($name); } catch (InvalidName | \LogicException $e) {}
  if ($at instanceof Moment) {}
  $f = fn (Callback $c): Result => $c;
  $o = new class extends Listener { use Helps; private Gadget $g; public function ping(): Pong { return new Pong(); } };
  $k = [Registry::class, Counter::$hits];
  $u = new self($this->id, $this->role); return $this;
 }
 private function secret(): void {}
}
`;
test('ported legacy PHP fixture: aliases, group use, attributes, anonymous classes, typed constants, promoted properties', () => {
  const facts = parsePhp('User.php', complex);
  assert.deepEqual(facts.errors, []);
  const d = facts.declarations[0];
  assert.equal(d.final, true);
  const deps = d.deps.map((x) => x.name.replaceAll('\\', '.')).sort();
  const expected = [
    'App.Domain.Email',
    'App.Domain.UserId',
    'App.Domain.Role',
    'App.Domain.Guest',
    'App.Domain.Tag',
    'App.Domain.Shared.Clock',
    'App.Domain.Name',
    'App.Domain.InvalidName',
    'LogicException',
    'App.Domain.Moment',
    'App.Domain.Callback',
    'App.Domain.Result',
    'App.Domain.Listener',
    'App.Attr.Audit',
    'App.Domain.Level',
    'App.Domain.Helps',
    'App.Domain.Gadget',
    'App.Domain.Pong',
    'App.Domain.Registry',
    'App.Domain.Counter',
  ];
  assert.deepEqual([...new Set(deps)].sort(), expected.sort());
  assert.equal(d.unresolved.length, 0);
  const user = factsToGraph([facts], policy).nodes.find(
    (n) => n.id === 'Domain.User',
  )!;
  assert.deepEqual(
    user.fields?.map((x) => x.text),
    [
      '- email : ?Email',
      '+ count : int {static}',
      '+ id : UserId {readOnly}',
      '- role : Role|Guest',
    ],
  );
  assert.deepEqual(
    user.ops?.map((x) => x.text),
    [
      '__construct(id: UserId, role: Role|Guest)',
      'rename(name: string, ...tags: Tag) : static',
      'secret() : void',
    ],
  );
});
test('multiple namespaces, case-insensitive names, interface inheritance, traits, enums, nullable/union/intersection', () => {
  const f = parsePhp(
    'many.php',
    String.raw`<?php
namespace App\One { interface A {} interface B extends A {} trait T {} readonly class R { public function __construct(public (A&B)|null $x){} } }
namespace App\Two { use App\One\{A as Alias, B, T}; enum Role: string implements B { use T; case Admin='a'; public function x(?Alias $a): Alias&B { return $a; } } class C extends \app\one\r { public \APP\ONE\A $p; } }
`,
  );
  assert.deepEqual(f.errors, []);
  const g = factsToGraph([f], policy);
  assert.equal(g.nodes.filter((n) => !n.foreign).length, 6);
  assert.equal(g.nodes.filter((n) => n.foreign).length, 0);
  assert(
    g.edges.some(
      (e) => e.from === 'Two.C' && e.to === 'One.R' && e.kind === 'inheritance',
    ),
  );
  assert(
    g.edges.some(
      (e) => e.from === 'One.B' && e.to === 'One.A' && e.kind === 'inheritance',
    ),
  );
  assert.deepEqual(
    f.declarations.find((d) => d.short === 'Role')?.cases.map((c) => c.name),
    ['Admin'],
  );
  assert.equal(
    f.declarations.find((d) => d.short === 'R')?.properties[0].type,
    '(A&B)|null',
  );
  assert.equal(
    f.declarations.find((d) => d.short === 'R')?.properties[0].readonly,
    true,
  );
});
test('duplicate declarations keep first; dynamic dependencies remain unresolved; builtins never become nodes', () => {
  const a = parsePhp(
    'a.php',
    '<?php class Dup {function a(self $s, int $i): static {new self(); parent::x(); $x=new $class(); $class::x();}}',
  );
  const b = parsePhp('b.php', '<?php class dup {}');
  const g = factsToGraph([a, b], policy);
  assert.equal(g.nodes.length, 1);
  assert.equal(g.nodes[0].file, 'a.php');
  assert.equal(a.declarations[0].unresolved.length, 2);
  assert.equal(g.edges.length, 0);
});
test('syntax errors mark snapshot incomplete, exclusions skip vendor, tests and symlinks; no project code is executed', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'uml-php-'));
  await writeFile(
    path.join(root, 'A.php'),
    `<?php class A {} file_put_contents('${root}/EXECUTED','bad');`,
  );
  await writeFile(
    path.join(root, 'Broken.php'),
    '<?php class Broken { function x( }',
  );
  for (const dir of ['vendor', 'tests', 'dist']) {
    await mkdir(path.join(root, dir));
    await writeFile(path.join(root, dir, 'Hidden.php'), '<?php class Hidden{}');
  }
  await writeFile(path.join(root, 'ATest.php'), '<?php class ATest {}');
  await symlink('/etc', path.join(root, 'outside'));
  const g = await (await Project.open(root)).scan({ save: false });
  assert.equal(g.metadata.fileCount, 2);
  assert.equal(g.metadata.complete, false);
  assert(g.diagnostics.some((d) => d.severity === 'error'));
  assert.equal(g.nodes.filter((n) => !n.foreign).length, 1);
  await assert.rejects(readFile(path.join(root, 'EXECUTED')));
});
test('PHP 8.4 asymmetric promoted visibility and alias type display', () => {
  const f = parsePhp(
    'modern.php',
    String.raw`<?php namespace App; use Other\Actual as Alias; class A {function __construct(public private(set) Alias $a){} function f(Alias $x): Alias {} }`,
  );
  assert.deepEqual(f.errors, []);
  assert.equal(f.declarations[0].properties[0].promoted, true);
  assert.equal(f.declarations[0].properties[0].type, 'Actual');
  assert.equal(f.declarations[0].methods[1].returns, 'Actual');
});
test('implicit PHP method visibility is public', () => {
  const f = parsePhp('a.php', '<?php class A {function run(){}}');
  assert.equal(f.declarations[0].methods[0].visibility, 'public');
  assert.equal(factsToGraph([f], policy).nodes[0].ops?.[0].private, undefined);
});
