import { openWs, send, waitMessage } from './ws';

export async function queryQueueStats(url: string) {
  const ws = await openWs(url);
  send(ws, { type: 'QueryStats' });
  const msg: any = await waitMessage(ws);
  ws.close();
  if (msg?.type !== 'Stats') throw new Error('Invalid Stats response');
  return msg;
}
