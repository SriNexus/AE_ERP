import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationType } from '../../types';

const mocks = vi.hoisted(() => ({ getOne: vi.fn(), create: vi.fn(), getDocs: vi.fn(), metric: vi.fn() }));
vi.mock('../firestore', () => ({
  getOne: mocks.getOne,
  createDocWithId: mocks.create,
  genId: { generic: () => 'NTF-test' },
}));
vi.mock('../firebase', () => ({ COLLECTIONS: { SETTINGS: 'settings', NOTIFICATIONS: 'notifications', USERS: 'users' }, db: {} }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, name) => name), where: vi.fn(), limit: vi.fn(), query: vi.fn((value) => value), serverTimestamp: vi.fn(() => 'timestamp'), getDocs: mocks.getDocs,
}));
vi.mock('../notificationMetrics', () => ({ trackNotificationMetric: mocks.metric }));

import { evaluateNotificationPreferences, isWithinQuietHours, notifyRoleUsers, sendNotification } from '../notifications';

const enabled = { userId: 'user-2', quietHoursEnabled: false, quietHoursStart: '22:00', quietHoursEnd: '07:00', events: [{ eventType: 'task_assigned', label: 'Task assigned', inApp: true, email: false }] };
const wrapper = (preferences: typeof enabled) => ({ data: { notificationPreferences: preferences } });
const sendTask = () => sendNotification('user-2', NotificationType.TASK_ASSIGNED, 'Task', 'Assigned', 'task', 'TSK-1', 'company-1');

describe('P04 notification preference enforcement', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.getDocs.mockResolvedValue({ docs: [] }); });
  afterEach(() => vi.useRealTimers());

  it('handles same-day and overnight quiet-hour windows', () => {
    expect(isWithinQuietHours(new Date(2026, 0, 1, 13, 0), '12:00', '14:00')).toBe(true);
    expect(isWithinQuietHours(new Date(2026, 0, 1, 23, 0), '22:00', '07:00')).toBe(true);
    expect(isWithinQuietHours(new Date(2026, 0, 1, 12, 0), '22:00', '07:00')).toBe(false);
  });

  it('suppresses a disabled event before creating a document', async () => {
    mocks.getOne.mockResolvedValue(wrapper({ ...enabled, events: [{ ...enabled.events[0], inApp: false }] }));
    await sendTask();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.metric).toHaveBeenCalledWith('suppressed_by_prefs', expect.objectContaining({ reason: 'event-disabled' }));
  });

  it('suppresses during quiet hours without queueing', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 0, 1, 23, 0));
    mocks.getOne.mockResolvedValue(wrapper({ ...enabled, quietHoursEnabled: true }));
    await sendTask();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.metric).toHaveBeenCalledWith('suppressed_by_prefs', expect.objectContaining({ reason: 'quiet-hours' }));
  });

  it('delivers normally for enabled and missing default preferences', async () => {
    mocks.getOne.mockResolvedValueOnce(wrapper(enabled)).mockResolvedValueOnce(null);
    await sendTask(); await sendTask();
    expect(mocks.create).toHaveBeenCalledTimes(2);
  });

  it('fails open when preference lookup fails', async () => {
    mocks.getOne.mockRejectedValue(new Error('permission denied'));
    await sendTask();
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.metric).toHaveBeenCalledWith('created', expect.any(Object));
  });

  it('applies preferences individually to role-targeted recipients', async () => {
    mocks.getDocs
      .mockResolvedValueOnce({ docs: [{ id: 'user-2', data: () => ({ role: 'Admin', companyId: 'company-1', status: 'Active' }) }, { id: 'user-3', data: () => ({ role: 'Admin', companyId: 'company-1', status: 'Active' }) }] })
      .mockResolvedValue({ docs: [] });
    mocks.getOne.mockResolvedValueOnce(wrapper({ ...enabled, events: [{ ...enabled.events[0], inApp: false }] })).mockResolvedValueOnce(null);
    await notifyRoleUsers(['Admin'], NotificationType.TASK_ASSIGNED, 'Task', 'Assigned', 'task', 'TSK-1', 'company-1');
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create).toHaveBeenCalledWith('notifications', 'NTF-test', expect.objectContaining({ recipientUserId: 'user-3' }));
  });

  it('delivers unknown event classes unless quiet hours suppress them', () => {
    expect(evaluateNotificationPreferences(enabled, NotificationType.ORDER_UPDATED, 'order').deliver).toBe(true);
  });
});
