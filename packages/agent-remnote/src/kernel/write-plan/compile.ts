import type { Alias, CompiledWritePlan, WritePlanStepV1, WritePlanV1 } from './model.js';

const ALIAS_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

type ActionSpec = {
  readonly opType: string;
  readonly supportsAs: boolean;
  readonly aliasRefAllowlist: readonly string[];
  readonly compile: (params: { readonly input: Record<string, unknown>; readonly aliasTempId?: string }) => {
    readonly ops: ReadonlyArray<{ readonly type: string; readonly payload: Record<string, unknown> }>;
  };
};

function getObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function isAlias(value: unknown): value is Alias {
  return typeof value === 'string' && ALIAS_RE.test(value);
}

function parseAliasRef(value: unknown): Alias | null {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (!s.startsWith('@')) return null;
  const name = s.slice(1);
  return isAlias(name) ? name : null;
}

function collectAliasRefs(
  value: unknown,
  pathPrefix: string,
): ReadonlyArray<{ readonly path: string; readonly alias: Alias }> {
  const out: Array<{ path: string; alias: Alias }> = [];

  const alias = parseAliasRef(value);
  if (alias) {
    out.push({ path: pathPrefix, alias });
    return out;
  }

  const obj = getObject(value);
  if (obj) {
    for (const [k, v] of Object.entries(obj)) {
      const childPath = pathPrefix ? `${pathPrefix}.${k}` : k;
      out.push(...collectAliasRefs(v, childPath));
    }
    return out;
  }

  if (Array.isArray(value)) {
    for (const v of value) {
      const childPath = pathPrefix ? `${pathPrefix}[]` : '[]';
      out.push(...collectAliasRefs(v, childPath));
    }
  }

  return out;
}

function resolveAliasRefsInValue(value: unknown, aliasMap: Readonly<Record<Alias, string>>): unknown {
  const alias = parseAliasRef(value);
  if (alias) return aliasMap[alias] ?? value;

  const obj = getObject(value);
  if (obj) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = resolveAliasRefsInValue(v, aliasMap);
    }
    return out;
  }

  if (Array.isArray(value)) {
    return value.map((v) => resolveAliasRefsInValue(v, aliasMap));
  }

  return value;
}

function buildMarkdownPayloadFields(input: Record<string, unknown>): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (typeof input.indent_mode === 'boolean') payload.indent_mode = input.indent_mode;
  if (typeof input.indent_size === 'number') payload.indent_size = input.indent_size;
  if (typeof input.parse_mode === 'string') payload.parse_mode = input.parse_mode;
  if (typeof input.staged === 'boolean') payload.staged = input.staged;
  if (input.prepared !== undefined) payload.prepared = input.prepared;
  if (input.bundle && typeof input.bundle === 'object') payload.bundle = input.bundle;
  return payload;
}

