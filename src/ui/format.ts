/**
 * Formats repository totals without rounding away the exact value.
 */
export function formatRepositoryCount(
  value: number,
  locale?: Intl.LocalesArgument,
): string {
  return new Intl.NumberFormat(locale).format(value);
}
