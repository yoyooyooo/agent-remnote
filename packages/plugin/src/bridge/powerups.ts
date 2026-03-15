import {
  PropertyLocation,
  PropertyType,
  type ReactRNPlugin,
  type RegisterPowerupOptions,
} from '@remnote/plugin-sdk';

export const AGENT_REMNOTE_BACKUP_POWERUP = {
  name: 'agent-remnote backup',
  code: 'agent_remnote_backup',
  description: 'Internal backup marker for replace-style write operations.',
} as const;

export const agentRemnoteBackupPowerupOptions: RegisterPowerupOptions = {
  slots: [
    {
      code: 'backup_kind',
      name: 'Kind',
      propertyType: PropertyType.SINGLE_SELECT,
      enumValues: {
        children_replace: 'Children Replace',
        selection_replace: 'Selection Replace',
      },
      propertyLocation: PropertyLocation.ONLY_DOCUMENT,
      onlyProgrammaticModifying: true,
    },
    {
      code: 'cleanup_policy',
      name: 'Cleanup Policy',
      propertyType: PropertyType.SINGLE_SELECT,
      enumValues: {
        auto: 'Auto',
        visible: 'Visible',
      },
      propertyLocation: PropertyLocation.ONLY_DOCUMENT,
      onlyProgrammaticModifying: true,
    },
    {
      code: 'cleanup_state',
      name: 'Cleanup State',
      propertyType: PropertyType.SINGLE_SELECT,
      enumValues: {
        pending: 'Pending',
        orphan: 'Orphan',
        retained: 'Retained',
        cleaned: 'Cleaned',
      },
      propertyLocation: PropertyLocation.ONLY_DOCUMENT,
      onlyProgrammaticModifying: true,
    },
    {
      code: 'source_txn',
      name: 'Source Txn',
      propertyType: PropertyType.TEXT,
      propertyLocation: PropertyLocation.ONLY_DOCUMENT,
      onlyProgrammaticModifying: true,
    },
    {
      code: 'source_op',
      name: 'Source Op',
      propertyType: PropertyType.TEXT,
      propertyLocation: PropertyLocation.ONLY_DOCUMENT,
      onlyProgrammaticModifying: true,
    },
    {
      code: 'source_parent',
      name: 'Source Parent',
      propertyType: PropertyType.TEXT,
      propertyLocation: PropertyLocation.ONLY_DOCUMENT,
      onlyProgrammaticModifying: true,
    },
    {
      code: 'source_anchor',
      name: 'Source Anchor',
      propertyType: PropertyType.TEXT,
      propertyLocation: PropertyLocation.ONLY_DOCUMENT,
      onlyProgrammaticModifying: true,
    },
    {
      code: 'created_at',
      name: 'Created At',
      propertyType: PropertyType.TEXT,
      propertyLocation: PropertyLocation.ONLY_DOCUMENT,
      onlyProgrammaticModifying: true,
    },
  ],
};

export async function registerAgentRemnotePowerups(plugin: ReactRNPlugin): Promise<void> {
  await plugin.app.registerPowerup({
    name: AGENT_REMNOTE_BACKUP_POWERUP.name,
    code: AGENT_REMNOTE_BACKUP_POWERUP.code,
    description: AGENT_REMNOTE_BACKUP_POWERUP.description,
    options: agentRemnoteBackupPowerupOptions,
  });
}
