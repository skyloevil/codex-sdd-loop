export type Phase =
  | 'idle'
  | 'propose'
  | 'plan'
  | 'implement'
  | 'validate'
  | 'archive'
  | 'complete';

export type Preset = 'full' | 'hotfix' | 'tweak';
export type GateMode = 'auto' | 'review' | 'manual';
export type ArtifactStatus = 'pending' | 'ready' | 'done' | 'blocked' | 'archived';
export type HookKind = 'mcp_tool' | 'command' | 'skill';
export type HookStatus = 'pending' | 'passed' | 'failed' | 'skipped';
export type ResponseFormat = 'json' | 'markdown';

export type ArtifactId =
  | 'proposal'
  | 'specs'
  | 'design'
  | 'tasks'
  | 'verification'
  | 'implementation_notes';

export interface HookDefinition {
  kind: HookKind;
  name: string;
  required: boolean;
  command?: string;
}

export interface ProjectConfig {
  version: number;
  schema: string;
  interaction: {
    autoTransition: boolean;
    defaultGate: GateMode;
  };
  context: string;
  rules: Record<string, string[]>;
  hooks: Record<string, HookDefinition[]>;
}

export interface ArtifactState {
  id: ArtifactId;
  path: string;
  status: ArtifactStatus;
  requires: ArtifactId[];
  updatedAt?: string;
}

export interface HookResult {
  hookPoint: string;
  hookName: string;
  kind?: HookKind;
  required?: boolean;
  status: HookStatus;
  message?: string;
  recordedAt: string;
}

export interface ChangeState {
  changeId: string;
  phase: Phase;
  preset: Preset;
  schema: string;
  paths: {
    changeDir: string;
    proposal?: string;
    specsDir?: string;
    specs?: string;
    design?: string;
    tasks?: string;
    verification?: string;
    implementationNotes?: string;
    archiveDir?: string;
  };
  artifacts: Partial<Record<ArtifactId, ArtifactState>>;
  gates: {
    scope: boolean;
    design: boolean;
    validation: boolean;
    archive: boolean;
  };
  hooks: HookResult[];
  archived: boolean;
  nextAction: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface OpenSpecState {
  version: 2;
  activeChangeId?: string;
  changes: Record<string, ChangeState>;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface LegacyOpenSpecState {
  changeId: string;
  phase: Phase;
  paths: {
    proposal?: string;
    design?: string;
    tasks?: string;
    specsDir?: string;
    archiveDir: string;
  };
  confirmed: {
    scope: boolean;
    design: boolean;
    readyForImplement: boolean;
    readyForArchive: boolean;
  };
  nextAction: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface TaskItem {
  id: string;
  description: string;
  done: boolean;
  priority: 'high' | 'medium' | 'low';
}

export interface DriftItem {
  type: 'spec_file_missing' | 'api_mismatch' | 'field_mismatch' | 'behavior_missing' | 'task_incomplete' | 'hook_blocked';
  description: string;
  severity: 'high' | 'medium' | 'low';
  location?: string;
}

export interface DetectResult {
  hasOpenSpec: boolean;
  state: OpenSpecState | null;
  existingDirs: string[];
  existingFiles: string[];
  changes: Array<{ changeId: string; phase: Phase; archived: boolean; preset: Preset }>;
}

export interface NextAction {
  id: string;
  description: string;
  phase: Phase;
  gate?: keyof ChangeState['gates'];
  artifactId?: ArtifactId;
  mode: GateMode;
}

export const OPENSPEC_SUBDIR = '.openspec-codex';
export const STATE_FILE = `${OPENSPEC_SUBDIR}/state.json`;
export const DEFAULT_OPENSPEC_DIR = 'openspec';
export const CHANGES_DIR = `${DEFAULT_OPENSPEC_DIR}/changes`;
export const ARCHIVE_DIR = `${DEFAULT_OPENSPEC_DIR}/changes/archive`;

export const DEFAULT_PROJECT_CONFIG: ProjectConfig = {
  version: 1,
  schema: 'spec-driven',
  interaction: {
    autoTransition: true,
    defaultGate: 'review',
  },
  context: '',
  rules: {},
  hooks: {},
};

export const DEFAULT_STATE: OpenSpecState = {
  version: 2,
  changes: {},
  createdAt: '',
  updatedAt: '',
};
