function maskValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  if (value.length <= 4) return '***';
  return `${value.slice(0, 2)}***${value.slice(-2)}`;
}

function maskContext(context: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(context).map(([key, value]) => {
      const lower = key.toLowerCase();
      if (lower.includes('name') || lower.includes('phone') || lower.includes('email')) {
        return [key, Array.isArray(value) ? value.map(maskValue) : maskValue(value)];
      }
      return [key, value];
    })
  );
}

export function logEntityCreationAttempt(context: Record<string, unknown>): void {
  console.info('[entities] creation attempt', maskContext(context));
}

export function logDuplicateDetection(context: Record<string, unknown>): void {
  console.warn('[entities] duplicate detection', maskContext(context));
}

export function logMissingCompany(context: Record<string, unknown>): void {
  console.error('[entities] missing companyId', maskContext(context));
}
