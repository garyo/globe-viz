/**
 * Render a 'YYYY-MM-DD' data date for display, e.g. "Mar 3, 2025".
 *
 * The 'T00:00:00' suffix keeps the string in local time — parsing a bare
 * 'YYYY-MM-DD' is treated as UTC midnight, which renders as the previous day
 * for anyone west of Greenwich.
 */
export function formatDate(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
