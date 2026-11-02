/**
 * A tiny, safe Markdown subset for the bundled legal pages: headings (#..###),
 * paragraphs, "- " and "1. " lists, "> " notes, **bold**, and links. It
 * produces plain data for <Text>; nothing is ever rendered as HTML.
 * Links: only to the other bundled pages (privacy.md, terms.md,
 * delete-account.md) become in-app links; anything else stays plain text
 * (no browser from legal pages, no remote URLs).
 * {{PLACEHOLDERS}} C1 hasn't filled yet show as "(to be added)".
 */
export type Inline = { text: string; bold?: boolean; link?: string };
export type Block =
  | { kind: 'heading'; level: 1 | 2 | 3; inline: Inline[] }
  | { kind: 'paragraph'; inline: Inline[] }
  | { kind: 'note'; inline: Inline[] }
  | { kind: 'bullet'; inline: Inline[] }
  | { kind: 'numbered'; n: number; inline: Inline[] };

const INTERNAL = new Map([
  ['privacy.md', 'privacy'],
  ['terms.md', 'terms'],
  ['delete-account.md', 'delete-account'],
]);

export function parseInline(src: string): Inline[] {
  const text = src.replace(/\{\{[A-Z_]+\}\}/g, '(to be added)');
  const out: Inline[] = [];
  const re = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    if (m[1] !== undefined) {
      for (const part of parseInline(m[1])) out.push({ ...part, bold: true });
    } else {
      const target = INTERNAL.get(m[3] ?? '');
      out.push(target ? { text: m[2] ?? '', link: target } : { text: m[2] ?? '' });
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

export function parseMarkdown(md: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: 'paragraph', inline: parseInline(para.join(' ')) });
    para = [];
  };
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trim();
    let m: RegExpExecArray | null;
    if (!line) flush();
    else if ((m = /^(#{1,3})\s+(.*)$/.exec(line))) {
      flush();
      blocks.push({ kind: 'heading', level: (m[1]?.length ?? 1) as 1 | 2 | 3, inline: parseInline(m[2] ?? '') });
    } else if ((m = /^>\s?(.*)$/.exec(line))) {
      flush();
      blocks.push({ kind: 'note', inline: parseInline(m[1] ?? '') });
    } else if ((m = /^[-*]\s+(.*)$/.exec(line))) {
      flush();
      blocks.push({ kind: 'bullet', inline: parseInline(m[1] ?? '') });
    } else if ((m = /^(\d{1,3})\.\s+(.*)$/.exec(line))) {
      flush();
      blocks.push({ kind: 'numbered', n: Number(m[1]), inline: parseInline(m[2] ?? '') });
    } else para.push(line);
  }
  flush();
  return blocks;
}
