export function formatDateTime(
  value: string | null | undefined,
  emptyPlaceholder = "暂无",
): string {
  if (!value) {
    return emptyPlaceholder;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN");
}
