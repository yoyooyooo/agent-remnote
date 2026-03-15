export type Alias = string;

export type WriteStructureAssertion = 'single-root' | 'preserve-anchor' | 'no-literal-bullet';
export type OutlineWriteShape = 'normal' | 'single_root_outline' | 'expand_in_place';

export type WritePlanV1 = {
  readonly version: 1;
  readonly steps: readonly WritePlanStepV1[];
};

export type WritePlanStepV1 = {
  readonly as?: Alias;
  readonly action: string;
  readonly input: Record<string, unknown>;
};

export type CompiledWritePlan = {
  readonly alias_map: Readonly<Record<Alias, string>>;
  readonly ops: ReadonlyArray<{
    readonly type: string;
    readonly payload: Record<string, unknown>;
  }>;
};
