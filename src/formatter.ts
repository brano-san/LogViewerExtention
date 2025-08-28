export function formatValue(value: any): string {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    if ('Type' in value && 'Value' in value) {
      return formatValue((value as any)['Value']);
    } else {
      return Object.entries(value)
        .map(([k, v]) => `${k}[${formatValue(v)}]`)
        .join(' ');
    }
  } else if (Array.isArray(value)) {
    return value.map(formatValue).join(' ');
  }
  return String(value);
}

export function convertLog(entry: any, widthModule: number, widthCategory: number): string {
  let timeStr = entry?.Date ?? '';
  try {
    if (typeof entry?.Date === 'string') {
      const parts = entry.Date.split('.');
      const base = parts[0];
      const ms = (parts[1] || '000').slice(0, 3);
      const dt = new Date(base.replace(' ', 'T') + 'Z'); // naive parse; we only need HH:MM:SS
      const hh = String(dt.getUTCHours()).padStart(2, '0');
      const mm = String(dt.getUTCMinutes()).padStart(2, '0');
      const ss = String(dt.getUTCSeconds()).padStart(2, '0');
      timeStr = `${hh}:${mm}:${ss}:${ms}`;
    }
  } catch { /* keep original */ }

  const module = entry?.ModuleName ?? '';
  const category = entry?.Category ?? '';
  const level = (entry?.LogLevel ? String(entry.LogLevel).toUpperCase()[0] : 'I');
  const title = entry?.Title ?? '';

  const params: string[] = [];
  for (const [k, v] of Object.entries(entry || {})) {
    if (['Date','ModuleName','Category','LogLevel','Title'].includes(k)) continue;
    params.push(`${k}[${formatValue(v)}]`);
  }

  const moduleStr = `[ ${module.padEnd(widthModule, ' ')} ]`;
  const categoryStr = `[ ${category.padEnd(widthCategory, ' ')} ]`;
  return `[${timeStr}] ${moduleStr} ${categoryStr}[${level}] ${title} ${params.join(' ')}`.trim();
}

export function computeWidths(entries: any[]): { widthModule: number; widthCategory: number } {
  let wM = 0, wC = 0;
  for (const e of entries) {
    wM = Math.max(wM, (e?.ModuleName ?? '').length);
    wC = Math.max(wC, (e?.Category ?? '').length);
  }
  return { widthModule: wM, widthCategory: wC };
}