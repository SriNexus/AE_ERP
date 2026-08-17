import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAll: vi.fn(),
}));

vi.mock('../../../../lib/firestore', () => ({
  getAll: mocks.getAll,
}));

vi.mock('../../../../lib/firebase', () => ({
  COLLECTIONS: { QUOTATIONS: 'quotations', ORDERS: 'orders' },
}));

import { checkFirstTimeBilling } from '../firstTimeBilling';

describe('checkFirstTimeBilling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is first-time when the customer has zero quotations AND zero orders', async () => {
    mocks.getAll.mockResolvedValue([]);
    const result = await checkFirstTimeBilling('C-1');
    expect(result).toEqual({ isFirstTime: true, checkFailed: false });
  });

  it('is NOT first-time when the customer has a quotation but no order — the quotation step already happened', async () => {
    mocks.getAll.mockImplementation((collection: string) =>
      Promise.resolve(collection === 'quotations' ? [{ id: 'Q-1' }] : []));
    const result = await checkFirstTimeBilling('C-1');
    expect(result).toEqual({ isFirstTime: false, checkFailed: false });
  });

  it('is NOT first-time when the customer has an order but no quotation — a direct order already happened', async () => {
    mocks.getAll.mockImplementation((collection: string) =>
      Promise.resolve(collection === 'orders' ? [{ id: 'O-1' }] : []));
    const result = await checkFirstTimeBilling('C-1');
    expect(result).toEqual({ isFirstTime: false, checkFailed: false });
  });

  it('is NOT first-time when the customer has both a quotation and an order', async () => {
    mocks.getAll.mockResolvedValue([{ id: 'X-1' }]);
    const result = await checkFirstTimeBilling('C-1');
    expect(result.isFirstTime).toBe(false);
  });

  it('fails open (isFirstTime: false, checkFailed: true) when the existence check throws — never blocks a real business action', async () => {
    mocks.getAll.mockRejectedValue(new Error('Firestore unavailable'));
    const result = await checkFirstTimeBilling('C-1');
    expect(result).toEqual({ isFirstTime: false, checkFailed: true });
  });

  it('queries both collections scoped to the given customerId with a limit(1) existence check', async () => {
    mocks.getAll.mockResolvedValue([]);
    await checkFirstTimeBilling('C-42');
    expect(mocks.getAll).toHaveBeenCalledWith('quotations', expect.any(Array));
    expect(mocks.getAll).toHaveBeenCalledWith('orders', expect.any(Array));
    expect(mocks.getAll).toHaveBeenCalledTimes(2);
  });
});
