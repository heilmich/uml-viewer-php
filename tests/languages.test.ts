import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pythonAdapter,
  rustAdapter,
  clojureAdapter,
} from '../node/languages/modules.js';
import { typescriptAdapter } from '../node/languages/typescript.js';
import { policySchema } from '../node/core/model.js';
const files = (o: Record<string, string>) =>
  Object.entries(o).map(([file, code]) => ({ file, code }));
const has = (g: any, f: string, t: string, k = 'dependency') =>
  g.edges.some((e: any) => e.from === f && e.to === t && e.kind === k);
test('TypeScript/JavaScript imports, interface factories, named exports, invoke names; strings and regex are inert', () => {
  const g = typescriptAdapter.analyze(
    files({
      'model.ts': 'export function wordCount(s:string):number {return 0}',
      'book.ts':
        'import {wordCount} from "./model"; export interface Fs {} export async function loadBook(fs: Fs):Promise<string>{return ""}',
      'nodeFs.ts':
        'import type {Fs} from "./book"; export function nodeFs():Fs{return null!} const fake="import x from \'nope\'"; const regex=/"/g; invoke<string>("read_text")',
    }),
    policySchema.parse({ prefix: 'bookwriter' }),
  );
  assert.equal(g.diagnostics.length, 0);
  assert(has(g, 'book', 'model'));
  assert(has(g, 'nodeFs', 'book', 'implements'));
  assert.deepEqual(g.nodes.find((n) => n.id === 'nodeFs')?.invokes, [
    'read_text',
  ]);
  assert.equal(g.nodes.find((n) => n.id === 'nodeFs')?.name, 'NodeFs');
  assert(!g.nodes.some((n) => n.id === 'nope'));
});
test('Python relative imports, inheritance, protocol modules, factories; no import execution', () => {
  const g = pythonAdapter.analyze(
    files({
      'app/__init__.py': 'from .model import Animal, walk\n',
      'app/model.py':
        'class Animal:\n def speak(self): return "woof"\ndef walk(animal): return animal\ndef _hidden(): pass\n',
      'app/dogs/__init__.py':
        'from ..model import Animal\nfrom .kennel import Kennel\nclass Pack(Animal): pass\n',
      'app/dogs/kennel.py':
        'from ..model import Animal\nimport os.path\nclass Kennel(Animal): pass\n',
      'app/service.py':
        'from .model import Animal\ndef load() -> Animal:\n return Animal()\n',
      'app/fs.py': 'from typing import Protocol\nclass Fs(Protocol): pass\n',
    }),
    policySchema.parse({ prefix: 'app' }),
  );
  assert.deepEqual(g.diagnostics, []);
  assert(has(g, 'app', 'model'));
  assert(has(g, 'dogs.kennel', 'model', 'inheritance'));
  assert(has(g, 'service', 'model', 'implements'));
  assert.equal(g.nodes.find((n) => n.id === 'fs')?.stereotype, 'interface');
  assert.deepEqual(
    g.nodes.find((n) => n.id === 'model')?.ops?.map((x) => x.name),
    ['Animal', 'walk'],
  );
});
test('Rust reachable modules, directory mod.rs, traits, impl paths and tauri commands', () => {
  const g = rustAdapter.analyze(
    files({
      'lib.rs':
        'use tauri::Manager; mod proto; mod rec; #[tauri::command] fn read_text() {} pub fn run(){}',
      'proto/mod.rs': 'pub trait Q {}',
      'rec.rs': 'use crate::proto::Q; struct S; impl Q for S {}',
      'main.rs': 'fn main(){bookwriter_lib::run();}',
      'ignored.rs': 'pub fn nope(){}',
    }),
    policySchema.parse({
      prefix: 'bookwriter',
      'ns-prefix': 'bookwriter.rust',
    }),
  );
  assert.deepEqual(g.diagnostics, []);
  assert(has(g, 'rust', 'rust.proto'));
  assert(has(g, 'rust.rec', 'rust.proto', 'implements'));
  assert(has(g, 'rust.main', 'rust'));
  assert(!g.nodes.some((n) => n.id === 'rust.ignored'));
  assert.deepEqual(g.nodes.find((n) => n.id === 'rust')?.commands, [
    'read_text',
  ]);
});
test('Clojure namespace imports, prefix libspecs, protocols, record implements and requiring-resolve without JVM', () => {
  const g = clojureAdapter.analyze(
    files({
      'a.clj':
        "(ns demo.a (:require [demo.b :as b] [clojure.string :as str] [demo [c :as c]]) (:import [javax.swing JFrame] java.io.File)) (defrecord R [] b/Q) (defn go [] ((requiring-resolve 'demo.b/run)) @(clojure.core/requiring-resolve 'quil.core/width))",
      'b.cljc': '(ns demo.b) (defprotocol Q)',
      'c.cljs': '(ns demo.c)',
    }),
    policySchema.parse({ prefix: 'demo' }),
  );
  assert.deepEqual(g.diagnostics, []);
  for (const t of [
    'b',
    'c',
    'clojure.string',
    'javax.swing',
    'java.io',
    'quil.core',
  ])
    assert(has(g, 'a', t), t);
  assert(has(g, 'a', 'b', 'implements'));
  assert.equal(g.nodes.find((n) => n.id === 'b')?.stereotype, 'interface');
});
test('polyglot scanning connects unambiguous literal frontend invokes to Rust command owners', async () => {
  const { polyglotAdapter } = await import('../node/languages/polyglot.js');
  const g = polyglotAdapter.analyze(
    files({
      'frontend.ts': 'export function run(){invoke("read_text")}',
      'lib.rs': '#[tauri::command] fn read_text(){}',
    }),
    policySchema.parse({ prefix: 'demo' }),
  );
  assert(has(g, 'typescript.frontend', 'rust.rust'));
  assert.equal(
    g.edges.find((e) => e.label === 'read_text')?.sources[0].via,
    'invoke',
  );
});
