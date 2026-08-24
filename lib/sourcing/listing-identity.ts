const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

export function aiListingIdentity(rawData: unknown) {
  const recognition = record(record(rawData).productRecognition);
  const groups = Array.isArray(recognition.productGroups) ? recognition.productGroups.map(record) : [];
  const primary = groups[0] ?? {};
  const name = primary.sellingTitle ?? recognition.sellingTitle;
  const category = primary.categoryChild ?? recognition.categoryChild;
  return {
    name: typeof name === "string" && name.trim() ? name.trim() : null,
    category: typeof category === "string" && category.trim() ? category.trim() : null,
  };
}
