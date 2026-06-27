import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  archiveChange,
  createChange,
  createOrUpdateArtifact,
  detectLayout,
  getNextActions,
  getPendingHooks,
  initProject,
  listChanges,
  readArtifact,
  recordHookResult,
  updateTaskStatus,
  validateDrift,
} from '../src/openspec.js';
import { readState, writeState } from '../src/state.js';
import { STATE_FILE } from '../src/types.js';

function tmpProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openspec-assistant-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{}\n', 'utf-8');
  return dir;
}

test('creates a spec-driven project and change directory with default artifacts', () => {
  const root = tmpProject();

  const init = initProject(root, { schema: 'spec-driven' });
  assert.equal(init.success, true);
  assert.equal(fs.existsSync(path.join(root, 'openspec/config.yaml')), true);
  assert.equal(fs.existsSync(path.join(root, 'openspec/schemas/spec-driven/schema.yaml')), true);

  const change = createChange(root, {
    description: 'Add avatar upload',
    preset: 'full',
    background: 'Users need profile pictures.',
    outOfScope: 'Image editing',
  });

  assert.equal(change.success, true);
  assert.match(change.changeId, /^add-avatar-upload-\d{8}$/);
  assert.equal(fs.existsSync(path.join(root, 'openspec/changes', change.changeId, 'proposal.md')), true);
  assert.equal(fs.existsSync(path.join(root, 'openspec/changes', change.changeId, 'design.md')), true);
  assert.equal(fs.existsSync(path.join(root, 'openspec/changes', change.changeId, 'tasks.md')), true);
  assert.equal(fs.existsSync(path.join(root, 'openspec/changes', change.changeId, 'specs/spec.md')), true);

  const state = readState(root);
  assert.equal(state.version, 2);
  assert.equal(state.activeChangeId, change.changeId);
  assert.equal(state.changes[change.changeId].preset, 'full');
  assert.equal(state.changes[change.changeId].artifacts.proposal.status, 'done');
});

test('migrates legacy single-change state into v2 state', () => {
  const root = tmpProject();
  fs.mkdirSync(path.join(root, '.openspec-codex'), { recursive: true });
  fs.writeFileSync(
    path.join(root, STATE_FILE),
    JSON.stringify({
      changeId: 'legacy-change',
      phase: 'implement',
      paths: {
        proposal: 'openspec/proposal.md',
        design: 'openspec/design.md',
        tasks: 'openspec/tasks.md',
        archiveDir: 'openspec/archive/',
      },
      confirmed: {
        scope: true,
        design: false,
        readyForImplement: true,
        readyForArchive: false,
      },
      nextAction: 'Legacy next action',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }),
    'utf-8',
  );

  const state = readState(root);
  assert.equal(state.version, 2);
  assert.equal(state.activeChangeId, 'legacy-change');
  assert.equal(state.changes['legacy-change'].phase, 'implement');
  assert.equal(state.changes['legacy-change'].gates.scope, true);
  assert.equal(state.changes['legacy-change'].paths.tasks, 'openspec/tasks.md');
});

test('updates artifacts, tasks, hooks, validation, and archive state', () => {
  const root = tmpProject();
  initProject(root, {
    config: {
      hooks: {
        pre_archive: [{ kind: 'skill', name: 'implementation-notes-backfill', required: true }],
      },
    },
  });
  const change = createChange(root, { description: 'Fix login bug', preset: 'hotfix' });

  const updated = createOrUpdateArtifact(root, {
    artifactId: 'implementation_notes',
    content: '# Notes\n\nObserved idempotency issue.\n',
  });
  assert.equal(updated.success, true);

  let taskResult = updateTaskStatus(root, { taskId: 'T1', done: true });
  assert.equal(taskResult.success, true);
  taskResult = updateTaskStatus(root, { taskId: 'T2', done: true });
  assert.equal(taskResult.tasksRemaining, 0);

  const pendingHooks = getPendingHooks(root, { hookPoint: 'pre_archive' });
  assert.equal(pendingHooks.blocked, true);
  assert.equal(pendingHooks.hooks.length, 1);

  recordHookResult(root, {
    hookPoint: 'pre_archive',
    hookName: 'implementation-notes-backfill',
    status: 'passed',
    message: 'notes are complete',
  });

  const validation = validateDrift(root);
  assert.equal(validation.driftItems.some((item) => item.type === 'task_incomplete'), false);

  const archived = archiveChange(root, { message: 'Login bug fixed' });
  assert.equal(archived.success, true);
  assert.equal(fs.existsSync(path.join(root, archived.archiveDir, 'proposal.md')), true);
  assert.equal(fs.existsSync(path.join(root, archived.archiveDir, 'implementation-notes.md')), true);

  const changes = listChanges(root);
  assert.equal(changes.changes.find((item) => item.changeId === change.changeId)?.archived, true);
});

test('read artifact rejects path traversal and next actions reflect gates', () => {
  const root = tmpProject();
  initProject(root);
  createChange(root, { description: 'Add search filter', preset: 'tweak' });

  assert.throws(() => readArtifact(root, { artifactId: '../package.json' }), /Unknown artifact/);

  const next = getNextActions(root);
  assert.equal(next.actions[0].gate, 'scope');
  assert.match(next.actions[0].description, /Confirm scope/);

  const layout = detectLayout(root);
  assert.equal(layout.hasOpenSpec, true);
  assert.equal(layout.changes.length, 1);
});
