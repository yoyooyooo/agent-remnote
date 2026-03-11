// Normalize different op_type naming styles (dot/camelCase -> snake_case).
export function mapOpType(input: string): string {
  const t = String(input || '');
  const alias: Record<string, string> = {
    // Rem basics
    'rem.create': 'create_rem',
    'rem.createPortal': 'create_portal',
    'rem.createSingleWithMarkdown': 'create_single_rem_with_markdown',
    'rem.createTreeWithMarkdown': 'create_tree_with_markdown',
    'rem.replaceChildrenWithMarkdown': 'replace_children_with_markdown',
    'rem.createLink': 'create_link_rem',
    'rem.updateText': 'update_text',
    'rem.move': 'move_rem',
    'rem.delete': 'delete_rem',
    // Portals
    'portal.create': 'create_portal',
    // Tags / attributes
    'tag.add': 'add_tag',
    'tag.remove': 'remove_tag',
    'attribute.set': 'set_attribute',
    // Tables / properties
    'table.create': 'create_table',
    'property.add': 'add_property',
    'property.setType': 'set_property_type',
    'table.setFilter': 'set_table_filter',
    'option.add': 'add_option',
    'option.remove': 'remove_option',
    'table.addRow': 'table_add_row',
    'table.removeRow': 'table_remove_row',
    // Cells
    'cell.setSelect': 'set_cell_select',
    'cell.setCheckbox': 'set_cell_checkbox',
    'cell.setNumber': 'set_cell_number',
    'cell.setDate': 'set_cell_date',
    'table.cellWrite': 'table_cell_write',
    // Misc
    'source.add': 'add_source',
    'source.remove': 'remove_source',
    'todo.setStatus': 'set_todo_status',
  };
  if (alias[t]) return alias[t];
  return t;
}
