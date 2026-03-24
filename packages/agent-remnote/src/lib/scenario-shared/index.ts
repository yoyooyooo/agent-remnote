export type ScenarioDiagnostic = {
  readonly level: 'error' | 'warning' | 'info';
  readonly path: string;
  readonly message: string;
};

export type ScenarioChange = {
  readonly path: string;
  readonly kind: 'defaulted' | 'normalized' | 'inferred';
  readonly before?: unknown;
  readonly after?: unknown;
};

export type ScenarioVariable = {
  readonly name: string;
  readonly type: string;
  readonly required: boolean;
  readonly default?: unknown;
  readonly description?: string;
};

export type StructuredReferenceNode =
  | { readonly kind: 'var'; readonly name: string }
  | { readonly kind: 'literal'; readonly value: unknown }
  | { readonly kind: 'node_output'; readonly node: string; readonly output: string }
  | { readonly kind: 'selected_field'; readonly field: string; readonly value?: unknown }
  | { readonly kind: 'selected_path'; readonly path: readonly string[]; readonly value?: unknown }
  | { readonly kind: 'coalesce'; readonly values: readonly StructuredReferenceNode[] };

export type QuerySelectorV2 = {
  readonly version: 2;
  readonly root: Record<string, unknown>;
  readonly scope?: Record<string, unknown>;
  readonly shape?: Record<string, unknown>;
  readonly sort?: Record<string, unknown>;
};

export type ScenarioSchedulingPolicy = {
  readonly batching?: 'off' | 'auto';
  readonly merge_strategy?: 'off' | 'safe_dedupe';
  readonly parallelism?: 'serial' | 'auto';
  readonly ordering?: 'preserve_selection_order' | 'preserve_topology';
  readonly dispatch_mode?: 'serial' | 'conflict_parallel';
};

export type ScenarioNode =
  | {
      readonly id: string;
      readonly kind: 'selector';
      readonly selector_kind: 'query' | 'preset_ref';
      readonly input: Record<string, unknown>;
      readonly depends_on?: readonly string[];
      readonly output_slots: readonly string[];
    }
  | {
      readonly id: string;
      readonly kind: 'transform';
      readonly transform_kind: string;
      readonly input: Record<string, unknown>;
      readonly depends_on?: readonly string[];
      readonly output_slots: readonly string[];
    }
  | {
      readonly id: string;
      readonly kind: 'action';
      readonly command_id: string;
      readonly input: Record<string, unknown>;
      readonly depends_on?: readonly string[];
      readonly output_slots: readonly string[];
    };

export type ScenarioPackage = {
  readonly id: string;
  readonly version: 1;
  readonly meta: {
    readonly title: string;
    readonly owner: string;
    readonly description?: string;
  };
  readonly vars: readonly ScenarioVariable[];
  readonly nodes: readonly ScenarioNode[];
  readonly entry: readonly string[];
  readonly outputs: readonly string[];
  readonly policy: {
    readonly wait: boolean;
    readonly remote_parity_required: boolean;
    readonly max_items: number;
    readonly idempotency?: string;
    readonly fallback_strategy?: 'fail' | 'allow_empty_selection' | 'skip_optional_outputs';
  };
  readonly scheduling?: ScenarioSchedulingPolicy;
  readonly capabilities: {
    readonly requires?: Readonly<Record<string, boolean>>;
  };
};

export type ScenarioNormalizeResult = {
  readonly ok: boolean;
  readonly package: ScenarioPackage;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  readonly hints: readonly string[];
  readonly diagnostics: readonly ScenarioDiagnostic[];
  readonly changes: readonly ScenarioChange[];
};

export type ScenarioGenerateResult = {
  readonly package: ScenarioPackage;
  readonly assumptions: readonly string[];
  readonly inputsUsed: Record<string, unknown>;
  readonly warnings: readonly string[];
  readonly hints: readonly string[];
  readonly diagnostics: readonly ScenarioDiagnostic[];
};

export type ScenarioPackageInput = ScenarioPackage;

