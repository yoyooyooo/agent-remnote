export type TableValueInput = {
  readonly property_id?: unknown;
  readonly property_name?: unknown;
  readonly value: unknown;
};

export type TablePropertyDef = {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly options?: readonly { readonly id: string; readonly name: string }[] | undefined;
};

export type CompiledOp = {
  readonly type: string;
  readonly payload: Record<string, unknown>;
};

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  return s.length > 0 ? s : null;
}

function normalizeName(value: string): string {
  return value.trim();
}

function normalizeNameLoose(value: string): string {
  return value.trim().toLowerCase();
}

function resolvePropertyId(input: TableValueInput, properties: readonly TablePropertyDef[]): string {
  const propertyId = asNonEmptyString(input.property_id);
  if (propertyId) return propertyId;

  const propertyName = asNonEmptyString(input.property_name);
  if (!propertyName) {
    throw new Error('Each values[] item must include propertyId or propertyName');
  }

  const exact = properties.filter((p) => normalizeName(p.name) === normalizeName(propertyName));
  if (exact.length === 1) return exact[0]!.id;
  if (exact.length > 1) {
    throw new Error(`Ambiguous propertyName "${propertyName}" (matched ${exact.length} properties). Use propertyId instead.`);
  }

  const loose = properties.filter((p) => normalizeNameLoose(p.name) === normalizeNameLoose(propertyName));
  if (loose.length === 1) return loose[0]!.id;
  if (loose.length > 1) {
    throw new Error(`Ambiguous propertyName "${propertyName}" (matched ${loose.length} properties). Use propertyId instead.`);
  }

  throw new Error(`Unknown propertyName "${propertyName}". Use propertyId instead.`);
}

function resolvePropertyDef(propertyId: string, properties: readonly TablePropertyDef[]): TablePropertyDef | null {
  for (const p of properties) {
    if (p.id === propertyId) return p;
  }
  return null;
}

function coerceBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === 'string') {
    const s = value.trim().toLowerCase();
    if (s === 'true' || s === 'yes' || s === 'y' || s === '1') return true;
    if (s === 'false' || s === 'no' || s === 'n' || s === '0') return false;
  }
  throw new Error('Expected a boolean for checkbox values');
}

function coerceSelectInput(value: unknown): readonly string[] {
  if (value == null) return [];
  if (Array.isArray(value)) {
    const out: string[] = [];
    for (const v of value) {
      const s = asNonEmptyString(v);
      if (!s) throw new Error('select/multi_select values must be strings (optionId/optionName)');
      out.push(s);
    }
    return out;
  }
  const s = asNonEmptyString(value);
  if (!s) throw new Error('select/multi_select values must be strings (optionId/optionName)');
  return [s];
}

function resolveOptionIds(inputValues: readonly string[], property: TablePropertyDef): readonly string[] {
  const options = property.options ?? [];
  if (options.length === 0) {
    throw new Error(
      `Cannot resolve optionName without options for propertyId=${property.id}. Provide optionId(s) instead.`,
    );
  }

  const ids: string[] = [];
  for (const raw of inputValues) {
    const v = raw.trim();
    if (!v) continue;

    const byId = options.find((o) => o.id === v);
    if (byId) {
      ids.push(byId.id);
      continue;
    }

    const exact = options.filter((o) => normalizeName(o.name) === normalizeName(v));
    if (exact.length === 1) {
      ids.push(exact[0]!.id);
      continue;
    }
    if (exact.length > 1) {
      throw new Error(`Ambiguous optionName "${v}" (matched ${exact.length} options). Use optionId(s) instead.`);
    }

    const loose = options.filter((o) => normalizeNameLoose(o.name) === normalizeNameLoose(v));
    if (loose.length === 1) {
      ids.push(loose[0]!.id);
      continue;
    }
    if (loose.length > 1) {
      throw new Error(`Ambiguous optionName "${v}" (matched ${loose.length} options). Use optionId(s) instead.`);
    }

    throw new Error(`Unknown optionName "${v}". Use optionId(s) instead.`);
  }
  return ids;
}

