import { describe, it, expect, mock } from 'bun:test';
import { BadRequestException } from '@nestjs/common';
import { ProofController } from '../src/runtime/proof/proof.controller';
import type { OneShotRelayerService } from '../src/runtime/relayers/oneshot-relayer.service';

describe('ProofController', () => {
  const relayerMock = {
    getCapabilities: mock(async () => ({ chains: [], raw: {} })),
    getFeeData: mock(async () => ({
      chainId: '11155111',
      token: { address: '0xusdc', decimals: 6, symbol: 'USDC' },
      rate: 2000,
      minFee: '0.01',
      expiry: 1780415025,
      gasPrice: '1339446477',
      feeCollector: '0xfee',
      targetAddress: '0xtarget',
      context: '0xctx',
    })),
    estimate7710Transaction: mock(async () => ({
      success: true,
      gasUsed: {},
      requiredPaymentAmount: '0.01',
      context: '0xctx',
    })),
    send7710Transaction: mock(async () => ({ taskId: 'task-1', raw: 'task-1' })),
    getStatus: mock(async () => ({
      taskId: 'task-1',
      statusCode: 100,
      status: 'pending',
    })),
  } as unknown as OneShotRelayerService;

  const controller = new ProofController(relayerMock);

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

  it('rejects proxy requests without a method', async () => {
    await expect(controller.proxyRelayer({} as never)).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.proxyRelayer({ method: '', params: {} })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects non-whitelisted relayer methods', async () => {
    await expect(
      controller.proxyRelayer({ method: 'relayer_sendTransaction', params: {} }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.proxyRelayer({ method: 'relayer_evilMethod', params: {} }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('forwards relayer_getCapabilities via the relayer service', async () => {
    const out = await controller.proxyRelayer({
      method: 'relayer_getCapabilities',
      params: ['11155111'],
    });
    expect(out).toEqual({ result: { chains: [], raw: {} } });
    expect(relayerMock.getCapabilities).toHaveBeenCalled();
  });

  it('forwards relayer_getFeeData via the relayer service', async () => {
    const out = await controller.proxyRelayer({
      method: 'relayer_getFeeData',
      params: { chainId: '11155111' },
    });
    expect(out).toEqual({
      result: expect.objectContaining({
        rate: 2000,
        minFee: '0.01',
        feeCollector: '0xfee',
        targetAddress: '0xtarget',
      }),
    });
    expect(relayerMock.getFeeData).toHaveBeenCalled();
  });

  it('forwards relayer_estimate7710Transaction via the relayer service', async () => {
    const out = await controller.proxyRelayer({
      method: 'relayer_estimate7710Transaction',
      params: { chainId: 11155111, transactions: [] },
    });
    expect(out).toEqual({
      result: expect.objectContaining({ success: true, requiredPaymentAmount: '0.01' }),
    });
    expect(relayerMock.estimate7710Transaction).toHaveBeenCalled();
  });

  it('forwards relayer_send7710Transaction via the relayer service', async () => {
    const out = await controller.proxyRelayer({
      method: 'relayer_send7710Transaction',
      params: { chainId: 11155111, transactions: [] },
    });
    expect(out).toEqual({ result: { taskId: 'task-1', raw: 'task-1' } });
    expect(relayerMock.send7710Transaction).toHaveBeenCalled();
  });

  it('forwards relayer_getStatus via the relayer service', async () => {
    const out = await controller.proxyRelayer({
      method: 'relayer_getStatus',
      params: { id: 'task-1', logs: false },
    });
    expect(out).toEqual({
      result: expect.objectContaining({ statusCode: 100, status: 'pending' }),
    });
    expect(relayerMock.getStatus).toHaveBeenCalledWith('task-1');
  });

  it('rejects relayer_getStatus without an id', async () => {
    await expect(
      controller.proxyRelayer({ method: 'relayer_getStatus', params: {} }),
    ).rejects.toBeInstanceOf(BadRequestException);
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

  const relayerMock = {
    getCapabilities: mock(async () => ({ chains: [], raw: {} })),
    getFeeData: mock(async () => ({
      chainId: '11155111',
      token: { address: '0xusdc', decimals: 6, symbol: 'USDC' },
      rate: 2000,
      minFee: '0.01',
      expiry: 1780415025,
      gasPrice: '1339446477',
      feeCollector: '0xfee',
      targetAddress: '0xtarget',
      context: '0xctx',
    })),
    estimate7710Transaction: mock(async () => ({
      success: true,
      gasUsed: {},
      requiredPaymentAmount: '0.01',
      context: '0xctx',
    })),
    send7710Transaction: mock(async () => ({ taskId: 'task-1', raw: 'task-1' })),
    getStatus: mock(async () => ({
      taskId: 'task-1',
      statusCode: 100,
      status: 'pending',
    })),
  } as unknown as OneShotRelayerService;

  const ctrl = new ProofController(relayerMock);
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
      if (req.method === 'POST' && url.pathname === '/proof/relayer') {
        let body: { method?: unknown; params?: unknown };
        try {
          body = (await req.json()) as typeof body;
        } catch {
          return Response.json({ error: 'invalid JSON body' }, { status: 400 });
        }
        try {
          const result = await ctrl.proxyRelayer(body);
          return Response.json(result);
        } catch (err) {
          return Response.json(
            { error: (err as Error).message },
            { status: err instanceof BadRequestException ? 400 : 500 },
          );
        }
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

  it('POST /proof/relayer with relayer_getCapabilities forwards to service', async () => {
    const res = await fetch(`${baseUrl}/proof/relayer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'relayer_getCapabilities', params: ['11155111'] }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { result?: unknown };
    expect(json.result).toEqual({ chains: [], raw: {} });
    expect(relayerMock.getCapabilities).toHaveBeenCalled();
  });

  it('POST /proof/relayer with relayer_sendTransaction returns 400 (not whitelisted)', async () => {
    const res = await fetch(`${baseUrl}/proof/relayer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'relayer_sendTransaction', params: {} }),
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error?: string };
    expect(json.error).toContain('not allowed');
  });

  it('POST /proof/relayer with invalid JSON returns 400', async () => {
    const res = await fetch(`${baseUrl}/proof/relayer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    });
    expect(res.status).toBe(400);
  });

  it('GET on unknown path returns 404', async () => {
    const res = await fetch(`${baseUrl}/nope`);
    expect(res.status).toBe(404);
  });
});