export type ScenarioValidationResult = {
  readonly ok: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  readonly hints: readonly string[];
  readonly diagnostics: readonly ScenarioDiagnostic[];
  readonly package?: ScenarioPackage;
};

export type ScenarioSchemaToolResult = {
  readonly tool: 'scenario.schema';
  readonly subcommand: 'validate' | 'normalize' | 'explain' | 'generate';
  readonly schema_version: number;
  readonly ok: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  readonly hints: readonly string[];
  readonly diagnostics?: readonly unknown[];
  readonly normalized_package?: ScenarioPackage;
  readonly changes?: readonly ScenarioChange[];
  readonly summary?: string;
  readonly required_vars?: readonly unknown[];
  readonly capabilities?: readonly string[];
  readonly selector_preview?: readonly unknown[];
  readonly action_preview?: readonly unknown[];
  readonly execution_outline?: readonly string[];
  readonly generated_package?: ScenarioPackage;
  readonly inputs_used?: Record<string, unknown>;
  readonly assumptions?: readonly string[];
};

export class ScenarioSharedError extends Error {
  readonly code: 'INVALID_PAYLOAD';

  constructor(message: string) {
    super(message);
    this.name = 'ScenarioSharedError';
    this.code = 'INVALID_PAYLOAD';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function addDiagnostic(
  diagnostics: ScenarioDiagnostic[],
  errors: string[],
  level: ScenarioDiagnostic['level'],
  path: string,
  message: string,
) {
  diagnostics.push({ level, path, message });
  if (level === 'error') errors.push(message);
}

function addChange(
  changes: ScenarioChange[],
  path: string,
  kind: ScenarioChange['kind'],
  before: unknown,
  after: unknown,
) {
  changes.push({ path, kind, before, after });
}

function expectRecord(
  value: unknown,
  path: string,
  diagnostics: ScenarioDiagnostic[],
  errors: string[],
): Record<string, unknown> {
  if (isRecord(value)) return value;
  addDiagnostic(diagnostics, errors, 'error', path, `${path} must be an object`);
  return {};
}

function expectString(
  value: unknown,
  path: string,
  diagnostics: ScenarioDiagnostic[],
  errors: string[],
  fallback = '',
): string {
  if (typeof value === 'string' && value.trim()) return value.trim();
  addDiagnostic(diagnostics, errors, 'error', path, `${path} must be a non-empty string`);
  return fallback;
}

function expectStringArray(
  value: unknown,
  path: string,
  diagnostics: ScenarioDiagnostic[],
  errors: string[],
): string[] {
  if (!Array.isArray(value)) {
    addDiagnostic(diagnostics, errors, 'error', path, `${path} must be an array`);
    return [];
  }
  const out = value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0);
  if (out.length !== value.length) {
    addDiagnostic(diagnostics, errors, 'error', path, `${path} must contain only non-empty strings`);
  }
  return out;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asInt(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.trunc(parsed);
  }
  return fallback;
}

function normalizePowerupValue(value: string): string {
  const trimmed = value.trim();
  if (/^todo$/i.test(trimmed)) return 't';
  return trimmed;
}

function normalizeQuerySelector(
  raw: unknown,
  path: string,
  diagnostics: ScenarioDiagnostic[],
  errors: string[],
  changes: ScenarioChange[],
): QuerySelectorV2 {
  const input = expectRecord(raw, path, diagnostics, errors);
  let query = input;

  if (isRecord(input.query)) {
    query = input.query;
  } else if (isRecord(input.queryObj)) {
    query = input.queryObj;
    addChange(changes, `${path}.queryObj`, 'normalized', input.queryObj, query);
  }

  if (isRecord(query.query)) {
    query = query.query;
  }

  const version = 2 as const;
  const root = expectRecord(query.root ?? query, `${path}.root`, diagnostics, errors);
  const normalizedRoot = normalizeQueryRoot(root, `${path}.root`, diagnostics, errors, changes);
  return {
    version,
    root: normalizedRoot,
    ...(isRecord(query.scope) ? { scope: query.scope } : {}),
    ...(isRecord(query.shape) ? { shape: query.shape } : {}),
    ...(isRecord(query.sort) ? { sort: query.sort } : {}),
  };
}

function normalizeQueryRoot(
  raw: Record<string, unknown>,
  path: string,
  diagnostics: ScenarioDiagnostic[],
  errors: string[],
  changes: ScenarioChange[],
): Record<string, unknown> {
  const type = expectString(raw.type, `${path}.type`, diagnostics, errors);

  if (type === 'text') {
    const value = expectString(raw.value, `${path}.value`, diagnostics, errors);
    const mode = typeof raw.mode === 'string' && raw.mode.trim() ? raw.mode.trim() : 'contains';
    if (raw.mode === undefined) {
      addChange(changes, `${path}.mode`, 'defaulted', undefined, mode);
    }
    return { type, value, mode };
  }

  if (type === 'powerup') {
    const powerup = expectRecord(raw.powerup, `${path}.powerup`, diagnostics, errors);
    let by = typeof powerup.by === 'string' ? powerup.by.trim().toLowerCase() : '';
    if (by !== 'id' && by !== 'rcrt') {
      if (!by) {
        by = 'rcrt';
        addChange(changes, `${path}.powerup.by`, 'defaulted', powerup.by, by);
      } else {
        addDiagnostic(
          diagnostics,
          errors,
          'error',
          `${path}.powerup.by`,
          'powerup.by must be one of: id, rcrt',
        );
      }
    }
    const rawValue = expectString(powerup.value, `${path}.powerup.value`, diagnostics, errors);
    const value = by === 'rcrt' ? normalizePowerupValue(rawValue) : rawValue;
    if (value !== rawValue) {
      addChange(changes, `${path}.powerup.value`, 'normalized', rawValue, value);
    }
    return {
      type,
      powerup: {
        by,
        value,
      },
    };
  }

  if ((type === 'and' || type === 'or') && Array.isArray(raw.nodes)) {
    return {
      type,
      nodes: raw.nodes.map((child, index) =>
        normalizeQueryRoot(
          expectRecord(child, `${path}.nodes[${index}]`, diagnostics, errors),
          `${path}.nodes[${index}]`,
          diagnostics,
          errors,
          changes,
        ),
      ),
    };
  }

  if (type === 'not') {
    return {
      type,
      node: normalizeQueryRoot(
        expectRecord(raw.node, `${path}.node`, diagnostics, errors),
        `${path}.node`,
        diagnostics,
        errors,
        changes,
      ),
    };
  }

  return raw;
}

function normalizeVars(
  raw: unknown,
  path: string,
  diagnostics: ScenarioDiagnostic[],
  errors: string[],
  changes: ScenarioChange[],
): ScenarioVariable[] {
  if (Array.isArray(raw)) {
    return raw.map((item, index) => normalizeVar(item, `${path}[${index}]`, diagnostics, errors));
  }

  if (isRecord(raw)) {
    const vars = Object.entries(raw).map(([name, value]) =>
      normalizeVar({ ...(isRecord(value) ? value : {}), name }, `${path}.${name}`, diagnostics, errors),
    );
    addChange(changes, path, 'normalized', raw, vars);
    return vars;
  }

  if (raw === undefined) return [];
  addDiagnostic(diagnostics, errors, 'error', path, `${path} must be an array or object`);
  return [];
}

function normalizeVar(
  raw: unknown,
  path: string,
  diagnostics: ScenarioDiagnostic[],
  errors: string[],
): ScenarioVariable {
  const value = expectRecord(raw, path, diagnostics, errors);
  return {
    name: expectString(value.name, `${path}.name`, diagnostics, errors),
    type: expectString(value.type, `${path}.type`, diagnostics, errors, 'string'),
    required: asBoolean(value.required, false),
    ...(value.default !== undefined ? { default: value.default } : {}),
    ...(typeof value.description === 'string' && value.description.trim()
      ? { description: value.description.trim() }
      : {}),
  };
}

function normalizeCapabilities(
  raw: unknown,
  path: string,
  changes: ScenarioChange[],
): { readonly requires?: Readonly<Record<string, boolean>> } {
  if (Array.isArray(raw)) {
    const out = Object.fromEntries(
      raw
        .map((item) => String(item ?? '').trim())
        .filter(Boolean)
        .map((item) => [item.replace(/^requires\./, ''), true]),
    );
    addChange(changes, path, 'normalized', raw, { requires: out });
    return Object.keys(out).length > 0 ? { requires: out } : {};
  }
  if (!isRecord(raw)) return {};
  const requires = raw.requires;
  if (Array.isArray(requires)) {
    const out = Object.fromEntries(
      requires
        .map((item) => String(item ?? '').trim())
        .filter(Boolean)
        .map((item) => [item.replace(/^requires\./, ''), true]),
    );
    addChange(changes, `${path}.requires`, 'normalized', requires, out);
    return Object.keys(out).length > 0 ? { requires: out } : {};
  }

  if (isRecord(requires)) {
    const out = Object.fromEntries(
      Object.entries(requires)
        .map(([key, value]) => [key.replace(/^requires\./, ''), value === true] as const)
        .filter(([, value]) => value),
    );
    return Object.keys(out).length > 0 ? { requires: out } : {};
  }

  return {};
}

function normalizePolicy(
  raw: unknown,
  path: string,
  diagnostics: ScenarioDiagnostic[],
  errors: string[],
): ScenarioPackage['policy'] {
  const value = expectRecord(raw, path, diagnostics, errors);
  const fallbackStrategy =
    value.fallback_strategy === 'allow_empty_selection' ||
    value.fallback_strategy === 'skip_optional_outputs' ||
    value.fallback_strategy === 'fail'
      ? value.fallback_strategy
      : undefined;

  return {
    wait: asBoolean(value.wait, false),
    remote_parity_required: asBoolean(value.remote_parity_required, true),
    max_items: Math.max(1, asInt(value.max_items, 200)),
    ...(typeof value.idempotency === 'string' && value.idempotency.trim()
      ? { idempotency: value.idempotency.trim() }
      : {}),
    ...(fallbackStrategy ? { fallback_strategy: fallbackStrategy } : {}),
  };
}

function normalizeScheduling(
  raw: unknown,
  path: string,
  diagnostics: ScenarioDiagnostic[],
  errors: string[],
): ScenarioSchedulingPolicy | undefined {
  if (raw === undefined) return undefined;
  const value = expectRecord(raw, path, diagnostics, errors);

  const batching = value.batching === 'off' || value.batching === 'auto' ? value.batching : undefined;
  const mergeStrategy =
    value.merge_strategy === 'off' || value.merge_strategy === 'safe_dedupe' ? value.merge_strategy : undefined;
  const parallelism = value.parallelism === 'serial' || value.parallelism === 'auto' ? value.parallelism : undefined;
  const ordering =
    value.ordering === 'preserve_selection_order' || value.ordering === 'preserve_topology'
      ? value.ordering
      : undefined;
  const dispatchMode =
    value.dispatch_mode === 'serial' || value.dispatch_mode === 'conflict_parallel' ? value.dispatch_mode : undefined;

  return {
    ...(batching ? { batching } : {}),
    ...(mergeStrategy ? { merge_strategy: mergeStrategy } : {}),
    ...(parallelism ? { parallelism } : {}),
    ...(ordering ? { ordering } : {}),
    ...(dispatchMode ? { dispatch_mode: dispatchMode } : {}),
  };
}

function normalizeNodes(
  raw: unknown,
  path: string,
  diagnostics: ScenarioDiagnostic[],
  errors: string[],
  changes: ScenarioChange[],
): ScenarioNode[] {
  if (!Array.isArray(raw)) {
    addDiagnostic(diagnostics, errors, 'error', path, `${path} must be an array`);
    return [];
  }

  return raw.map((item, index) => {
    const nodePath = `${path}[${index}]`;
    const value = expectRecord(item, nodePath, diagnostics, errors);
    const id = expectString(value.id, `${nodePath}.id`, diagnostics, errors);
    const kind = expectString(value.kind, `${nodePath}.kind`, diagnostics, errors);
    const dependsOn = Array.isArray(value.depends_on)
      ? value.depends_on.map((entry) => String(entry ?? '').trim()).filter(Boolean)
      : undefined;
    const input = expectRecord(value.input ?? {}, `${nodePath}.input`, diagnostics, errors);
    const rawOutputSlots = Array.isArray(value.output_slots)
      ? value.output_slots.map((entry) => String(entry ?? '').trim()).filter(Boolean)
      : undefined;

    if (kind === 'selector') {
      const outputSlots = rawOutputSlots && rawOutputSlots.length > 0 ? rawOutputSlots : ['selection'];
      if (!rawOutputSlots || rawOutputSlots.length === 0) {
        addChange(changes, `${nodePath}.output_slots`, 'defaulted', value.output_slots, outputSlots);
      }
      return {
        id,
        kind: 'selector',
        selector_kind: (typeof value.selector_kind === 'string' ? value.selector_kind : 'query') as 'query' | 'preset_ref',
        input: {
          ...input,
          ...(input.query !== undefined ? { query: normalizeQuerySelector(input.query, `${nodePath}.input.query`, diagnostics, errors, changes) } : {}),
        },
        ...(dependsOn && dependsOn.length > 0 ? { depends_on: dependsOn } : {}),
        output_slots: outputSlots,
      };
    }

    if (kind === 'transform') {
      const outputSlots = rawOutputSlots && rawOutputSlots.length > 0 ? rawOutputSlots : ['selection'];
      if (!rawOutputSlots || rawOutputSlots.length === 0) {
        addChange(changes, `${nodePath}.output_slots`, 'defaulted', value.output_slots, outputSlots);
      }
      return {
        id,
        kind: 'transform',
        transform_kind: expectString(value.transform_kind, `${nodePath}.transform_kind`, diagnostics, errors),
        input,
        ...(dependsOn && dependsOn.length > 0 ? { depends_on: dependsOn } : {}),
        output_slots: outputSlots,
      };
    }

    const outputSlots = rawOutputSlots && rawOutputSlots.length > 0 ? rawOutputSlots : ['receipt'];
    if (!rawOutputSlots || rawOutputSlots.length === 0) {
      addChange(changes, `${nodePath}.output_slots`, 'defaulted', value.output_slots, outputSlots);
    }
    return {
      id,
      kind: 'action',
      command_id: expectString(value.command_id, `${nodePath}.command_id`, diagnostics, errors),
      input,
      ...(dependsOn && dependsOn.length > 0 ? { depends_on: dependsOn } : {}),
      output_slots: outputSlots,
    };
  });
}

function scanStructuredReferences(
  value: unknown,
  onRef: (ref: Extract<StructuredReferenceNode, { kind: 'node_output' }>, path: string) => void,
  path: string,
) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanStructuredReferences(item, onRef, `${path}[${index}]`));
    return;
  }
  if (!isRecord(value)) return;

  if (value.kind === 'node_output' && typeof value.node === 'string' && typeof value.output === 'string') {
    onRef(value as Extract<StructuredReferenceNode, { kind: 'node_output' }>, path);
  }

  for (const [key, child] of Object.entries(value)) {
    scanStructuredReferences(child, onRef, `${path}.${key}`);
  }
}

