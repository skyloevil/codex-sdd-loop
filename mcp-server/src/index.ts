import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import {
  archiveChange,
  cancelChange,
  createChange,
  createDesign,
  createOrUpdateArtifact,
  createProposal,
  createTasks,
  detectLayout,
  formatToolResponse,
  getNextActions,
  getPendingHooks,
  initProject,
  listArchives,
  listChanges,
  readArtifact,
  recordHookResult,
  setGate,
  summarizeNext,
  updateTaskStatus,
  validateDrift,
} from './openspec.js';
import { readState, resolveProjectRoot } from './state.js';
import type { ArtifactId, GateMode, HookKind, HookStatus, Preset, ResponseFormat } from './types.js';

const server = new Server(
  {
    name: 'openspec-assistant',
    version: '0.3.0',
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

const responseFormatSchema = {
  type: 'string',
  enum: ['json', 'markdown'],
  description: 'Output format: json for structured data, markdown for readable summaries.',
};

const workDirSchema = {
  type: 'string',
  description: 'Project working directory. Defaults to the MCP server current working directory.',
};

const TOOL_DEFINITIONS = [
  {
    name: 'openspec_detect_layout',
    description: 'Scan the project for OpenSpec Assistant dirs, changes, files, and state.',
    inputSchema: { type: 'object', properties: { workDir: workDirSchema, response_format: responseFormatSchema } },
  },
  {
    name: 'openspec_get_status',
    description: 'Get active change status, gates, paths, next action, and full v2 state summary.',
    inputSchema: { type: 'object', properties: { workDir: workDirSchema, response_format: responseFormatSchema } },
  },
  {
    name: 'openspec_list_changes',
    description: 'List all tracked OpenSpec changes, including archived changes.',
    inputSchema: { type: 'object', properties: { workDir: workDirSchema, response_format: responseFormatSchema } },
  },
  {
    name: 'openspec_get_next_actions',
    description: 'Return the next workflow actions derived from artifact state, gates, and task progress.',
    inputSchema: { type: 'object', properties: { workDir: workDirSchema, response_format: responseFormatSchema } },
  },
  {
    name: 'openspec_read_artifact',
    description: 'Read one active change artifact by artifact id.',
    inputSchema: {
      type: 'object',
      required: ['artifactId'],
      properties: {
        workDir: workDirSchema,
        artifactId: { type: 'string', enum: ['proposal', 'specs', 'design', 'tasks', 'verification', 'implementation_notes'] },
        changeId: { type: 'string' },
        response_format: responseFormatSchema,
      },
    },
  },
  {
    name: 'openspec_validate',
    description: 'Validate artifact existence, task completion, and required hook completion.',
    inputSchema: { type: 'object', properties: { workDir: workDirSchema, response_format: responseFormatSchema } },
  },
  {
    name: 'openspec_init_project',
    description: 'Initialize openspec/config.yaml, default schema/templates, changes directory, and state file.',
    inputSchema: {
      type: 'object',
      properties: {
        workDir: workDirSchema,
        schema: { type: 'string', description: 'Default schema name. Defaults to spec-driven.' },
        overwrite: { type: 'boolean', description: 'Overwrite existing openspec/config.yaml if true.' },
        response_format: responseFormatSchema,
      },
    },
  },
  {
    name: 'openspec_create_change',
    description: 'Create openspec/changes/<changeId>/ artifacts and make it the active change.',
    inputSchema: {
      type: 'object',
      required: ['description'],
      properties: {
        workDir: workDirSchema,
        description: { type: 'string' },
        background: { type: 'string' },
        outOfScope: { type: 'string' },
        preset: { type: 'string', enum: ['full', 'hotfix', 'tweak'] },
        schema: { type: 'string' },
        response_format: responseFormatSchema,
      },
    },
  },
  {
    name: 'openspec_create_or_update_artifact',
    description: 'Create or replace an artifact file inside the active change directory.',
    inputSchema: {
      type: 'object',
      required: ['artifactId', 'content'],
      properties: {
        workDir: workDirSchema,
        artifactId: { type: 'string', enum: ['proposal', 'specs', 'design', 'tasks', 'verification', 'implementation_notes'] },
        content: { type: 'string' },
        changeId: { type: 'string' },
        response_format: responseFormatSchema,
      },
    },
  },
  {
    name: 'openspec_update_task',
    description: 'Mark a task checkbox as complete or reopened in tasks.md.',
    inputSchema: {
      type: 'object',
      required: ['taskId', 'done'],
      properties: {
        workDir: workDirSchema,
        taskId: { type: 'string', description: 'Task id such as T1 or T2.' },
        done: { type: 'boolean' },
        response_format: responseFormatSchema,
      },
    },
  },
  {
    name: 'openspec_set_gate',
    description: 'Record human confirmation for a workflow gate such as scope, design, validation, or archive.',
    inputSchema: {
      type: 'object',
      required: ['gate', 'confirmed'],
      properties: {
        workDir: workDirSchema,
        gate: { type: 'string', enum: ['scope', 'design', 'validation', 'archive'] },
        confirmed: { type: 'boolean' },
        changeId: { type: 'string' },
        response_format: responseFormatSchema,
      },
    },
  },
  {
    name: 'openspec_archive_change',
    description: 'Archive the active change and write knowledge-base metadata. Required pre_archive hooks must be passed unless force is true.',
    inputSchema: {
      type: 'object',
      properties: {
        workDir: workDirSchema,
        message: { type: 'string' },
        changeId: { type: 'string' },
        force: { type: 'boolean' },
        response_format: responseFormatSchema,
      },
    },
  },
  {
    name: 'openspec_cancel_change',
    description: 'Cancel the active change and clear activeChangeId without deleting artifacts.',
    inputSchema: { type: 'object', properties: { workDir: workDirSchema, response_format: responseFormatSchema } },
  },
  {
    name: 'openspec_get_pending_hooks',
    description: 'Return hooks configured for a hook point and whether required hooks block progress.',
    inputSchema: {
      type: 'object',
      required: ['hookPoint'],
      properties: {
        workDir: workDirSchema,
        hookPoint: { type: 'string', description: 'Hook point such as pre_proposal, post_task, or pre_archive.' },
        changeId: { type: 'string' },
        response_format: responseFormatSchema,
      },
    },
  },
  {
    name: 'openspec_record_hook_result',
    description: 'Record the result of a custom MCP, command, or skill hook in state and verification evidence.',
    inputSchema: {
      type: 'object',
      required: ['hookPoint', 'hookName', 'status'],
      properties: {
        workDir: workDirSchema,
        hookPoint: { type: 'string' },
        hookName: { type: 'string' },
        status: { type: 'string', enum: ['pending', 'passed', 'failed', 'skipped'] },
        message: { type: 'string' },
        changeId: { type: 'string' },
        response_format: responseFormatSchema,
      },
    },
  },
  {
    name: 'list_archives',
    description: 'Deprecated alias: list archived knowledge-base entries.',
    inputSchema: { type: 'object', properties: { workDir: workDirSchema, response_format: responseFormatSchema } },
  },
  ...deprecatedAliases(),
];

function deprecatedAliases() {
  return [
    ['detect_spec_layout', 'Deprecated alias for openspec_detect_layout.'],
    ['create_proposal', 'Deprecated alias for openspec_create_change with preset=full.'],
    ['create_design', 'Deprecated alias for openspec_create_or_update_artifact artifactId=design.'],
    ['create_tasks', 'Deprecated alias for openspec_create_or_update_artifact artifactId=tasks.'],
    ['update_task', 'Deprecated alias for openspec_update_task.'],
    ['get_status', 'Deprecated alias for openspec_get_status.'],
    ['summarize_next', 'Deprecated alias for openspec_get_next_actions.'],
    ['validate_drift', 'Deprecated alias for openspec_validate.'],
    ['archive_change', 'Deprecated alias for openspec_archive_change.'],
    ['cancel_change', 'Deprecated alias for openspec_cancel_change.'],
  ].map(([name, description]) => ({
    name,
    description,
    inputSchema: { type: 'object', properties: {} },
  }));
}

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOL_DEFINITIONS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: rawArgs } = request.params;
  const args = (rawArgs || {}) as Record<string, unknown>;
  const projectRoot = resolveProjectRoot((args.workDir as string | undefined) || process.cwd());
  const responseFormat = (args.response_format as ResponseFormat | undefined) || 'json';

  try {
    const data = dispatchTool(name, args, projectRoot);
    return {
      content: [{ type: 'text', text: formatToolResponse(data, responseFormat) }],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Error: ${message}` }],
      isError: true,
    };
  }
});

function dispatchTool(name: string, args: Record<string, unknown>, projectRoot: string): unknown {
  switch (name) {
    case 'openspec_detect_layout':
    case 'detect_spec_layout':
      return detectLayout(projectRoot);
    case 'openspec_get_status':
    case 'get_status':
      return { state: readState(projectRoot), summary: summarizeNext(projectRoot) };
    case 'openspec_list_changes':
      return listChanges(projectRoot);
    case 'openspec_get_next_actions':
    case 'summarize_next':
      return getNextActions(projectRoot);
    case 'openspec_read_artifact':
      return readArtifact(projectRoot, {
        artifactId: args.artifactId as ArtifactId,
        changeId: args.changeId as string | undefined,
      });
    case 'openspec_validate':
    case 'validate_drift':
      return validateDrift(projectRoot);
    case 'openspec_init_project':
      return initProject(projectRoot, {
        schema: args.schema as string | undefined,
        overwrite: args.overwrite as boolean | undefined,
      });
    case 'openspec_create_change':
      return createChange(projectRoot, {
        description: args.description as string,
        background: args.background as string | undefined,
        outOfScope: args.outOfScope as string | undefined,
        preset: args.preset as Preset | undefined,
        schema: args.schema as string | undefined,
      });
    case 'create_proposal':
      return createProposal(projectRoot, args.description as string, args.background as string | undefined, args.outOfScope as string | undefined);
    case 'openspec_create_or_update_artifact':
      return createOrUpdateArtifact(projectRoot, {
        artifactId: args.artifactId as ArtifactId,
        content: args.content as string,
        changeId: args.changeId as string | undefined,
      });
    case 'create_design':
      return createDesign(projectRoot, args.content as string | undefined);
    case 'create_tasks':
      return createTasks(projectRoot, args.taskDescriptions ? (args.taskDescriptions as string[]).map((description, index) => ({
        id: `T${index + 1}`,
        description,
        done: false,
        priority: 'medium' as const,
      })) : undefined);
    case 'openspec_update_task':
    case 'update_task':
      return updateTaskStatus(projectRoot, {
        taskId: args.taskId as string,
        done: args.done as boolean,
      });
    case 'openspec_set_gate':
      return setGate(projectRoot, {
        gate: args.gate as 'scope' | 'design' | 'validation' | 'archive',
        confirmed: args.confirmed as boolean,
        changeId: args.changeId as string | undefined,
      });
    case 'openspec_archive_change':
    case 'archive_change':
      return archiveChange(projectRoot, {
        message: args.message as string | undefined,
        changeId: args.changeId as string | undefined,
        force: args.force as boolean | undefined,
      });
    case 'openspec_cancel_change':
    case 'cancel_change':
      return cancelChange(projectRoot);
    case 'openspec_get_pending_hooks':
      return getPendingHooks(projectRoot, {
        hookPoint: args.hookPoint as string,
        changeId: args.changeId as string | undefined,
      });
    case 'openspec_record_hook_result':
      return recordHookResult(projectRoot, {
        hookPoint: args.hookPoint as string,
        hookName: args.hookName as string,
        status: args.status as HookStatus,
        message: args.message as string | undefined,
        changeId: args.changeId as string | undefined,
      });
    case 'list_archives':
      return listArchives(projectRoot);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('OpenSpec Assistant MCP server started on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