const ACTIONS: Record<string, ActionSpec> = {
  'write.bullet': {
    opType: 'create_rem',
    supportsAs: true,
    aliasRefAllowlist: ['parent_id'],
    compile: ({ input, aliasTempId }) => {
      const parent_id = input.parent_id;
      const text = input.text;
      if (typeof parent_id !== 'string' || !parent_id.trim()) {
        throw new Error('write.bullet requires input.parent_id');
      }
      if (typeof text !== 'string') {
        throw new Error('write.bullet requires input.text');
      }

      const payload: Record<string, unknown> = { parent_id, text };
      if (input.is_document === true) payload.is_document = true;
      if (Array.isArray(input.tags)) payload.tags = input.tags;
      if (aliasTempId) payload.client_temp_id = aliasTempId;

      return { ops: [{ type: 'create_rem', payload }] };
    },
  },

  'write.md': {
    opType: 'create_tree_with_markdown',
    supportsAs: false,
    aliasRefAllowlist: ['parent_id'],
    compile: ({ input }) => {
      const parent_id = input.parent_id;
      const markdown = input.markdown;
      if (typeof parent_id !== 'string' || !parent_id.trim()) {
        throw new Error('write.md requires input.parent_id');
      }
      if (typeof markdown !== 'string') {
        throw new Error('write.md requires input.markdown');
      }

      const payload: Record<string, unknown> = { parent_id, markdown };
      Object.assign(payload, buildMarkdownPayloadFields(input));
      if (typeof input.position === 'number') payload.position = input.position;

      return { ops: [{ type: 'create_tree_with_markdown', payload }] };
    },
  },

  'write.md.single': {
    opType: 'create_single_rem_with_markdown',
    supportsAs: true,
    aliasRefAllowlist: ['parent_id'],
    compile: ({ input, aliasTempId }) => {
      const parent_id = input.parent_id;
      const markdown = input.markdown;
      if (typeof parent_id !== 'string' || !parent_id.trim()) {
        throw new Error('write.md.single requires input.parent_id');
      }
      if (typeof markdown !== 'string') {
        throw new Error('write.md.single requires input.markdown');
      }
      const payload: Record<string, unknown> = { parent_id, markdown };
      if (aliasTempId) payload.client_temp_id = aliasTempId;
      return { ops: [{ type: 'create_single_rem_with_markdown', payload }] };
    },
  },

  'daily.write': {
    opType: 'daily_note_write',
    supportsAs: false,
    aliasRefAllowlist: [],
    compile: ({ input }) => {
      const payload: Record<string, unknown> = {};
      if (typeof input.text === 'string') payload.text = input.text;
      if (typeof input.markdown === 'string') payload.markdown = input.markdown;
      if (payload.text === undefined && payload.markdown === undefined) {
        throw new Error('daily.write requires input.text or input.markdown');
      }
      if (typeof input.date === 'string' || typeof input.date === 'number') payload.date = input.date;
      if (typeof input.offset_days === 'number') payload.offset_days = input.offset_days;
      if (typeof input.prepend === 'boolean') payload.prepend = input.prepend;
      if (typeof input.create_if_missing === 'boolean') payload.create_if_missing = input.create_if_missing;
      if (typeof input.position === 'number') payload.position = input.position;
      if (input.bundle && typeof input.bundle === 'object') payload.bundle = input.bundle;

      return { ops: [{ type: 'daily_note_write', payload }] };
    },
  },

  'rem.children.append': {
    opType: 'create_tree_with_markdown',
    supportsAs: false,
    aliasRefAllowlist: ['rem_id'],
    compile: ({ input }) => {
      const rem_id = input.rem_id;
      const markdown = input.markdown;
      if (typeof rem_id !== 'string' || !rem_id.trim()) {
        throw new Error('rem.children.append requires input.rem_id');
      }
      if (typeof markdown !== 'string') {
        throw new Error('rem.children.append requires input.markdown');
      }

      const payload: Record<string, unknown> = { parent_id: rem_id, markdown };
      Object.assign(payload, buildMarkdownPayloadFields(input));

      return { ops: [{ type: 'create_tree_with_markdown', payload }] };
    },
  },

  'rem.children.prepend': {
    opType: 'create_tree_with_markdown',
    supportsAs: false,
    aliasRefAllowlist: ['rem_id'],
    compile: ({ input }) => {
      const rem_id = input.rem_id;
      const markdown = input.markdown;
      if (typeof rem_id !== 'string' || !rem_id.trim()) {
        throw new Error('rem.children.prepend requires input.rem_id');
      }
      if (typeof markdown !== 'string') {
        throw new Error('rem.children.prepend requires input.markdown');
      }

      const payload: Record<string, unknown> = { parent_id: rem_id, markdown, position: 0 };
      Object.assign(payload, buildMarkdownPayloadFields(input));

      return { ops: [{ type: 'create_tree_with_markdown', payload }] };
    },
  },

  'rem.children.replace': {
    opType: 'replace_children_with_markdown',
    supportsAs: false,
    aliasRefAllowlist: ['rem_id'],
    compile: ({ input }) => {
      const rem_id = input.rem_id;
      const markdown = input.markdown;
      if (typeof rem_id !== 'string' || !rem_id.trim()) {
        throw new Error('rem.children.replace requires input.rem_id');
      }
      if (typeof markdown !== 'string') {
        throw new Error('rem.children.replace requires input.markdown');
      }

      const payload: Record<string, unknown> = { parent_id: rem_id, markdown };
      Object.assign(payload, buildMarkdownPayloadFields(input));
      if (typeof input.backup === 'string') payload.backup = input.backup;
      if (Array.isArray(input.assertions)) payload.assertions = input.assertions;

      return { ops: [{ type: 'replace_children_with_markdown', payload }] };
    },
  },

  'rem.children.clear': {
    opType: 'replace_children_with_markdown',
    supportsAs: false,
    aliasRefAllowlist: ['rem_id'],
    compile: ({ input }) => {
      const rem_id = input.rem_id;
      if (typeof rem_id !== 'string' || !rem_id.trim()) {
        throw new Error('rem.children.clear requires input.rem_id');
      }

      return { ops: [{ type: 'replace_children_with_markdown', payload: { parent_id: rem_id, markdown: '' } }] };
    },
  },

  rem: {
    // Namespace placeholder to provide a better error message for common typos.
    opType: '',
    supportsAs: false,
    aliasRefAllowlist: [],
    compile: () => {
      throw new Error('Invalid action: rem (did you mean rem.updateText?)');
    },
  },

  'rem.updateText': {
    opType: 'update_text',
    supportsAs: false,
    aliasRefAllowlist: ['rem_id'],
    compile: ({ input }) => {
      const rem_id = input.rem_id;
      if (typeof rem_id !== 'string' || !rem_id.trim()) {
        throw new Error('rem.updateText requires input.rem_id');
      }
      if (input.text === undefined) {
        throw new Error('rem.updateText requires input.text');
      }
      const payload: Record<string, unknown> = { rem_id, text: input.text };
      return { ops: [{ type: 'update_text', payload }] };
    },
  },

  'replace.block': {
    opType: 'replace_selection_with_markdown',
    supportsAs: false,
    aliasRefAllowlist: ['target.rem_ids[]', 'portal_id'],
    compile: ({ input }) => {
      const markdown = input.markdown;
      if (typeof markdown !== 'string') {
        throw new Error('replace.block requires input.markdown');
      }
      const target = getObject(input.target);
      const mode = typeof target?.mode === 'string' ? target.mode : '';
      if (mode !== 'explicit') {
        throw new Error("replace.block requires input.target.mode='explicit'");
      }
      const remIdsRaw = (target as any)?.rem_ids;
      if (!Array.isArray(remIdsRaw) || remIdsRaw.length === 0) {
        throw new Error('replace.block requires input.target.rem_ids[]');
      }
      const payload: Record<string, unknown> = {
        markdown,
        target: { mode: 'explicit', rem_ids: remIdsRaw },
      };
      if (typeof input.require_same_parent === 'boolean') payload.require_same_parent = input.require_same_parent;
      if (typeof input.require_contiguous === 'boolean') payload.require_contiguous = input.require_contiguous;
      if (typeof input.portal_id === 'string') payload.portal_id = input.portal_id;

      return { ops: [{ type: 'replace_selection_with_markdown', payload }] };
    },
  },

  'tag.add': {
    opType: 'add_tag',
    supportsAs: false,
    aliasRefAllowlist: ['rem_id', 'tag_id'],
    compile: ({ input }) => {
      const rem_id = input.rem_id;
      const tag_id = input.tag_id;
      if (typeof rem_id !== 'string' || !rem_id.trim()) {
        throw new Error('tag.add requires input.rem_id');
      }
      if (typeof tag_id !== 'string' || !tag_id.trim()) {
        throw new Error('tag.add requires input.tag_id');
      }
      const payload: Record<string, unknown> = { rem_id, tag_id };
      return { ops: [{ type: 'add_tag', payload }] };
    },
  },
};

