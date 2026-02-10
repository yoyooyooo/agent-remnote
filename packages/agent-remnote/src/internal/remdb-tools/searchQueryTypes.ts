import { z } from 'zod';

export const attributeOperatorSchema = z.enum([
  'equals',
  'notEquals',
  'contains',
  'notContains',
  'greaterThan',
  'greaterThanOrEquals',
  'lessThan',
  'lessThanOrEquals',
  'between',
  'empty',
  'notEmpty',
  'before',
  'after',
  'on',
  'relative',
]);

const numericValueSchema = z.number();
const stringValueSchema = z.string();
const booleanValueSchema = z.boolean();
const dateValueSchema = z.union([z.string(), z.number()]);

const attributeConditionSchema = z.object({
  type: z.literal('attribute'),
  attributeId: z.string().min(1, 'attributeId is required'),
  operator: attributeOperatorSchema,
  value: z.union([stringValueSchema, numericValueSchema, booleanValueSchema]).optional(),
  values: z.array(z.union([stringValueSchema, numericValueSchema])).optional(),
  range: z
    .object({
      start: z.union([stringValueSchema, numericValueSchema, dateValueSchema]).optional(),
      end: z.union([stringValueSchema, numericValueSchema, dateValueSchema]).optional(),
    })
    .optional(),
  unit: z.string().optional(),
  relativeAmount: z.number().optional(),
  includeEmpty: z.boolean().optional(),
});

const textConditionSchema = z.object({
  type: z.literal('text'),
  value: z.string().min(1, 'text value is required'),
  mode: z.enum(['contains', 'phrase', 'prefix', 'suffix']).default('contains'),
});

const tagConditionSchema = z.object({
  type: z.literal('tag'),
  id: z.string().min(1, 'tag id is required'),
  includeDescendants: z.boolean().optional(),
});

const remConditionSchema = z.object({
  type: z.literal('rem'),
  id: z.string().min(1, 'rem id is required'),
});

const pageConditionSchema = z.object({
  type: z.literal('page'),
});

export type AttributeOperator = z.infer<typeof attributeOperatorSchema>;
export type AttributeCondition = z.infer<typeof attributeConditionSchema>;
export type TextCondition = z.infer<typeof textConditionSchema>;
export type TagCondition = z.infer<typeof tagConditionSchema>;
export type RemCondition = z.infer<typeof remConditionSchema>;
export type PageCondition = z.infer<typeof pageConditionSchema>;

const queryNodeSchemaInternal: z.ZodTypeAny = z.lazy(() =>
  z.union([
    attributeConditionSchema,
    textConditionSchema,
    tagConditionSchema,
    remConditionSchema,
    pageConditionSchema,
    z.object({ type: z.literal('not'), node: queryNodeSchemaInternal }),
    z.object({
      type: z.union([z.literal('and'), z.literal('or')]),
      nodes: z.array(queryNodeSchemaInternal).min(1, 'logical node requires at least one child'),
    }),
  ]),
);

export type QueryLeaf = AttributeCondition | TextCondition | TagCondition | RemCondition | PageCondition;

export type QueryNode =
  | QueryLeaf
  | { type: 'and'; nodes: QueryNode[] }
  | { type: 'or'; nodes: QueryNode[] }
  | { type: 'not'; node: QueryNode };

export const queryNodeSchema = queryNodeSchemaInternal as z.ZodType<QueryNode>;

export const sortModeSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('rank') }),
  z.object({ mode: z.literal('updatedAt'), direction: z.enum(['asc', 'desc']).default('desc') }),
  z.object({ mode: z.literal('createdAt'), direction: z.enum(['asc', 'desc']).default('desc') }),
  z.object({
    mode: z.literal('attribute'),
    attributeId: z.string().min(1, 'attributeId is required for attribute sort'),
    direction: z.enum(['asc', 'desc']).default('asc'),
  }),
]);

export type SortMode = z.infer<typeof sortModeSchema>;

export function normalizeQueryNode(node: QueryNode): QueryNode {
  if (node.type === 'and' || node.type === 'or') {
    const normalizedChildren = node.nodes.map((child) => normalizeQueryNode(child));
    const flatChildren: QueryNode[] = [];
    for (const child of normalizedChildren) {
      if (child.type === node.type) {
        flatChildren.push(...child.nodes);
      } else if (child.type === 'and' || child.type === 'or') {
        flatChildren.push(child);
      } else {
        flatChildren.push(child);
      }
    }
    if (flatChildren.length === 1) {
      return flatChildren[0];
    }
    return { type: node.type, nodes: flatChildren };
  }
  if (node.type === 'not') {
    return { type: 'not', node: normalizeQueryNode(node.node) };
  }
  return node;
}

export function describeQueryNode(node: QueryNode): string {
  switch (node.type) {
    case 'text':
      return `text contains "${node.value}"`;
    case 'tag':
      return `has tag ${node.id}`;
    case 'rem':
      return `target rem is ${node.id}`;
    case 'page':
      return 'top-level page (parent=null)';
    case 'attribute':
      return `attribute ${node.attributeId} ${node.operator}`;
    case 'not':
      return `not (${describeQueryNode(node.node)})`;
    case 'and':
      return node.nodes.map(describeQueryNode).join(' AND ');
    case 'or':
      return node.nodes.map(describeQueryNode).join(' OR ');
    default:
      return '';
  }
}
