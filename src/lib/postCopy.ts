export function normalizeCarouselCopy(
  values: unknown,
  slideCount: number,
): string[] {
  const source = Array.isArray(values) ? values : [];
  return Array.from({ length: Math.max(0, slideCount) }, (_, index) =>
    typeof source[index] === "string" ? source[index] : "",
  );
}

export function moveCarouselCopy(
  values: string[],
  index: number,
  direction: -1 | 1,
): string[] {
  const target = index + direction;
  if (index < 0 || index >= values.length || target < 0 || target >= values.length) {
    return values;
  }

  const next = [...values];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function hasWrittenCopy(copyText: string, carouselCopy: string[]): boolean {
  return copyText.trim().length > 0 || carouselCopy.some((value) => value.trim().length > 0);
}
