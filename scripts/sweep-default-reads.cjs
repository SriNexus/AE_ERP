/**
 * Residual 'default'-placeholder sweep for the Admin companyId='default' 403-storm class.
 * Reports read/write paths that could still emit companyId 'default' into queries or doc ids.
 */
const { execSync } = require('child_process');

const patterns = [
  {
    label: 'raw activeCompanyId ternary feeding queries',
    rx: /activeCompanyId && activeCompanyId !== 'all' \? activeCompanyId/,
  },
  {
    label: "companyId || 'default' fallbacks",
    rx: /companyId\s*\|\|\s*['"]default['"]/,
  },
  {
    label: "activeCompanyId || 'default'",
    rx: /activeCompanyId\s*\|\|\s*['"]default['"]/,
  },
  {
    label: "startsWith('all') ? 'default'",
    rx: /startsWith\('all'\) \? 'default'/,
  },
  {
    label: 'DEFAULT_COMPANY.id as tenant fallback',
    rx: /DEFAULT_COMPANY\.id/,
  },
  {
    label: "where('companyId', '==', <raw>)",
    rx: /where\('companyId', '==', (?!companyId|context\.companyId|resolvedCompanyId|normalizedCompanyId|effectiveCompanyId|resolvedCompanyId|companyId \|\|)[A-Za-z_]+\)/,
  },
];

const files = execSync(
  `cd /c/Users/Shree/.aa/CSGPL-1 && grep -rlE "" src --include='*.ts' --include='*.tsx' | grep -v __tests__ | grep -vE '(^|/)(__tests__|dist|node_modules)/'`,
  { encoding: 'utf8', shell: 'bash' }
)
  .split('\n')
  .filter(Boolean);

let hits = 0;
for (const file of files) {
  let content;
  try {
    content = require('fs').readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  const lines = content.split('\n');
  lines.forEach((line, idx) => {
    for (const p of patterns) {
      if (p.rx.test(line)) {
        hits += 1;
        console.log(`${p.label} :: ${file}:${idx + 1}: ${line.trim().slice(0, 140)}`);
        break;
      }
    }
  });
}

console.log(`\n--- sweep done: ${hits} hit(s) ---`);
