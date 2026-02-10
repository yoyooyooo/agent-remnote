export function openWs(url: string, timeoutMs = 8000): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let settled = false;
    const cleanup = () => {
      try {
        ws.onopen = null as any;
      } catch {}
      try {
        ws.onerror = null as any;
      } catch {}
      try {
        ws.onclose = null as any;
      } catch {}
      clearTimeout(timer);
    };
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };
    ws.onopen = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(ws);
    };
    ws.onerror = () => fail(new Error('WebSocket connection failed'));
    ws.onclose = () => fail(new Error('WebSocket closed'));
    const timer = setTimeout(() => fail(new Error('WebSocket connection timeout')), timeoutMs);
  });
}

export function waitMessage(ws: WebSocket, timeoutMs = 15_000): Promise<any> {
  return new Promise((resolve, reject) => {
    const onMsg = (ev: MessageEvent) => {
      try {
        resolve(JSON.parse(String(ev.data)));
      } catch {
        resolve(null);
      }
      cleanup();
    };
    const onClose = () => {
      cleanup();
      reject(new Error('WebSocket closed'));
    };
    const onError = () => {
      cleanup();
      reject(new Error('WebSocket error'));
    };
    const cleanup = () => {
      ws.removeEventListener('message', onMsg);
      ws.removeEventListener('close', onClose);
      ws.removeEventListener('error', onError);
      clearTimeout(timer);
    };
    ws.addEventListener('message', onMsg);
    ws.addEventListener('close', onClose);
    ws.addEventListener('error', onError);
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('WebSocket timeout'));
    }, timeoutMs);
  });
}

// Wait until we receive OpDispatchBatch / OpDispatch / NoWork / Error (ignore HelloAck / Registered / etc.)
export function waitForOpOrNoWork(ws: WebSocket, timeoutMs = 15_000): Promise<any> {
  return new Promise((resolve, reject) => {
    const onMsg = (ev: MessageEvent) => {
      try {
        const msg = JSON.parse(String(ev.data));
        if (msg?.type === 'OpDispatchBatch' || msg?.type === 'OpDispatch' || msg?.type === 'NoWork' || msg?.type === 'Error') {
          cleanup();
          resolve(msg);
        }
      } catch {}
    };
    const onClose = () => {
      cleanup();
      reject(new Error('WebSocket closed'));
    };
    const onError = () => {
      cleanup();
      reject(new Error('WebSocket error'));
    };
    const onTimeout = () => {
      cleanup();
      reject(new Error('WebSocket timeout'));
    };
    const cleanup = () => {
      ws.removeEventListener('message', onMsg);
      ws.removeEventListener('close', onClose);
      ws.removeEventListener('error', onError);
      clearTimeout(timer);
    };
    ws.addEventListener('message', onMsg);
    ws.addEventListener('close', onClose);
    ws.addEventListener('error', onError);
    const timer = setTimeout(onTimeout, timeoutMs);
  });
}

export function send(ws: WebSocket, obj: any) {
  ws.send(JSON.stringify(obj));
}
