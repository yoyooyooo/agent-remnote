export type OpCatalogEntry = {
  readonly op_type: string;
  readonly aliases?: readonly string[];
  readonly payload: {
    readonly required: readonly string[];
    readonly optional: readonly string[];
  };
  readonly description?: string;
  readonly id_fields?: readonly string[];
};

export const OP_CATALOG: Record<string, OpCatalogEntry> = {
  // Rem CRUD
  create_rem: {
    op_type: 'create_rem',
    aliases: ['rem.create'],
    payload: {
      required: ['parent_id'],
      optional: ['text', 'tags', 'is_document', 'position', 'client_temp_id'],
    },
    description: 'Create a Rem (parent required).',
    id_fields: ['parent_id', 'tags[]'],
  },

  create_portal: {
    op_type: 'create_portal',
    aliases: ['portal.create', 'rem.createPortal'],
    payload: {
      required: ['parent_id', 'target_rem_id'],
      optional: ['position', 'client_temp_id'],
    },
    description: 'Create a portal under parent that directly includes target_rem_id.',
    id_fields: ['parent_id', 'target_rem_id'],
  },

  create_link_rem: {
    op_type: 'create_link_rem',
    aliases: ['rem.createLink'],
    payload: {
      required: ['url', 'parent_id'],
      optional: ['add_title', 'client_temp_id'],
    },
    description: 'Create a link Rem (parent required).',
    id_fields: ['parent_id'],
  },

  update_text: {
    op_type: 'update_text',
    aliases: ['rem.updateText'],
    payload: { required: ['rem_id', 'text'], optional: [] },
    description: 'Update Rem text.',
    id_fields: ['rem_id'],
  },

  move_rem: {
    op_type: 'move_rem',
    aliases: ['rem.move'],
    payload: { required: ['rem_id', 'new_parent_id'], optional: ['position'] },
    description: 'Move a Rem to a new parent.',
    id_fields: ['rem_id', 'new_parent_id'],
  },

  delete_rem: {
    op_type: 'delete_rem',
    aliases: ['rem.delete'],
    payload: { required: ['rem_id'], optional: [] },
    description: 'Delete a Rem.',
    id_fields: ['rem_id'],
  },

  // Markdown ops
  create_single_rem_with_markdown: {
    op_type: 'create_single_rem_with_markdown',
    aliases: ['rem.createSingleWithMarkdown'],
    payload: { required: ['parent_id', 'markdown'], optional: ['client_temp_id'] },
    description: 'Create a single Rem from Markdown (parent required).',
    id_fields: ['parent_id'],
  },

  create_tree_with_markdown: {
    op_type: 'create_tree_with_markdown',
    aliases: ['rem.createTreeWithMarkdown'],
    payload: {
      required: ['parent_id', 'markdown'],
      optional: [
        'position',
        'indent_mode',
        'indent_size',
        'parse_mode',
        'prepared',
        'client_temp_ids',
        'bundle',
      ],
    },
    description: 'Create a tree from Markdown (parent required).',
    id_fields: ['parent_id'],
  },

  replace_selection_with_markdown: {
    op_type: 'replace_selection_with_markdown',
    payload: {
      required: ['markdown'],
      optional: ['target', 'require_same_parent', 'require_contiguous', 'portal_id'],
    },
    description: 'Replace a selection of Rems with Markdown.',
    id_fields: ['target.rem_ids[]', 'portal_id'],
  },

  // Daily note
  daily_note_write: {
    op_type: 'daily_note_write',
    payload: {
      required: [],
      optional: ['text', 'markdown', 'date', 'offset_days', 'prepend', 'position', 'bundle'],
    },
    description: 'Write to Daily Note.',
    id_fields: [],
  },

  // Tags / attributes
  add_tag: {
    op_type: 'add_tag',
    aliases: ['tag.add'],
    payload: { required: ['rem_id', 'tag_id'], optional: [] },
    description: 'Add a tag to a Rem.',
    id_fields: ['rem_id', 'tag_id'],
  },

  remove_tag: {
    op_type: 'remove_tag',
    aliases: ['tag.remove'],
    payload: { required: ['rem_id', 'tag_id'], optional: ['remove_properties'] },
    description: 'Remove a tag from a Rem.',
    id_fields: ['rem_id', 'tag_id'],
  },

  set_attribute: {
    op_type: 'set_attribute',
    aliases: ['attribute.set'],
    payload: { required: ['rem_id', 'property_id'], optional: ['value'] },
    description: 'Set an attribute value (RichText).',
    id_fields: ['rem_id', 'property_id'],
  },

  table_cell_write: {
    op_type: 'table_cell_write',
    aliases: ['table.cellWrite'],
    payload: { required: ['rem_id', 'property_id'], optional: ['value'] },
    description: 'Write text/RichText into a table cell (alias of set_attribute).',
    id_fields: ['rem_id', 'property_id'],
  },

  // Tables / properties / options
  create_table: {
    op_type: 'create_table',
    aliases: ['table.create'],
    payload: { required: ['parent_id'], optional: ['tag_id', 'position', 'client_temp_id'] },
    description: 'Create a table (parent required; optional header Tag).',
    id_fields: ['parent_id', 'tag_id'],
  },

  add_property: {
    op_type: 'add_property',
    aliases: ['property.add'],
    payload: { required: ['tag_id'], optional: ['name', 'property_id', 'type', 'options'] },
    description: 'Add a property under a table header Tag.',
    id_fields: ['tag_id'],
  },

  set_property_type: {
    op_type: 'set_property_type',
    aliases: ['property.setType'],
    payload: { required: ['property_id', 'type'], optional: [] },
    description: 'Set property type.',
    id_fields: ['property_id'],
  },

  set_table_filter: {
    op_type: 'set_table_filter',
    aliases: ['table.setFilter'],
    payload: { required: ['table_id'], optional: ['column_id', 'contains_text', 'expr'] },
    description: 'Set a table filter (Query expression).',
    id_fields: ['table_id', 'column_id'],
  },

  add_option: {
    op_type: 'add_option',
    aliases: ['option.add'],
    payload: { required: ['property_id', 'text'], optional: ['option_id'] },
    description: 'Add an option under a property.',
    id_fields: ['property_id'],
  },

  remove_option: {
    op_type: 'remove_option',
    aliases: ['option.remove'],
    payload: { required: ['option_id'], optional: [] },
    description: 'Remove an option.',
    id_fields: ['option_id'],
  },

  // Table records / cells
  table_add_row: {
    op_type: 'table_add_row',
    aliases: ['table.addRow'],
    payload: {
      required: ['table_tag_id'],
      optional: ['parent_id', 'rem_id', 'text', 'client_temp_id', 'values', 'extra_tags'],
    },
    description: 'Add a row to a table (tag a Rem, optionally creating a new one).',
    id_fields: ['table_tag_id', 'parent_id', 'rem_id', 'extra_tags[]'],
  },

  table_remove_row: {
    op_type: 'table_remove_row',
    aliases: ['table.removeRow'],
    payload: { required: ['table_tag_id', 'rem_id'], optional: ['remove_properties'] },
    description: 'Remove a row tag from a table.',
    id_fields: ['table_tag_id', 'rem_id'],
  },

  set_cell_select: {
    op_type: 'set_cell_select',
    aliases: ['cell.setSelect'],
    payload: { required: ['rem_id', 'property_id', 'option_ids'], optional: [] },
    description: 'Set a select/multi-select cell value.',
    id_fields: ['rem_id', 'property_id', 'option_ids', 'option_ids[]'],
  },

  set_cell_checkbox: {
    op_type: 'set_cell_checkbox',
    aliases: ['cell.setCheckbox'],
    payload: { required: ['rem_id', 'property_id', 'value'], optional: [] },
    description: 'Set a checkbox cell value.',
    id_fields: ['rem_id', 'property_id'],
  },

  set_cell_number: {
    op_type: 'set_cell_number',
    aliases: ['cell.setNumber'],
    payload: { required: ['rem_id', 'property_id', 'value'], optional: [] },
    description: 'Set a number cell value.',
    id_fields: ['rem_id', 'property_id'],
  },

  set_cell_date: {
    op_type: 'set_cell_date',
    aliases: ['cell.setDate'],
    payload: { required: ['rem_id', 'property_id', 'value'], optional: [] },
    description: 'Set a date cell value (requires the Daily doc to exist).',
    id_fields: ['rem_id', 'property_id'],
  },

  // Misc
  add_source: {
    op_type: 'add_source',
    aliases: ['source.add'],
    payload: { required: ['rem_id', 'source_id'], optional: [] },
    description: 'Add a source link to a Rem.',
    id_fields: ['rem_id', 'source_id'],
  },

  remove_source: {
    op_type: 'remove_source',
    aliases: ['source.remove'],
    payload: { required: ['rem_id', 'source_id'], optional: [] },
    description: 'Remove a source link from a Rem.',
    id_fields: ['rem_id', 'source_id'],
  },

  set_todo_status: {
    op_type: 'set_todo_status',
    aliases: ['todo.setStatus'],
    payload: { required: ['rem_id', 'status'], optional: [] },
    description: 'Set todo completion status.',
    id_fields: ['rem_id'],
  },
} as const;