function validateGraph(
  pkg: ScenarioPackage,
  diagnostics: ScenarioDiagnostic[],
  errors: string[],
): void {
  const nodes = new Map(pkg.nodes.map((node) => [node.id, node] as const));
  const outputRegistry = new Map(pkg.nodes.map((node) => [node.id, new Set(node.output_slots)] as const));

  for (const entry of pkg.entry) {
    const node = nodes.get(entry);
    if (!node) {
      addDiagnostic(diagnostics, errors, 'error', 'entry', `entry node "${entry}" is not declared`);
      continue;
    }
    if (node.kind !== 'selector') {
      addDiagnostic(diagnostics, errors, 'error', 'entry', `entry node "${entry}" must be a selector`);
    }
    if (node.depends_on && node.depends_on.length > 0) {
      addDiagnostic(diagnostics, errors, 'error', 'entry', `entry node "${entry}" must not declare depends_on`);
    }
  }

  for (const output of pkg.outputs) {
    const [nodeId, slot] = output.split('.');
    const node = nodes.get(nodeId);
    if (!node) {
      addDiagnostic(diagnostics, errors, 'error', 'outputs', `output "${output}" references an unknown node`);
      continue;
    }
    if (slot && !outputRegistry.get(nodeId)?.has(slot)) {
      addDiagnostic(diagnostics, errors, 'error', 'outputs', `output "${output}" references an unknown output slot`);
    }
  }

  for (const [index, node] of pkg.nodes.entries()) {
    for (const dep of node.depends_on ?? []) {
      if (!nodes.has(dep)) {
        addDiagnostic(
          diagnostics,
          errors,
          'error',
          `nodes[${index}].depends_on`,
          `node "${node.id}" depends on unknown node "${dep}"`,
        );
      }
    }

    scanStructuredReferences(node.input, (ref, refPath) => {
      if (!nodes.has(ref.node)) {
        addDiagnostic(diagnostics, errors, 'error', `${refPath}.node`, `unknown node_output source "${ref.node}"`);
        return;
      }
      if (!outputRegistry.get(ref.node)?.has(ref.output)) {
        addDiagnostic(
          diagnostics,
          errors,
          'error',
          `${refPath}.output`,
          `node_output "${ref.node}.${ref.output}" references an undeclared output slot`,
        );
      }
    }, `nodes[${index}].input`);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (nodeId: string) => {
    if (visited.has(nodeId)) return;
    if (visiting.has(nodeId)) {
      addDiagnostic(diagnostics, errors, 'error', 'nodes', `cycle detected at node "${nodeId}"`);
      return;
    }
    visiting.add(nodeId);
    const node = nodes.get(nodeId);
    for (const dep of node?.depends_on ?? []) visit(dep);
    visiting.delete(nodeId);
    visited.add(nodeId);
  };

  for (const nodeId of nodes.keys()) visit(nodeId);
}

export function normalizeScenarioPackage(input: unknown): ScenarioNormalizeResult {
  const diagnostics: ScenarioDiagnostic[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  const hints: string[] = [];
  const changes: ScenarioChange[] = [];

  const value = expectRecord(input, 'package', diagnostics, errors);
  const pkg: ScenarioPackage = {
    id: expectString(value.id, 'package.id', diagnostics, errors),
    version: 1,
    meta: {
      title: expectString(value.meta && isRecord(value.meta) ? value.meta.title : undefined, 'package.meta.title', diagnostics, errors),
      owner: expectString(value.meta && isRecord(value.meta) ? value.meta.owner : undefined, 'package.meta.owner', diagnostics, errors),
      ...(typeof (isRecord(value.meta) ? value.meta.description : undefined) === 'string' &&
      String((value.meta as Record<string, unknown>).description).trim()
        ? { description: String((value.meta as Record<string, unknown>).description).trim() }
        : {}),
    },
    vars: normalizeVars(value.vars, 'vars', diagnostics, errors, changes),
    nodes: normalizeNodes(value.nodes, 'nodes', diagnostics, errors, changes),
    entry: expectStringArray(value.entry, 'entry', diagnostics, errors),
    outputs: expectStringArray(value.outputs, 'outputs', diagnostics, errors),
    policy: normalizePolicy(value.policy, 'policy', diagnostics, errors),
    ...(normalizeScheduling(value.scheduling, 'scheduling', diagnostics, errors)
      ? { scheduling: normalizeScheduling(value.scheduling, 'scheduling', diagnostics, errors)! }
      : {}),
    capabilities: normalizeCapabilities(value.capabilities, 'capabilities', changes),
  };

  validateGraph(pkg, diagnostics, errors);

  if (pkg.nodes.length === 0) hints.push('Add at least one selector node before attempting execution.');
  if (!pkg.capabilities.requires?.write_runtime) {
    warnings.push('No write_runtime capability declared; action nodes may fail during execution.');
  }

  return {
    ok: errors.length === 0,
    package: pkg,
    errors,
    warnings,
    hints,
    diagnostics,
    changes,
  };
}

export function validateScenarioPackage(input: unknown): Omit<ScenarioNormalizeResult, 'changes' | 'package'> & {
  readonly package?: ScenarioPackage;
} {
  const normalized = normalizeScenarioPackage(input);
  return {
    ok: normalized.ok,
    ...(normalized.ok ? { package: normalized.package } : {}),
    errors: normalized.errors,
    warnings: normalized.warnings,
    hints: normalized.hints,
    diagnostics: normalized.diagnostics,
  };
}

function parseVarAssignments(items: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const item of items) {
    const raw = String(item ?? '');
    const index = raw.indexOf('=');
    if (index <= 0) continue;
    const key = raw.slice(0, index).trim();
    const value = raw.slice(index + 1).trim();
    if (!key) continue;
    out[key] = value;
  }
  return out;
}

function summarizeCapabilities(capabilities: ScenarioPackage['capabilities']): string[] {
  return Object.entries(capabilities.requires ?? {})
    .filter(([, value]) => value === true)
    .map(([key]) => key);
}

export function explainScenarioPackage(input: unknown, varSpecs: readonly string[] = []) {
  const normalized = normalizeScenarioPackage(input);
  const boundVars = parseVarAssignments(varSpecs);
  const selectorPreview = normalized.package.nodes
    .filter((node): node is Extract<ScenarioNode, { kind: 'selector' }> => node.kind === 'selector')
    .map((node) => ({
      node_id: node.id,
      selector_kind: node.selector_kind,
      query: node.selector_kind === 'query' ? node.input.query ?? null : null,
    }));
  const actionPreview = normalized.package.nodes
    .filter((node): node is Extract<ScenarioNode, { kind: 'action' }> => node.kind === 'action')
    .map((node) => ({
      node_id: node.id,
      command_id: node.command_id,
      depends_on: node.depends_on ?? [],
    }));
  const requiredVars = normalized.package.vars.map((variable) => ({
    name: variable.name,
    type: variable.type,
    required: variable.required,
    default: variable.default,
    bound_value: boundVars[variable.name] ?? variable.default ?? null,
  }));
  const executionOutline = normalized.package.nodes.map((node) =>
    node.depends_on && node.depends_on.length > 0 ? `${node.depends_on.join(', ')} -> ${node.id}` : node.id,
  );

  return {
    ...normalized,
    summary: `${normalized.package.id}: ${normalized.package.meta.title} (${normalized.package.nodes.length} nodes)`,
    requiredVars,
    capabilities: summarizeCapabilities(normalized.package.capabilities),
    selectorPreview,
    actionPreview,
    executionOutline,
  };
}

type ScenarioGenerateHint = {
  readonly goal: string;
  readonly selector_kind?: string;
  readonly action_kind?: string;
  readonly source_scope?: string;
  readonly target_ref?: string;
  readonly vars?: unknown;
  readonly constraints?: unknown;
  readonly capabilities?: unknown;
};

function slugifyId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
}

