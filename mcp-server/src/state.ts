import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ChangeState, LegacyOpenSpecState, OpenSpecState, Phase } from './types.js';
import { DEFAULT_STATE, STATE_FILE, OPENSPEC_SUBDIR } from './types.js';

export function resolveProjectRoot(startDir: string = process.cwd()): string {
  let dir = path.resolve(startDir);
  while (dir !== path.parse(dir).root) {
    if (
      fs.existsSync(path.join(dir, '.git')) ||
      fs.existsSync(path.join(dir, 'package.json')) ||
      fs.existsSync(path.join(dir, 'go.mod')) ||
      fs.existsSync(path.join(dir, 'pom.xml')) ||
      fs.existsSync(path.join(dir, 'openspec'))
    ) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return path.resolve(startDir);
}

export function getStateFilePath(projectRoot: string): string {
  return path.join(projectRoot, STATE_FILE);
}

export function getStateDir(projectRoot: string): string {
  return path.join(projectRoot, OPENSPEC_SUBDIR);
}

export function ensureStateDir(projectRoot: string): void {
  const stateDir = getStateDir(projectRoot);
  if (!fs.existsSync(stateDir)) {
    fs.mkdirSync(stateDir, { recursive: true });
  }
}

export function readState(projectRoot: string): OpenSpecState {
  const filePath = getStateFilePath(projectRoot);
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as OpenSpecState | LegacyOpenSpecState;
    if ('version' in parsed && parsed.version === 2 && 'changes' in parsed) {
      return {
        ...structuredClone(DEFAULT_STATE),
        ...parsed,
        changes: parsed.changes || {},
      };
    }
    return migrateLegacyState(parsed as LegacyOpenSpecState);
  } catch {
    return freshState();
  }
}

export function writeState(projectRoot: string, state: OpenSpecState): void {
  ensureStateDir(projectRoot);
  const now = new Date().toISOString();
  state.updatedAt = now;
  if (!state.createdAt) {
    state.createdAt = now;
  }
  fs.writeFileSync(getStateFilePath(projectRoot), JSON.stringify(state, null, 2), 'utf-8');
}

export function freshState(): OpenSpecState {
  const now = new Date().toISOString();
  return {
    ...structuredClone(DEFAULT_STATE),
    createdAt: now,
    updatedAt: now,
  };
}

export function getActiveChange(state: OpenSpecState): ChangeState | null {
  if (!state.activeChangeId) return null;
  return state.changes[state.activeChangeId] || null;
}

export function setActiveChange(state: OpenSpecState, change: ChangeState): void {
  state.activeChangeId = change.changeId;
  state.changes[change.changeId] = change;
}

export function updatePhase(
  change: ChangeState,
  phase: Phase,
  nextAction: string,
  gateUpdates?: Partial<ChangeState['gates']>,
): ChangeState {
  change.phase = phase;
  change.nextAction = nextAction;
  change.updatedAt = new Date().toISOString();
  if (gateUpdates) {
    change.gates = { ...change.gates, ...gateUpdates };
  }
  return change;
}

function migrateLegacyState(legacy: LegacyOpenSpecState): OpenSpecState {
  const state = freshState();
  if (!legacy.changeId) {
    return state;
  }

  const now = legacy.updatedAt || new Date().toISOString();
  const change: ChangeState = {
    changeId: legacy.changeId,
    phase: legacy.phase || 'idle',
    preset: 'full',
    schema: 'spec-driven',
    paths: {
      changeDir: `openspec/changes/${legacy.changeId}`,
      proposal: legacy.paths?.proposal,
      design: legacy.paths?.design,
      tasks: legacy.paths?.tasks,
      specsDir: legacy.paths?.specsDir,
      archiveDir: legacy.paths?.archiveDir,
    },
    artifacts: {},
    gates: {
      scope: Boolean(legacy.confirmed?.scope),
      design: Boolean(legacy.confirmed?.design),
      validation: Boolean(legacy.confirmed?.readyForArchive),
      archive: false,
    },
    hooks: [],
    archived: legacy.phase === 'complete',
    nextAction: legacy.nextAction || 'Continue the active OpenSpec change.',
    createdAt: legacy.createdAt || now,
    updatedAt: now,
    metadata: legacy.metadata,
  };

  if (change.paths.proposal) {
    change.artifacts.proposal = {
      id: 'proposal',
      path: change.paths.proposal,
      status: 'done',
      requires: [],
    };
  }
  if (change.paths.design) {
    change.artifacts.design = {
      id: 'design',
      path: change.paths.design,
      status: legacy.confirmed?.design ? 'done' : 'ready',
      requires: ['proposal'],
    };
  }
  if (change.paths.tasks) {
    change.artifacts.tasks = {
      id: 'tasks',
      path: change.paths.tasks,
      status: 'done',
      requires: ['proposal'],
    };
  }

  setActiveChange(state, change);
  return state;
}
