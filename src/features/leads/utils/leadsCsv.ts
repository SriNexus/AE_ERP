// features/leads/utils/leadsCsv.ts

export function parseCSV(str: string): Record<string, string>[] {
  const arr: string[][] = [];
  let quote = false;
  for (let row = 0, col = 0, c = 0; c < str.length; c++) {
    const cc = str[c], nc = str[c + 1];
    arr[row] = arr[row] || [];
    arr[row][col] = arr[row][col] || '';
    if (cc === '"' && quote && nc === '"') { arr[row][col] += cc; ++c; continue; }
    if (cc === '"') { quote = !quote; continue; }
    if (cc === ',' && !quote) { ++col; continue; }
    if (cc === '\r' && nc === '\n' && !quote) { ++row; col = 0; ++c; continue; }
    if ((cc === '\n' || cc === '\r') && !quote) { ++row; col = 0; continue; }
    arr[row][col] += cc;
  }
  if (arr.length === 0) return [];
  const headers = arr[0].map(h => h.trim().toLowerCase());
  return arr.slice(1)
    .filter(r => r.join('').trim() !== '')
    .map(r => headers.reduce((acc, h, i) => ({ ...acc, [h]: r[i]?.trim() || '' }), {} as Record<string, string>));
}

export function exportLeadsCSV(rows: any[], filename = 'leads.csv') {
  const cols = ['name', 'phone', 'email', 'city', 'state', 'source', 'status', 'assignedToName', 'createdAt', 'next_date'];
  const header = cols.join(',');
  const body = rows.map(r =>
    cols.map(c => `"${String(r[c] || '').replace(/"/g, '""')}"`).join(',')
  ).join('\n');
  const blob = new Blob([header + '\n' + body], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function isValidPhone(phone: string): boolean {
  return /\d{10,}/.test(phone.replace(/\D/g, ''));
}

export function getInitials(name: string): string {
  return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

export function getAvatarColor(name: string): string {
  const colors = [
    'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-400',
    'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400',
    'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400',
    'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-400',
    'bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-400',
    'bg-cyan-100 dark:bg-cyan-900/40 text-cyan-700 dark:text-cyan-400',
  ];
  return colors[(name || '').charCodeAt(0) % colors.length];
}
