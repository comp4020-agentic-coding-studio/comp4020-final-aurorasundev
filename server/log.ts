// One line per action: time, action, then ids and outcomes. Callers pass ids,
// revisions and outcomes only — never paper text, drafts, cookies, return
// keys or credentials.
export function log(action: string, fields: Record<string, string | number | boolean | undefined> = {}): void {
  const parts = [new Date().toISOString(), action];
  for (const [key, value] of Object.entries(fields)) if (value !== undefined) parts.push(`${key}=${value}`);
  console.log(parts.join(" "));
}
