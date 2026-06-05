import { describe, it, expect, mock } from 'bun:test';
import { ProofController } from '../src/runtime/proof/proof.controller';

describe('ProofController', () => {
  const controller = new ProofController();

  it('serves the HTML page on GET /proof', () => {
    const send = mock(() => undefined);
    const status = mock(() => ({ send }));
    const res = { setHeader: mock(() => undefined), status, send } as unknown as Parameters<
      typeof controller.serveProof
    >[0];
    controller.serveProof(res);
    expect(send.mock.calls.length).toBe(1);
    const html = String(((send.mock.calls[0] ?? []) as unknown[])[0] ?? '');
    expect(typeof html).toBe('string');
    expect(html).toContain('SkillWallet Proof');
    expect(html).toContain('@metamask/smart-accounts-kit');
    expect(html).toContain('importmap');
  });
});

/**
 * Real-HTTP integration: spin up a Bun.serve instance, route requests to the
 * controller methods, and verify the wire shape with `fetch`. This is the
 * closest we can get to a curl test without booting the full Nest app (which
 * needs MongoDB).
 */
describe('ProofController real HTTP (Bun.serve + fetch)', () => {
  type ExpressLikeRes = {
    setHeader: (name: string, value: string) => void;
    status: (code: number) => { send: (b: unknown) => void };
    send: (b: unknown) => void;
  };
  function makeRes(): ExpressLikeRes & {
    body: unknown;
    statusCode: number;
    headers: Record<string, string>;
  } {
    const headers: Record<string, string> = {};
    let statusCode = 200;
    let body: unknown;
    // Note: use Object.defineProperty, not Object.assign({get body()}). Under
    // bun's module loader, Object.assign can collapse the getter into a plain
    // value, breaking the body capture. defineProperty preserves the live getter.
    const res: ExpressLikeRes = {
      setHeader: (n, v) => {
        headers[n.toLowerCase()] = v;
      },
      status: (code) => {
        statusCode = code;
        return {
          send: (b: unknown) => {
            body = b;
          },
        };
      },
      send: (b) => {
        body = b;
      },
    };
    Object.defineProperty(res, 'body', {
      get: () => body,
      enumerable: true,
    });
    Object.defineProperty(res, 'statusCode', {
      get: () => statusCode,
      enumerable: true,
    });
    (res as unknown as { headers: Record<string, string> }).headers = headers;
    return res as unknown as ExpressLikeRes & {
      body: unknown;
      statusCode: number;
      headers: Record<string, string>;
    };
  }

  const ctrl = new ProofController();
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (req.method === 'GET' && url.pathname === '/proof') {
        const r = makeRes();
        ctrl.serveProof(r as never);
        return new Response(String(r.body ?? ''), { status: r.statusCode, headers: r.headers });
      }
      if (req.method === 'GET' && url.pathname === '/proof/style.css') {
        const r = makeRes();
        ctrl.serveCss(r as never);
        return new Response(String(r.body ?? ''), { status: r.statusCode, headers: r.headers });
      }
      return new Response('not found', { status: 404 });
    },
  });
  const baseUrl = `http://127.0.0.1:${server.port}`;

  it('GET /proof returns the HTML page with correct content-type', async () => {
    const res = await fetch(`${baseUrl}/proof`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('SkillWallet Proof');
    expect(html).toContain('href="/proof/style.css"');
    expect(html).toContain('@metamask/smart-accounts-kit');
    expect(html).toContain('importmap');
  });

  it('GET /proof/style.css returns the CSS with correct content-type', async () => {
    const res = await fetch(`${baseUrl}/proof/style.css`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/css');
    const css = await res.text();
    expect(css).toContain(':root');
    expect(css).toContain('--accent');
    expect(css).toContain('button');
  });

  it('GET on unknown path returns 404', async () => {
    const res = await fetch(`${baseUrl}/nope`);
    expect(res.status).toBe(404);
  });
});