export function parseWritePlanV1(raw: unknown): WritePlanV1 {
  const obj = getObject(raw);
  const version = obj?.version;
  if (version !== 1) {
    throw new Error('Invalid plan version (expected version=1)');
  }
  const steps = obj?.steps;
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new Error('Invalid plan shape: steps must be a non-empty array');
  }

  const parsedSteps: WritePlanStepV1[] = [];
  for (let i = 0; i < steps.length; i += 1) {
    const s = getObject(steps[i]);
    if (!s) throw new Error(`Invalid step at index ${i}: expected an object`);
    const action = s.action;
    const input = s.input;
    if (typeof action !== 'string' || !action.trim()) throw new Error(`Invalid step.action at index ${i}`);
    const inputObj = getObject(input);
    if (!inputObj) throw new Error(`Invalid step.input at index ${i}: expected an object`);
    const as = s.as;
    if (as !== undefined && !isAlias(as)) {
      throw new Error(`Invalid step.as at index ${i}: must match ${ALIAS_RE.source}`);
    }
    parsedSteps.push({ action: action.trim(), input: inputObj, ...(as ? { as } : {}) });
  }

  return { version: 1, steps: parsedSteps };
}

export function compileWritePlanV1(
  plan: WritePlanV1,
  params: { readonly makeTempId: () => string },
): CompiledWritePlan {
  const aliasMap: Record<Alias, string> = {};
  for (let i = 0; i < plan.steps.length; i += 1) {
    const as = plan.steps[i]?.as;
    if (!as) continue;
    if (aliasMap[as]) throw new Error(`Duplicate alias: ${as}`);
    aliasMap[as] = params.makeTempId();
  }

  const ops: Array<{ type: string; payload: Record<string, unknown> }> = [];

  for (let i = 0; i < plan.steps.length; i += 1) {
    const step = plan.steps[i]!;
    const spec = ACTIONS[step.action];
    if (!spec) throw new Error(`Unsupported action: ${step.action}`);
    if (step.as && !spec.supportsAs) {
      throw new Error(`Action does not support 'as': ${step.action}`);
    }

    const refs = collectAliasRefs(step.input, '');
    for (const r of refs) {
      if (!aliasMap[r.alias]) {
        throw new Error(`Unknown alias reference: @${r.alias}`);
      }
      if (!spec.aliasRefAllowlist.includes(r.path)) {
        throw new Error(`Alias references are not allowed at ${r.path} for action ${step.action}`);
      }
    }

    const resolvedInput = resolveAliasRefsInValue(step.input, aliasMap) as Record<string, unknown>;
    const aliasTempId = step.as ? aliasMap[step.as] : undefined;
    const compiled = spec.compile({ input: resolvedInput, aliasTempId });
    for (const op of compiled.ops) {
      ops.push({ type: op.type, payload: op.payload });
    }
  }

  if (ops.length > 500) {
    throw new Error(`Plan compiled into too many ops (${ops.length}); split it and try again`);
  }

  return { alias_map: aliasMap, ops };
}
