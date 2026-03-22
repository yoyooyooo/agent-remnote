import { createServer } from 'node:http';

export type HttpApiStubRequest = {
  readonly method: string;
  readonly url: string;
  readonly body: any;
};

export type HttpApiStubResponse = {
  readonly status?: number;
  readonly payload: unknown;
};

export async function startJsonApiStub(
  handler: (request: HttpApiStubRequest) => HttpApiStubResponse | undefined,
): Promise<{
  readonly baseUrl: string;
  readonly requests: HttpApiStubRequest[];
  readonly close: () => Promise<void>;
}> {
  const requests: HttpApiStubRequest[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))));
    req.on('end', () => {
      const bodyText = Buffer.concat(chunks).toString('utf8');
      let body: unknown;
      try {
        body = bodyText ? JSON.parse(bodyText) : undefined;
      } catch (error) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            ok: false,
            error: {
              code: 'INVALID_PAYLOAD',
              message: 'Invalid JSON body',
              details: { error: String((error as any)?.message || error) },
            },
          }),
        );
        return;
      }
      const request = {
        method: req.method || '',
        url: req.url || '',
        body,
      } satisfies HttpApiStubRequest;
      requests.push(request);

      const matched = handler(request);
      if (matched) {
        res.writeHead(matched.status ?? 200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(matched.payload));
        return;
      }

      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: { code: 'NOT_FOUND', message: 'Not found' } }));
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    close: async () => await new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
