export function formatValue(value: any): string {
  if (typeof value === 'object' && value !== null) {
    if ('Type' in value && 'Value' in value) {
      return formatValue(value['Value']);
    }
    return Object.entries(value)
      .map(([k, v]) => `${k}[${formatValue(v)}]`)
      .join(' ');
  } else if (Array.isArray(value)) {
    return value.map(formatValue).join(' ');
  } else {
    return String(value);
  }
}

function normalizeLogLevel(level: string | undefined): string {
  if (!level) return "I";
  const upper = level.toUpperCase();
  switch (upper) {
    case "INFO": return "I";
    case "WARN":
    case "WARNING": return "W";
    case "ERROR":
    case "ERR": return "E";
    case "DEBUG": return "D";
    case "TRACE": return "T";
    default: return upper[0]; // берём первую букву
  }
}

export function getMaxWidthsFromDoc(doc: import('vscode').TextDocument) {
  let widthModule = 0;
  let widthCategory = 0;

  for (let i = 0; i < doc.lineCount; i++) {
    const line = doc.lineAt(i).text;
    try {
      const obj = JSON.parse(line);
      widthModule = Math.max(widthModule, (obj.ModuleName || '').length);
      widthCategory = Math.max(widthCategory, (obj.Category || '').length);
    } catch {
      // игнорируем строки, которые не JSON
    }
  }

  return { widthModule, widthCategory };
}

export function formatLogEntry(
  entry: any,
  widths: { widthModule: number; widthCategory: number }
): string {
  const dt = new Date(entry.Date);
  const timeStr =
    dt.toTimeString().split(" ")[0] +
    ":" +
    dt.getMilliseconds().toString().padStart(3, "0");

  const moduleStr = `[ ${String(entry.ModuleName || "").padEnd(widths.widthModule)} ]`;
  const categoryStr = `[ ${String(entry.Category || "").padEnd(widths.widthCategory)} ]`;

  // нормализуем уровень
  const levelStr = `[${normalizeLogLevel(entry.LogLevel)}]`;

  const params: string[] = [];
  for (const key in entry) {
    if (["Date", "ModuleName", "Category", "LogLevel", "Title"].includes(key))
      continue;
    params.push(`${key}[${JSON.stringify(entry[key])}]`);
  }

  return `[${timeStr}] ${moduleStr} ${categoryStr}${levelStr} ${entry.Title || ""
    } ${params.join(" ")}`.trim();
}