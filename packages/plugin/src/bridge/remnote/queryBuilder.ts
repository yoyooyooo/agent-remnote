export type QueryExpr = any;

export function buildQuery(sdk: any, expr: QueryExpr): any {
  if (!expr || typeof expr !== 'object') return null;
  const { Query, TextMatcher, NumberMatcher, DateMatcher, SingleSelectMatcher, MultiSelectMatcher, CheckboxMatcher } =
    sdk || {};
  if (!Query) return null;
  switch (expr.op) {
    case 'and': {
      const parts = Array.isArray(expr.exprs) ? expr.exprs.map((e: any) => buildQuery(sdk, e)).filter(Boolean) : [];
      return Query.and(parts as any);
    }
    case 'or': {
      const parts = Array.isArray(expr.exprs) ? expr.exprs.map((e: any) => buildQuery(sdk, e)).filter(Boolean) : [];
      return Query.or(parts as any);
    }
    case 'not': {
      const inner = buildQuery(sdk, expr.expr);
      return Query.not(inner);
    }
    case 'column_text_contains': {
      if (!expr.column_id) return null;
      return Query.tableColumn(expr.column_id, Query.text(TextMatcher.Contains, String(expr.value ?? '')));
    }
    case 'column_text_prefix': {
      if (!expr.column_id) return null;
      return Query.tableColumn(expr.column_id, Query.text(TextMatcher.Prefix, String(expr.value ?? '')));
    }
    case 'column_text_suffix': {
      if (!expr.column_id) return null;
      return Query.tableColumn(expr.column_id, Query.text(TextMatcher.Suffix, String(expr.value ?? '')));
    }
    case 'column_text_phrase': {
      if (!expr.column_id) return null;
      return Query.tableColumn(expr.column_id, Query.text(TextMatcher.Phrase, String(expr.value ?? '')));
    }
    case 'column_number': {
      if (!expr.column_id || typeof (Query as any).number !== 'function') return null;
      const matcher = NumberMatcher[expr.matcher as keyof typeof NumberMatcher] ?? NumberMatcher.Equals;
      const arg =
        expr.value ?? (typeof expr.min === 'number' && typeof expr.max === 'number' ? [expr.min, expr.max] : undefined);
      return Query.tableColumn(expr.column_id, (Query as any).number(matcher, arg));
    }
    case 'column_date': {
      if (!expr.column_id || typeof (Query as any).date !== 'function') return null;
      const matcher = DateMatcher[expr.matcher as keyof typeof DateMatcher] ?? DateMatcher.Equals;
      let arg: any = expr.value;
      if (matcher === (DateMatcher as any).Between || matcher === (DateMatcher as any).IsBetween) {
        if (expr.from && expr.to) arg = { from: expr.from, to: expr.to };
        else return null;
      }
      return Query.tableColumn(expr.column_id, (Query as any).date(matcher, arg));
    }
    case 'column_single_select_in': {
      if (!expr.column_id || typeof (Query as any).singleSelect !== 'function') return null;
      const matcher = SingleSelectMatcher?.In ?? SingleSelectMatcher?.Equals ?? undefined;
      return Query.tableColumn(
        expr.column_id,
        (Query as any).singleSelect(matcher, Array.isArray(expr.option_ids) ? expr.option_ids : [expr.option_ids]),
      );
    }
    case 'column_multi_select_contains_any': {
      if (!expr.column_id || typeof (Query as any).multiSelect !== 'function') return null;
      const matcher = MultiSelectMatcher?.ContainsAny ?? MultiSelectMatcher?.Contains ?? undefined;
      return Query.tableColumn(
        expr.column_id,
        (Query as any).multiSelect(matcher, Array.isArray(expr.option_ids) ? expr.option_ids : [expr.option_ids]),
      );
    }
    case 'column_multi_select_contains_all': {
      if (!expr.column_id || typeof (Query as any).multiSelect !== 'function') return null;
      const matcher = MultiSelectMatcher?.ContainsAll ?? MultiSelectMatcher?.Contains ?? undefined;
      return Query.tableColumn(
        expr.column_id,
        (Query as any).multiSelect(matcher, Array.isArray(expr.option_ids) ? expr.option_ids : [expr.option_ids]),
      );
    }
    case 'column_checkbox_equals': {
      if (!expr.column_id || typeof (Query as any).checkbox !== 'function') return null;
      const matcher = CheckboxMatcher?.Equals ?? CheckboxMatcher?.Is ?? undefined;
      return Query.tableColumn(expr.column_id, (Query as any).checkbox(matcher, !!expr.value));
    }
    default:
      return null;
  }
}
