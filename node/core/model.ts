import { z } from 'zod';
export const relationKinds = [
  'dependency',
  'inheritance',
  'implements',
  'association',
  'aggregation',
  'composition',
] as const;
export const memberSchema = z
  .object({
    name: z.string(),
    text: z.string().optional(),
    line: z.number().optional(),
  })
  .passthrough();
export const nodeSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    ns: z.string().optional(),
    lang: z.string().optional(),
    kind: z.string().optional(),
    file: z.string().optional(),
    line: z.number().optional(),
    endLine: z.number().optional(),
    foreign: z.boolean().optional(),
    fields: z.array(memberSchema).optional(),
    ops: z.array(memberSchema).optional(),
    metrics: z.record(z.unknown()).optional(),
  })
  .passthrough();
export const edgeSchema = z.object({
  id: z.string(),
  from: z.string(),
  to: z.string(),
  kind: z.enum(relationKinds),
  label: z.string().optional(),
  violating: z.boolean().optional(),
  sources: z
    .array(z.object({ file: z.string(), line: z.number(), via: z.string() }))
    .default([]),
});
export const policySchema = z
  .object({
    prefix: z.string().default('App'),
    'ns-prefix': z.string().optional(),
    foreign: z.array(z.string()).optional(),
    levels: z
      .array(
        z.union([z.array(z.string()), z.object({ nses: z.array(z.string()) })]),
      )
      .default([]),
    omit: z.array(z.string()).default([]),
    order: z
      .union([z.array(z.string()), z.record(z.array(z.string()))])
      .default([]),
    'edge-kinds': z.record(z.enum(relationKinds)).default({}),
    'omit-edges': z.array(z.array(z.string())).default([]),
    excludes: z.array(z.string()).default([]),
  })
  .passthrough();
export const snapshotSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string(),
  project: z.object({ id: z.string(), root: z.string(), name: z.string() }),
  metadata: z.object({
    analyzerVersion: z.string(),
    createdAt: z.string(),
    commit: z.string().nullable(),
    fingerprint: z.string(),
    language: z.string(),
    durationMs: z.number(),
    complete: z.boolean(),
    fileCount: z.number(),
  }),
  nodes: z.array(nodeSchema),
  edges: z.array(edgeSchema),
  diagnostics: z.array(
    z.object({
      file: z.string(),
      line: z.number().optional(),
      message: z.string(),
      severity: z.enum(['error', 'warning']),
    }),
  ),
  policy: policySchema,
});
export type GraphNode = z.infer<typeof nodeSchema>;
export type GraphEdge = z.infer<typeof edgeSchema>;
export type Snapshot = z.infer<typeof snapshotSchema>;
export type Policy = z.infer<typeof policySchema>;
export interface Group {
  id: string;
  label: string;
  nses: (string | Group)[];
}
export interface Layer {
  id: string;
  label: string;
  nses: (string | Group)[];
}
export const groupSchema: z.ZodType<Group> = z.lazy(() =>
  z.object({
    id: z.string(),
    label: z.string(),
    nses: z.array(z.union([z.string(), groupSchema])),
  }),
);
export const proposalSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string(),
  name: z.string().min(1),
  version: z.number().int().positive(),
  notice: z.string().default('PROPOSAL — not instantiated in code'),
  layers: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      nses: z.array(z.union([z.string(), groupSchema])),
    }),
  ),
  omit: z.array(z.string()).default([]),
});
export type Proposal = z.infer<typeof proposalSchema>;
export interface ViewState {
  path: string;
  zoom: number;
  x: number;
  y: number;
  proposalId: string | null;
  selectedId?: string;
}
export interface SourceFile {
  file: string;
  code: string;
}
export interface AnalysisResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  diagnostics: Snapshot['diagnostics'];
  facts?: unknown;
}
export interface LanguageAdapter {
  id: string;
  extensions: string[];
  analyze(files: SourceFile[], policy: Policy): AnalysisResult;
}
export const matches = (id: string, prefix: string) =>
  id === prefix || id.startsWith(prefix + '.');
export function stableId(...parts: string[]): string {
  return parts.map((x) => encodeURIComponent(x)).join(':');
}
export function edgeId(from: string, to: string, kind: string, label = '') {
  return stableId(from, to, kind, label);
}
