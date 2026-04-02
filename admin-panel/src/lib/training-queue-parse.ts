/** Strip QUEUE_ITEM lines from assistant text and return structured queue rows. */

export type ParsedQueueItem = { title: string; detail: string };

export function extractQueueItemsFromAssistantText(text: string): {
  displayText: string;
  items: ParsedQueueItem[];
} {
  const lines = text.split("\n");
  const kept: string[] = [];
  const items: ParsedQueueItem[] = [];

  for (const line of lines) {
    const m = line.match(/^\s*QUEUE_ITEM:\s*(.+)\s*$/i);
    if (m) {
      const rest = m[1].trim();
      const pipe = rest.indexOf("|");
      const title = pipe >= 0 ? rest.slice(0, pipe).trim() : rest;
      const detail = pipe >= 0 ? rest.slice(pipe + 1).trim() : "";
      if (title.length > 0) {
        items.push({ title, detail });
      }
    } else {
      kept.push(line);
    }
  }

  let displayText = kept.join("\n").trim();
  if (!displayText && items.length > 0) {
    displayText =
      "(Items were added to the team queue below. Expand the queue panel to review.)";
  }

  return { displayText, items };
}
