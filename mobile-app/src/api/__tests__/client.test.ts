import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { ApiError, formatPhone, getCertificate, normalizePhone, setToken, signIn, subscribe } from '@/api';

const respond = (status: number, body: unknown) =>
  jest.fn(async () => ({ ok: status < 400, status, json: async () => body }) as unknown as Response);

afterEach(() => {
  setToken(null);
  jest.restoreAllMocks();
});

describe('phone numbers', () => {
  it('normalises Rwandan numbers', () => {
    expect(normalizePhone('078 812 3456')).toBe('+250788123456');
    expect(normalizePhone('+250 788 123 456')).toBe('+250788123456');
    expect(normalizePhone('12345')).toBeNull();
    expect(formatPhone('+250788123456')).toBe('+250 788 123 456');
  });
});

describe('API client', () => {
  it('sends the session token and JSON body', async () => {
    const fetchMock = respond(200, { token: 't', user: { id: 'u-1' } });
    global.fetch = fetchMock as unknown as typeof fetch;
    setToken('secret');
    await signIn('0788123456', '2580');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/auth\/sign-in$/);
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret');
    expect(JSON.parse(init.body as string)).toEqual({ phone: '0788123456', pin: '2580' });
  });

  it('turns server errors into translated error codes', async () => {
    global.fetch = respond(401, { error: 'wrongCredentials' }) as unknown as typeof fetch;
    await expect(signIn('0788123456', '0000')).rejects.toEqual(new ApiError('wrongCredentials', 401));
  });

  it('reports a network problem when the server cannot be reached', async () => {
    global.fetch = jest.fn(async () => {
      throw new TypeError('Network request failed');
    }) as unknown as typeof fetch;
    await expect(signIn('0788123456', '2580')).rejects.toMatchObject({ code: 'network' });
  });

  it('returns null when a batch has no certificate yet', async () => {
    global.fetch = respond(404, { error: 'noCertificate' }) as unknown as typeof fetch;
    expect(await getCertificate('b-1')).toBeNull();
  });

  it('tells screens to reload after a change', async () => {
    global.fetch = respond(200, { token: 't', user: {} }) as unknown as typeof fetch;
    const listener = jest.fn();
    const unsubscribe = subscribe(listener);
    await signIn('0788123456', '2580');
    unsubscribe();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
