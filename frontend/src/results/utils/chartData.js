export function compactLabel(value, maxLength = 16) {
  const text = String(value ?? "");
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

export function buildCorrelationMatrix(correlations) {
  const scores = new Map();
  const lookup = new Map();

  (correlations || []).forEach((item) => {
    const left = item.left_column;
    const right = item.right_column;
    const value = Number(item.coefficient);
    if (!left || !right || !Number.isFinite(value)) return;

    scores.set(left, (scores.get(left) || 0) + Math.abs(value));
    scores.set(right, (scores.get(right) || 0) + Math.abs(value));
    lookup.set(matrixKey(left, right), value);
    lookup.set(matrixKey(right, left), value);
  });

  const columns = Array.from(scores.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 14)
    .map(([name]) => name);

  return { columns, lookup };
}

export function matrixKey(left, right) {
  return `${left}__${right}`;
}

export function correlationColor(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "#f8fafc";
  const magnitude = Math.min(1, Math.abs(value));
  const alpha = 0.12 + magnitude * 0.82;
  if (value >= 0) return `rgba(15, 118, 110, ${alpha})`;
  return `rgba(220, 38, 38, ${alpha})`;
}

export function buildTopCorrelationPairs(correlations, limit = 10) {
  return [...(correlations || [])]
    .filter((item) => Number.isFinite(Number(item.coefficient)))
    .sort((a, b) => Math.abs(Number(b.coefficient)) - Math.abs(Number(a.coefficient)))
    .slice(0, limit)
    .map((item) => ({
      ...item,
      name: `${item.left_column} / ${item.right_column}`,
      shortName: `${compactLabel(item.left_column, 14)} / ${compactLabel(item.right_column, 14)}`,
      value: Number(Number(item.coefficient).toFixed(3)),
    }));
}
