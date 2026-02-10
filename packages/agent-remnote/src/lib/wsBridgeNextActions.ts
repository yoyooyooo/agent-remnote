export function buildDbFallbackNextAction(queryText: string): string {
  const q = String(queryText || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!q) return 'Fallback to DB search: agent-remnote search --query "<keywords>"';
  const clipped = q.length > 80 ? `${q.slice(0, 77)}...` : q;
  const escaped = clipped.replaceAll('"', '\\"');
  return `Fallback to DB search: agent-remnote search --query "${escaped}"`;
}
