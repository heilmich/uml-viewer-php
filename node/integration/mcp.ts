import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { Project, Conflict } from '../service/project.js';
export function createMcp(project: Project) {
  const server = new McpServer({ name: 'uml-viewer', version: '0.1.0' });
  const base = { projectId: z.string(), snapshotId: z.string() };
  const result = (value: unknown) => ({
    content: [{ type: 'text' as const, text: JSON.stringify(value) }],
  });
  async function guard<T>(
    input: { projectId: string; snapshotId?: string },
    fn: () => Promise<T>,
  ) {
    try {
      if (input.projectId !== project.id) throw Error('Project mismatch');
      if (input.snapshotId) await project.snapshot(input.snapshotId);
      return result(await fn());
    } catch (e) {
      return {
        ...result(
          e instanceof Conflict
            ? { error: 'conflict', current: e.current }
            : { error: (e as Error).message },
        ),
        isError: true,
      };
    }
  }
  server.registerTool(
    'project_info',
    {
      description:
        'Discover the explicitly registered project and current snapshot IDs.',
      inputSchema: {},
    },
    async () => {
      let snapshotId: string | null = null;
      try {
        snapshotId = (await project.snapshot()).id;
      } catch {}
      return result({ projectId: project.id, root: project.root, snapshotId });
    },
  );
  server.registerTool(
    'get_graph',
    {
      description: 'Read one project snapshot with metadata.',
      inputSchema: base,
    },
    async (input) => guard(input, () => project.snapshot(input.snapshotId)),
  );
  server.registerTool(
    'scan',
    {
      description:
        'Statically scan the registered project. Does not execute project code.',
      inputSchema: { projectId: z.string(), snapshotId: z.string().optional() },
    },
    async (input) => guard(input, () => project.scan()),
  );
  server.registerTool(
    'get_element',
    {
      description: 'Read an element and optionally its plain-text source.',
      inputSchema: {
        ...base,
        elementId: z.string(),
        includeSource: z.boolean().default(false),
      },
    },
    async (input) =>
      guard(input, async () => {
        const snapshot = await project.snapshot(input.snapshotId);
        const element = snapshot.nodes.find((n) => n.id === input.elementId);
        if (!element) throw Error('Unknown element');
        return {
          element,
          source:
            input.includeSource && element.file
              ? await project.source(element.file)
              : undefined,
        };
      }),
  );
  server.registerTool(
    'get_proposals',
    {
      description: 'Read independently persisted architecture proposals.',
      inputSchema: base,
    },
    async (input) => guard(input, () => project.proposals()),
  );
  server.registerTool(
    'update_proposal',
    {
      description:
        'Create (version 0) or update a proposal with optimistic concurrency control.',
      inputSchema: {
        ...base,
        id: z.string(),
        expectedVersion: z.number().int().nonnegative(),
        proposal: z.object({
          name: z.string(),
          layers: z.array(z.any()),
          omit: z.array(z.string()).optional(),
        }),
      },
    },
    async (input) =>
      guard(input, () =>
        project.updateProposal(input.id, input.expectedVersion, input.proposal),
      ),
  );
  server.registerTool(
    'delete_proposal',
    {
      description: 'Delete a proposal only at the expected version.',
      inputSchema: {
        ...base,
        id: z.string(),
        expectedVersion: z.number().int().positive(),
      },
    },
    async (input) =>
      guard(input, () =>
        project.deleteProposal(input.id, input.expectedVersion),
      ),
  );
  server.registerTool(
    'get_context',
    {
      description:
        'Read context explicitly shared with one session. Viewer clicks do not implicitly share context.',
      inputSchema: { ...base, sessionId: z.string() },
    },
    async (input) =>
      guard(input, async () => {
        const context = await project.context(input.sessionId);
        if (context && context.snapshotId !== input.snapshotId)
          return { context, stale: true };
        return { context, stale: false };
      }),
  );
  server.registerTool(
    'set_context',
    {
      description: 'Explicitly share context with one named session.',
      inputSchema: {
        ...base,
        sessionId: z.string(),
        selection: z.array(z.string()),
        proposalId: z.string().nullable(),
        discussion: z.string().default(''),
      },
    },
    async (input) =>
      guard(input, () => project.context(input.sessionId, input)),
  );
  return server;
}
export async function runMcp(project: Project) {
  const server = createMcp(project);
  await server.connect(new StdioServerTransport());
  return server;
}
