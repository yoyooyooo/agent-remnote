import { describe, expect, it } from 'vitest';

async function loadRuntime() {
  globalThis.self = globalThis;
  return await import('../src/bridge/runtime.ts');
}

describe('runtime ack batching helpers', () => {
  it('groups multiple ack payloads for the same ws into one OpAckBatch envelope', async () => {
    const runtime = await loadRuntime();
    const ws1 = { name: 'ws1' };
    const ws2 = { name: 'ws2' };

    const messages = runtime.buildAckFlushMessagesForTests([
      { ws: ws1, payload: { type: 'OpAck', op_id: 'op-1', attempt_id: 'a1', status: 'success', result: { ok: true } } },
      { ws: ws1, payload: { type: 'OpAck', op_id: 'op-2', attempt_id: 'a2', status: 'success', result: { ok: true } } },
      { ws: ws2, payload: { type: 'OpAck', op_id: 'op-3', attempt_id: 'a3', status: 'success', result: { ok: true } } },
    ]);

    expect(messages).toHaveLength(2);
    expect(messages[0]?.payload).toEqual({
      type: 'OpAckBatch',
      items: [
        { type: 'OpAck', op_id: 'op-1', attempt_id: 'a1', status: 'success', result: { ok: true } },
        { type: 'OpAck', op_id: 'op-2', attempt_id: 'a2', status: 'success', result: { ok: true } },
      ],
    });
    expect(messages[1]?.payload).toEqual({
      type: 'OpAck',
      op_id: 'op-3',
      attempt_id: 'a3',
      status: 'success',
      result: { ok: true },
    });
  });
});
