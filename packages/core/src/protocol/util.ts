/** Newline-normalising split. Every parser works line-by-line, so this is the one entry point. */
export function splitLines(body: string): string[] {
  return body.replace(/\r\n?/g, "\n").split("\n");
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Drop blank lines from both ends without touching interior blank lines. */
export function trimBlankEdges(lines: readonly string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && (lines[start] ?? "").trim() === "") start++;
  while (end > start && (lines[end - 1] ?? "").trim() === "") end--;
  return lines.slice(start, end);
}
