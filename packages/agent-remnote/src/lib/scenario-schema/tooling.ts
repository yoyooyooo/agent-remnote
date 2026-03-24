import {
  explainScenarioPackage,
  generateScenarioPackageFromHint,
  normalizeScenarioPackage,
  ScenarioSharedError,
  validateScenarioPackage,
  type ScenarioPackageInput,
  type ScenarioSchemaToolResult,
} from '../scenario-shared/index.js';

type ExplainParams = {
  readonly packageInput: unknown;
  readonly vars?: Record<string, unknown> | undefined;
};

function baseResult(
  subcommand: ScenarioSchemaToolResult['subcommand'],
  ok: boolean,
  extras: Omit<ScenarioSchemaToolResult, 'tool' | 'subcommand' | 'schema_version' | 'ok' | 'errors' | 'warnings' | 'hints'> & {
    readonly errors?: readonly string[];
    readonly warnings?: readonly string[];
    readonly hints?: readonly string[];
  },
): ScenarioSchemaToolResult {
  return {
    tool: 'scenario.schema',
    subcommand,
    schema_version: 1,
    ok,
    errors: extras.errors ?? [],
    warnings: extras.warnings ?? [],
    hints: extras.hints ?? [],
    ...(extras.diagnostics ? { diagnostics: extras.diagnostics } : {}),
    ...(extras.normalized_package ? { normalized_package: extras.normalized_package } : {}),
    ...(extras.changes ? { changes: extras.changes } : {}),
    ...(extras.summary ? { summary: extras.summary } : {}),
    ...(extras.required_vars ? { required_vars: extras.required_vars } : {}),
    ...(extras.capabilities ? { capabilities: extras.capabilities } : {}),
    ...(extras.selector_preview ? { selector_preview: extras.selector_preview } : {}),
    ...(extras.action_preview ? { action_preview: extras.action_preview } : {}),
    ...(extras.execution_outline ? { execution_outline: extras.execution_outline } : {}),
    ...(extras.generated_package ? { generated_package: extras.generated_package } : {}),
    ...(extras.inputs_used ? { inputs_used: extras.inputs_used } : {}),
    ...(extras.assumptions ? { assumptions: extras.assumptions } : {}),
  };
}

export function runScenarioSchemaValidate(packageInput: unknown): ScenarioSchemaToolResult {
  const result = validateScenarioPackage(packageInput);
  return baseResult('validate', result.ok, {
    errors: result.errors,
    warnings: result.warnings,
    hints: result.hints,
    diagnostics: result.diagnostics,
  });
}

export function runScenarioSchemaNormalize(packageInput: unknown): ScenarioSchemaToolResult {
  const result = normalizeScenarioPackage(packageInput);
  return baseResult('normalize', result.ok, {
    errors: result.errors,
    warnings: result.warnings,
    hints: result.hints,
    diagnostics: result.diagnostics,
    normalized_package: result.package,
    changes: result.changes,
  });
}

export function runScenarioSchemaExplain(params: ExplainParams): ScenarioSchemaToolResult {
  const varSpecs = Object.entries(params.vars ?? {}).map(([key, value]) => `${key}=${String(value)}`);
  const result = explainScenarioPackage(params.packageInput, varSpecs);
  return baseResult('explain', result.ok, {
    errors: result.errors,
    warnings: result.warnings,
    hints: result.hints,
    diagnostics: result.diagnostics,
    summary: result.summary,
    required_vars: result.requiredVars,
    capabilities: result.capabilities,
    selector_preview: result.selectorPreview,
    action_preview: result.actionPreview,
    execution_outline: result.executionOutline,
  });
}

export function runScenarioSchemaGenerate(hintInput: unknown): ScenarioSchemaToolResult {
  let result;
  try {
    result = generateScenarioPackageFromHint(hintInput);
  } catch (error) {
    if (error instanceof ScenarioSharedError) {
      return baseResult('generate', false, {
        errors: [error.message],
        warnings: [],
        hints: [],
      });
    }
    throw error;
  }
  return baseResult('generate', true, {
    warnings: result.warnings,
    hints: result.hints,
    diagnostics: result.diagnostics,
    generated_package: result.package as ScenarioPackageInput,
    inputs_used: result.inputsUsed,
    assumptions: result.assumptions,
  });
}
