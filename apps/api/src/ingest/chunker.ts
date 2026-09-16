/**
 * Markdown-aware chunking.
 *
 * Fixed-width chunking cuts sentences and, worse, separates a heading from the
 * text under it -- so a chunk arrives at the model saying "35 days rolling" with
 * no indication that it is about backups. Splitting on heading boundaries first
 * and carrying the heading path into every chunk fixes both: each chunk is
 * self-describing, which is what makes a citation meaningful.
 */

export interface Chunk {
  index: number;
  heading: string | null;
  content: string;
  tokenEstimate: number;
}

export interface ChunkOptions {
  /** Target characters per chunk. ~900 chars is roughly 225 tokens. */
  targetChars?: number;
  /** Characters repeated from the previous chunk, so a fact split across a
   *  boundary still appears whole in at least one chunk. */
  overlapChars?: number;
}

interface Section {
  headingPath: string[];
  body: string;
}

/** Split markdown into sections, tracking the heading hierarchy. */
function splitSections(markdown: string): Section[] {
  const lines = markdown.split(/\r?\n/);
  const sections: Section[] = [];
  const path: string[] = [];
  let buffer: string[] = [];
  let inFence = false;

  const flush = () => {
    const body = buffer.join('\n').trim();
    if (body) sections.push({ headingPath: [...path], body });
    buffer = [];
  };

  for (const line of lines) {
    // Never treat a '#' inside a fenced code block as a heading.
    if (/^```/.test(line.trim())) inFence = !inFence;

    const heading = inFence ? null : line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flush();
      const depth = heading[1]!.length;
      path.length = Math.max(0, depth - 1);
      path[depth - 1] = heading[2]!.trim();
      continue;
    }
    buffer.push(line);
  }
  flush();

  return sections;
}

/** Break a long body on paragraph, then sentence, then hard-character boundaries. */
function packBody(body: string, targetChars: number, overlapChars: number): string[] {
  if (body.length <= targetChars) return [body];

  const paragraphs = body.split(/\n{2,}/);
  const out: string[] = [];
  let current = '';

  const push = () => {
    if (!current.trim()) return;
    out.push(current.trim());
    // Carry the tail of this chunk into the next one.
    current = overlapChars > 0 ? current.slice(-overlapChars) : '';
  };

  for (const para of paragraphs) {
    // A single paragraph over target (a long table, a wall of prose) still has
    // to be broken; do it on sentence ends so chunks stay readable.
    if (para.length > targetChars) {
      const sentences = para.match(/[^.!?\n]+[.!?]+|\S[^.!?\n]*$/g) ?? [para];
      for (const sentence of sentences) {
        if (current.length + sentence.length > targetChars) push();
        current += (current ? ' ' : '') + sentence.trim();
      }
      continue;
    }

    if (current.length + para.length + 2 > targetChars) push();
    current += (current ? '\n\n' : '') + para;
  }
  push();

  return out.filter((c) => c.trim().length > 0);
}

export function chunkMarkdown(markdown: string, opts: ChunkOptions = {}): Chunk[] {
  const targetChars = opts.targetChars ?? 900;
  const overlapChars = opts.overlapChars ?? 150;

  const chunks: Chunk[] = [];
  let index = 0;

  for (const section of splitSections(markdown)) {
    const heading = section.headingPath.filter(Boolean).join(' > ') || null;

    for (const piece of packBody(section.body, targetChars, overlapChars)) {
      // Prefix the heading path into the embedded text. The embedding then
      // encodes the context, so a query about "data retention" matches a chunk
      // that only says "18 months" in its body.
      const content = heading ? `${heading}\n\n${piece}` : piece;
      chunks.push({
        index: index++,
        heading,
        content,
        tokenEstimate: Math.ceil(content.length / 4),
      });
    }
  }

  return chunks;
}

/** Strip and parse the YAML-ish front matter used by db/docs/*.md. */
export function parseFrontMatter(raw: string): {
  meta: Record<string, string>;
  body: string;
} {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { meta: {}, body: raw };

  const meta: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (kv) meta[kv[1]!] = kv[2]!.trim().replace(/^["']|["']$/g, '');
  }

  return { meta, body: raw.slice(match[0].length) };
}