function validateDateObject(value: any): { readonly year: number; readonly month: number; readonly day: number } {
  const year = Number(value?.year);
  const month = Number(value?.month);
  const day = Number(value?.day);
  if (!Number.isFinite(year) || !Number.isInteger(year) || year < 1900 || year > 3000) {
    throw new Error('Invalid date: year must be an integer in [1900, 3000]');
  }
  if (!Number.isFinite(month) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error('Invalid date: month must be an integer in [1, 12]');
  }
  if (!Number.isFinite(day) || !Number.isInteger(day) || day < 1 || day > 31) {
    throw new Error('Invalid date: day must be an integer in [1, 31]');
  }
  return { year, month, day };
}

function normalizeDateValue(value: unknown): string | number | { year: number; month: number; day: number } {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value && typeof value === 'object' && !Array.isArray(value)) return validateDateObject(value);
  throw new Error('Expected date value as ISO string, timestamp, or {year,month,day}');
}

export function parseValuesArrayOnly(raw: unknown): readonly TableValueInput[] {
  if (!Array.isArray(raw)) {
    throw new Error('Invalid values: expected an array like [{ propertyId?, propertyName?, value }]');
  }
  const out: TableValueInput[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const v = raw[i];
    if (!v || typeof v !== 'object' || Array.isArray(v)) {
      throw new Error(`Invalid values[${i}]: expected an object`);
    }
    const obj = v as any;
    out.push({
      property_id: obj.property_id ?? obj.propertyId,
      property_name: obj.property_name ?? obj.propertyName,
      value: obj.value,
    });
  }
  return out;
}

export function compileTableValueOps(params: {
  readonly rowRemId: string;
  readonly tableTagId: string;
  readonly values: readonly TableValueInput[];
  readonly properties: readonly TablePropertyDef[];
}): readonly CompiledOp[] {
  const ops: CompiledOp[] = [];

  for (let i = 0; i < params.values.length; i += 1) {
    const item = params.values[i]!;
    const propertyId = resolvePropertyId(item, params.properties);
    const prop = resolvePropertyDef(propertyId, params.properties);
    const kind = prop?.kind ?? 'unknown';

    switch (kind) {
      case 'select': {
        const ids = resolveOptionIds(coerceSelectInput(item.value), prop!);
        const payload: Record<string, unknown> = {
          rem_id: params.rowRemId,
          property_id: propertyId,
          option_ids: ids.length === 0 ? [] : ids[0]!,
        };
        ops.push({ type: 'set_cell_select', payload });
        break;
      }
      case 'multi_select': {
        const ids = resolveOptionIds(coerceSelectInput(item.value), prop!);
        const payload: Record<string, unknown> = {
          rem_id: params.rowRemId,
          property_id: propertyId,
          option_ids: ids,
        };
        ops.push({ type: 'set_cell_select', payload });
        break;
      }
      case 'checkbox': {
        const payload: Record<string, unknown> = {
          rem_id: params.rowRemId,
          property_id: propertyId,
          value: coerceBoolean(item.value),
        };
        ops.push({ type: 'set_cell_checkbox', payload });
        break;
      }
      case 'number': {
        if (item.value == null) {
          throw new Error('number values cannot be null');
        }
        if (typeof item.value !== 'number' && typeof item.value !== 'string') {
          throw new Error('Expected a number (or numeric string) for number values');
        }
        const payload: Record<string, unknown> = {
          rem_id: params.rowRemId,
          property_id: propertyId,
          value: item.value,
        };
        ops.push({ type: 'set_cell_number', payload });
        break;
      }
      case 'date': {
        const payload: Record<string, unknown> = {
          rem_id: params.rowRemId,
          property_id: propertyId,
          value: normalizeDateValue(item.value),
        };
        ops.push({ type: 'set_cell_date', payload });
        break;
      }
      case 'text':
      default: {
        const payload: Record<string, unknown> = {
          rem_id: params.rowRemId,
          property_id: propertyId,
          value: item.value,
        };
        ops.push({ type: 'set_attribute', payload });
        break;
      }
    }
  }

  return ops;
}
