import { describe, expect, it } from 'vitest';
import { isExternalCommunicationHref } from '../../components/auth/DemoExternalActionGuard';

describe('Demo external communication navigation guard', () => {
  it('recognizes communication provider links without blocking local documents', () => {
    for (const href of ['mailto:test@example.invalid', 'tel:0000000000', 'sms:0000000000', 'https://wa.me/0000000000', 'https://api.whatsapp.com/send?phone=0']) {
      expect(isExternalCommunicationHref(href)).toBe(true);
    }
    expect(isExternalCommunicationHref('/quotations/DEMO')).toBe(false);
    expect(isExternalCommunicationHref('blob:https://local.invalid/id')).toBe(false);
  });
});