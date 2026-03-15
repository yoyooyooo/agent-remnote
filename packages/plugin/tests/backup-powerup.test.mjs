import { describe, expect, it, vi } from 'vitest';

async function loadModule() {
  const prevSelf = globalThis.self;
  globalThis.self = globalThis;
  try {
    return await import('../src/bridge/powerups.ts');
  } finally {
    if (typeof prevSelf === 'undefined') delete globalThis.self;
    else globalThis.self = prevSelf;
  }
}

describe('agent-remnote backup powerup', () => {
  it('defines the expected backup powerup identity', async () => {
    const { AGENT_REMNOTE_BACKUP_POWERUP } = await loadModule();
    expect(AGENT_REMNOTE_BACKUP_POWERUP).toEqual({
      name: 'agent-remnote backup',
      code: 'agent_remnote_backup',
      description: 'Internal backup marker for replace-style write operations.',
    });
  });

  it('registers the backup powerup with the planned slots', async () => {
    const { agentRemnoteBackupPowerupOptions, registerAgentRemnotePowerups } = await loadModule();
    const registerPowerup = vi.fn(async () => {});
    const plugin = {
      app: {
        registerPowerup,
      },
    };

    await registerAgentRemnotePowerups(plugin);

    expect(registerPowerup).toHaveBeenCalledTimes(1);
    expect(registerPowerup).toHaveBeenCalledWith({
      name: 'agent-remnote backup',
      code: 'agent_remnote_backup',
      description: 'Internal backup marker for replace-style write operations.',
      options: agentRemnoteBackupPowerupOptions,
    });
    expect(agentRemnoteBackupPowerupOptions.slots).toHaveLength(8);
  });
});