function pickDeliveryMode(hint: ScenarioGenerateHint): 'move' | 'portal' {
  const vars = Array.isArray(hint.vars) ? hint.vars : [];
  const varDefault = vars.find((item) => isRecord(item) && item.name === 'delivery_mode');
  const defaultMode =
    isRecord(varDefault) && typeof varDefault.default === 'string' ? varDefault.default.trim().toLowerCase() : '';
  if (defaultMode === 'move') return 'move';
  if (typeof hint.action_kind === 'string' && hint.action_kind.trim() === 'rem.move') return 'move';
  return 'portal';
}

function buildGeneratedRoot(goal: string): Record<string, unknown> {
  if (/todo/i.test(goal)) {
    return {
      type: 'powerup',
      powerup: {
        by: 'rcrt',
        value: 't',
      },
    };
  }

  return {
    type: 'text',
    value: goal.trim(),
    mode: 'contains',
  };
}

export function generateScenarioPackage(input: unknown): ScenarioGenerateResult {
  if (!isRecord(input)) {
    throw new ScenarioSharedError('--hint must be a JSON object');
  }

  const hint = input as ScenarioGenerateHint;
  const goal = typeof hint.goal === 'string' && hint.goal.trim() ? hint.goal.trim() : '';
  if (!goal) {
    throw new ScenarioSharedError('hint.goal is required');
  }

  const diagnostics: ScenarioDiagnostic[] = [];
  const warnings: string[] = [];
  const hints: string[] = [];
  const assumptions: string[] = [];
  const changes: ScenarioChange[] = [];

  const vars = normalizeVars(
    hint.vars ?? [
      { name: 'source_scope', type: 'scope', required: false, default: hint.source_scope ?? 'daily:last-7d' },
      { name: 'target_ref', type: 'ref', required: false, default: hint.target_ref ?? 'daily:today' },
    ],
    'hint.vars',
    diagnostics,
    [],
    changes,
  );
  const hasSourceScope = vars.some((variable) => variable.name === 'source_scope');
  const hasTargetRef = vars.some((variable) => variable.name === 'target_ref');
  const normalizedVars = [
    ...(hasSourceScope ? [] : [{ name: 'source_scope', type: 'scope', required: false, default: hint.source_scope ?? 'daily:last-7d' }]),
    ...(hasTargetRef ? [] : [{ name: 'target_ref', type: 'ref', required: false, default: hint.target_ref ?? 'daily:today' }]),
    ...vars,
  ];

  const deliveryMode = pickDeliveryMode(hint);
  const commandId = deliveryMode === 'move' ? 'rem.move' : 'portal.create';
  if (hint.action_kind === 'delivery') {
    assumptions.push(`Derived action command from delivery mode: ${commandId}`);
  }

  const constraints = isRecord(hint.constraints) ? hint.constraints : {};
  const candidateId =
    typeof constraints.builtin_candidate_id === 'string' && constraints.builtin_candidate_id.trim()
      ? constraints.builtin_candidate_id.trim()
      : slugifyId(goal);
  const packageId = `${candidateId}_${deliveryMode}`;
  const selectorId = 'recent_todos';
  const actionId = deliveryMode === 'move' ? 'move_to_today' : 'portal_to_today';

  const rawPackage = {
    id: packageId,
    version: 1,
    meta: {
      title: goal,
      owner: 'generated',
      description: `${goal} (${deliveryMode})`,
    },
    vars: normalizedVars,
    nodes: [
      {
        id: selectorId,
        kind: 'selector',
        selector_kind: hint.selector_kind === 'preset_ref' ? 'preset_ref' : 'query',
        input: {
          query: {
            version: 2,
            root: buildGeneratedRoot(goal),
            scope: {
              kind: 'var',
              name: 'source_scope',
            },
            shape: {
              roots_only: true,
            },
          },
        },
      },
      {
        id: actionId,
        kind: 'action',
        depends_on: [selectorId],
        command_id: commandId,
        input: {
          selection: {
            kind: 'node_output',
            node: selectorId,
            output: 'selection',
          },
          target_ref: {
            kind: 'var',
            name: 'target_ref',
          },
          delivery_mode: {
            kind: 'literal',
            value: deliveryMode,
          },
        },
      },
    ],
    entry: [selectorId],
    outputs: [actionId],
    policy: {
      wait: false,
      remote_parity_required:
        isRecord(constraints) && typeof constraints.require_remote_parity === 'boolean'
          ? constraints.require_remote_parity
          : true,
      max_items: 200,
      fallback_strategy: 'allow_empty_selection',
    },
    capabilities: normalizeCapabilities(hint.capabilities ?? {}, 'hint.capabilities', changes),
  };

  const normalized = normalizeScenarioPackage(rawPackage);
  hints.push(...normalized.hints);
  warnings.push(...normalized.warnings);
  diagnostics.push(...normalized.diagnostics);

  return {
    package: normalized.package,
    assumptions,
    inputsUsed: {
      selector_kind: hint.selector_kind === 'preset_ref' ? 'preset_ref' : 'query',
      action_kind: commandId,
      delivery_mode: deliveryMode,
    },
    warnings,
    hints,
    diagnostics,
  };
}

export const generateScenarioPackageFromHint = generateScenarioPackage;
