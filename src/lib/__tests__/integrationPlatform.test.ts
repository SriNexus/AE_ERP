import { describe, expect, it, vi } from 'vitest';
import { AuthResolutionError } from '../../../api/_lib/auth';
import { resolveIntegrationRequest, runIntegrationAction, type IntegrationPlatformAdapter } from '../../../api/_lib/integrationPlatform';
import { handleIntegrationsRequest } from '../../../api/integrations';

function makeAdapter() {
  const secrets = new Map<string, any>();
  const masked = new Map<string, any>();
  const audits: any[] = [];
  const adapter: IntegrationPlatformAdapter = {
    readSecretEnvelope: vi.fn(async (companyId, section) => secrets.get(`${companyId}:${section}`) ?? null),
    writeSecretEnvelope: vi.fn(async (companyId, section, envelope) => { secrets.set(`${companyId}:${section}`, envelope); }),
    deleteSecretEnvelope: vi.fn(async (companyId, section) => { secrets.delete(`${companyId}:${section}`); }),
    writeMaskedStatus: vi.fn(async (companyId, section, status) => { masked.set(`${companyId}:${section}`, status); }),
    appendAuditLog: vi.fn(async (entry) => { audits.push(entry); }),
  };
  return { adapter, secrets, masked, audits };
}

const auth = {
  uid: 'auth-uid',
  erpUserId: 'MUSR-default-001',
  email: 'admin@example.com',
  name: 'Admin',
  role: 'Admin',
  companyId: 'default',
  isSuperAdmin: false,
};

async function expectIntegrationError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ name: 'AuthResolutionError', code });
}

function mockResponse() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    end: vi.fn().mockReturnThis(),
    setHeader: vi.fn().mockReturnThis(),
  } as any;
}

describe('integration platform boundary', () => {
  it('stores secrets server-side and returns only masked metadata', async () => {
    const env = makeAdapter();
    const result = await runIntegrationAction({ auth, section: 'email', action: 'update', secretPayload: { smtpPass: 'top-secret', sendgridApiKey: 'abc' } }, env.adapter);

    expect(result).toMatchObject({ hasSecretConfigured: true, secretKeyCount: 2, section: 'email', action: 'update' });
    expect(result).not.toHaveProperty('secretPayload');
    expect(env.secrets.get('default:email')).toMatchObject({ secretPayload: { smtpPass: 'top-secret', sendgridApiKey: 'abc' } });
    expect(env.masked.get('default:email')).toMatchObject({ hasSecretConfigured: true });
    expect(env.audits[0]).toMatchObject({ action: 'integration.update', section: 'email', changedFields: ['smtpPass', 'sendgridApiKey'] });
  });

  it('reads existing status without exposing secret values', async () => {
    const env = makeAdapter();
    env.secrets.set('default:whatsapp', {
      version: 1,
      companyId: 'default',
      section: 'whatsapp',
      secretPayload: { apiKey: 'hidden' },
      createdAt: '2026-07-12T00:00:00.000Z',
      updatedAt: '2026-07-12T00:00:00.000Z',
      updatedBy: 'auth-uid',
      lastAction: 'update',
    });

    const result = await runIntegrationAction({ auth, section: 'whatsapp', action: 'status' }, env.adapter);
    expect(result).toMatchObject({ hasSecretConfigured: true, secretKeyCount: 1, action: 'status' });
    expect(result).not.toHaveProperty('secretPayload');
  });

  it('disconnects secrets and marks the section as unconfigured', async () => {
    const env = makeAdapter();
    env.secrets.set('default:sms', {
      version: 1,
      companyId: 'default',
      section: 'sms',
      secretPayload: { apiSecret: 'hidden' },
      createdAt: '2026-07-12T00:00:00.000Z',
      updatedAt: '2026-07-12T00:00:00.000Z',
      updatedBy: 'auth-uid',
      lastAction: 'update',
    });

    const result = await runIntegrationAction({ auth, section: 'sms', action: 'disconnect' }, env.adapter);
    expect(result).toMatchObject({ hasSecretConfigured: false, secretKeyCount: 0, action: 'disconnect' });
    expect(env.secrets.has('default:sms')).toBe(false);
    expect(env.masked.get('default:sms')).toMatchObject({ hasSecretConfigured: false });
  });

  it('rejects invalid section names', async () => {
    const env = makeAdapter();
    await expectIntegrationError(resolveIntegrationRequest(
      null,
      null,
      'not-a-section',
      'status',
      undefined,
      { authenticate: async () => auth, adapter: env.adapter },
    ), 'INVALID_SECTION');
  });

  it('rejects non-admin callers', async () => {
    const env = makeAdapter();
    const res = mockResponse();
    await handleIntegrationsRequest({ method: 'POST', headers: {}, query: {}, body: { section: 'email', action: 'status' } } as any, res, {
      adapter: env.adapter,
      authenticate: async () => ({ ...auth, role: 'Employee' }),
    });
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json.mock.calls[0][0]).toMatchObject({ error: { code: 'FORBIDDEN' } });
  });

  it('blocks integration operations for the Demo Company even with a forged admin role', async () => {
    const env = makeAdapter();
    const res = mockResponse();
    await handleIntegrationsRequest({ method: 'POST', headers: {}, query: {}, body: { section: 'email', action: 'status' } } as any, res, {
      adapter: env.adapter,
      authenticate: async () => ({ ...auth, companyId: 'company-demo-neozy', role: 'Admin' }),
    });
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json.mock.calls[0][0]).toMatchObject({ error: { code: 'DEMO_CAPABILITY_BLOCKED' } });
  });
  it('serves the route without leaking raw secrets', async () => {
    const env = makeAdapter();
    const res = mockResponse();
    await handleIntegrationsRequest({ method: 'POST', headers: {}, query: {}, body: { section: 'integrations', action: 'update', secretPayload: { razorpayKeySecret: 'hidden-secret' } } } as any, res, {
      adapter: env.adapter,
      authenticate: async () => auth,
    });

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.data).toMatchObject({ hasSecretConfigured: true, action: 'update', section: 'integrations' });
    expect(JSON.stringify(payload)).not.toContain('hidden-secret');
  });
});
