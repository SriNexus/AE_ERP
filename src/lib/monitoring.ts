import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db, firebaseEnv } from './firebase';
import { sanitizeFirestoreData } from './sanitizer';

type MonitoringContext = Record<string, unknown>;

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function safeContext(context?: MonitoringContext): MonitoringContext {
  if (!context) return {};
  return Object.fromEntries(
    Object.entries(context).filter(([, value]) => (
      value === null
      || ['string', 'number', 'boolean'].includes(typeof value)
      || Array.isArray(value)
      || (typeof value === 'object' && value !== undefined)
    ))
  );
}

function serializeError(error: Error) {
  return {
    name: error.name,
    message: error.message,
    stack: error.stack || '',
  };
}

function writeMonitoringEvent(level: 'error' | 'warning', payload: MonitoringContext) {
  if (!firebaseEnv.isConfigured) return;
  const companyId = stringValue(payload.companyId);
  if (!companyId) return;

  void addDoc(collection(db, 'error_logs'), sanitizeFirestoreData({
    ...payload,
    level,
    companyId,
    userId: stringValue(payload.userId) || null,
    userEmail: stringValue(payload.userEmail) || null,
    createdAt: serverTimestamp(),
  })).catch(() => undefined);
}

export function logError(error: Error, context?: MonitoringContext): void {
  if (import.meta.env.DEV) {
    console.error(error, context);
    return;
  }

  try {
    const sanitizedContext = safeContext(context);
    writeMonitoringEvent('error', {
      error: serializeError(error),
      context: sanitizedContext,
      companyId: sanitizedContext.companyId,
      userId: sanitizedContext.userId,
      userEmail: sanitizedContext.userEmail,
      url: typeof window !== 'undefined' ? window.location.href : '',
    });
  } catch {
    // Monitoring must never break application flow.
  }
}

export function logWarning(message: string, context?: MonitoringContext): void {
  if (import.meta.env.DEV) {
    console.warn(message, context);
    return;
  }

  try {
    const sanitizedContext = safeContext(context);
    writeMonitoringEvent('warning', {
      message,
      context: sanitizedContext,
      companyId: sanitizedContext.companyId,
      userId: sanitizedContext.userId,
      userEmail: sanitizedContext.userEmail,
      url: typeof window !== 'undefined' ? window.location.href : '',
    });
  } catch {
    // Monitoring must never break application flow.
  }
}
