import type { ReactRNPlugin } from '@remnote/plugin-sdk';

export async function attachNewRem(plugin: ReactRNPlugin, rem: any, parentId: string, position = 0) {
  const parent = typeof parentId === 'string' ? parentId.trim() : '';
  if (!parent) throw new Error('Missing parent_id (refusing to create a Rem without a parent)');
  try {
    if (typeof (rem as any).setParent === 'function') {
      await (rem as any).setParent(parent);
    } else {
      await plugin.rem.moveRems([rem._id], parent, position);
    }
  } catch (e) {
    try {
      await rem.remove();
    } catch {}
    throw e;
  }
}
