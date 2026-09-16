import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { config } from '../config.js';
import { pool, query, queryOne, vectorBackend } from '../db.js';
import { embed } from '../embeddings/index.js';
import { chunkMarkdown, parseFrontMatter } from './chunker.js';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export interface IngestReport {
  documents: number;
  skipped: number;
  chunks: number;
  embedded: number;
  backend: string;
  perDocument: Array<{ slug: string; chunks: number; action: 'inserted' | 'updated' | 'skipped' }>;
}

/**
 * Bind an embedding for the column type this database actually has.
 * pgvector wants the '[1,2,3]' text form; the fallback wants a float8[].
 */
async function embeddingParam(vec: number[]): Promise<{ cast: string; value: unknown }> {
  return (await vectorBackend()) === 'pgvector'
    ? { cast: '::vector', value: JSON.stringify(vec) }
    : { cast: '::float8[]', value: vec };
}

async function storeDocument(opts: {
  slug: string;
  title: string;
  sourceType: string;
  uri: string | null;
  content: string;
  metadata: Record<string, unknown>;
  chunkTarget?: number;
}): Promise<{ chunks: number; action: 'inserted' | 'updated' | 'skipped' }> {
  const hash = sha256(opts.content);

  const existing = await queryOne<{ id: number; content_hash: string }>(
    'SELECT id, content_hash FROM documents WHERE slug = $1',
    [opts.slug],
  );

  // Re-embedding unchanged text costs money and rate-limit budget for nothing.
  if (existing && existing.content_hash === hash) {
    const [row] = await query<{ n: number }>(
      'SELECT count(*)::int AS n FROM document_chunks WHERE document_id = $1',
      [existing.id],
    );
    return { chunks: row?.n ?? 0, action: 'skipped' };
  }

  const doc = await queryOne<{ id: number }>(
    `INSERT INTO documents (source_type, slug, title, uri, content, metadata, content_hash)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)
     ON CONFLICT (slug) DO UPDATE SET
       source_type = EXCLUDED.source_type,
       title       = EXCLUDED.title,
       uri         = EXCLUDED.uri,
       content     = EXCLUDED.content,
       metadata    = EXCLUDED.metadata,
       content_hash = EXCLUDED.content_hash,
       updated_at  = now()
     RETURNING id`,
    [opts.sourceType, opts.slug, opts.title, opts.uri, opts.content,
     JSON.stringify(opts.metadata), hash],
  );
  if (!doc) throw new Error(`Failed to upsert document ${opts.slug}`);

  // Replace chunks wholesale. Diffing chunk-by-chunk after an edit that shifts
  // every boundary is more work than re-embedding one document.
  await query('DELETE FROM document_chunks WHERE document_id = $1', [doc.id]);

  const chunks = chunkMarkdown(opts.content, { targetChars: opts.chunkTarget ?? 900 });
  if (!chunks.length) return { chunks: 0, action: existing ? 'updated' : 'inserted' };

  const vectors = await embed(chunks.map((c) => c.content));

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]!;
    const { cast, value } = await embeddingParam(vectors[i]!);
    await query(
      `INSERT INTO document_chunks
         (document_id, chunk_index, source_type, heading, content, token_estimate,
          metadata, embedding, embedding_model, embedding_dim)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8${cast},$9,$10)`,
      [
        doc.id, chunk.index, opts.sourceType, chunk.heading, chunk.content,
        chunk.tokenEstimate, JSON.stringify({ ...opts.metadata, heading: chunk.heading }),
        value, config.embeddings.model, config.embeddings.dim,
      ],
    );
  }

  return { chunks: chunks.length, action: existing ? 'updated' : 'inserted' };
}

/** Ingest every markdown file in db/docs. */
export async function ingestDocsDirectory(dir: string): Promise<IngestReport> {
  const report: IngestReport = {
    documents: 0, skipped: 0, chunks: 0, embedded: 0,
    backend: await vectorBackend(), perDocument: [],
  };

  const files = (await readdir(dir)).filter((f) => extname(f) === '.md').sort();

  for (const file of files) {
    const raw = await readFile(join(dir, file), 'utf8');
    const { meta, body } = parseFrontMatter(raw);
    const slug = basename(file, '.md');

    const { chunks, action } = await storeDocument({
      slug,
      title: meta.title ?? slug,
      sourceType: meta.source_type ?? 'docs',
      uri: meta.uri ?? null,
      content: body.trim(),
      metadata: { file, effective: meta.effective ?? null },
    });

    report.perDocument.push({ slug, chunks, action });
    report.chunks += chunks;
    if (action === 'skipped') report.skipped++;
    else { report.documents++; report.embedded += chunks; }

    console.log(`  ${action.padEnd(9)} ${slug.padEnd(34)} ${chunks} chunk(s)`);
  }

  return report;
}

/**
 * Also embed the structured monographs.
 *
 * This is what makes the lab interesting rather than a toy: the same question
 * can now be answered by an exact SQL lookup OR by semantic retrieval over the
 * clinical prose, and the evaluation harness can show which does better for
 * which question shape. "What is used for reducing suicidal behaviour in
 * schizophrenia?" is a retrieval question even though the answer lives in a
 * relational column.
 *
 * Bounded by `limit` because embedding all 2,512 monographs is ~2,500 API calls
 * -- fine on a paid key, a poor default on a free one.
 */
export async function ingestGenericMonographs(limit = 200): Promise<IngestReport> {
  const report: IngestReport = {
    documents: 0, skipped: 0, chunks: 0, embedded: 0,
    backend: await vectorBackend(), perDocument: [],
  };

  // Prefer the monographs users are most likely to ask about: the ingredients
  // with the most brands on the market.
  const rows = await query<{
    generic_id: number; generic_name: string; indication: string | null;
    adult_dose: string | null; child_dose: string | null; renal_dose: string | null;
    contra_indication: string | null; precaution: string | null; interaction: string | null;
    side_effect: string | null; mode_of_action: string | null;
    pregnancy_category: string | null; brand_count: number;
  }>(
    `SELECT generic_id, generic_name, indication, adult_dose, child_dose, renal_dose,
            contra_indication, precaution, interaction, side_effect, mode_of_action,
            pregnancy_category, brand_count
       FROM v_generic_full
      WHERE indication IS NOT NULL AND length(indication) > 80
      ORDER BY brand_count DESC
      LIMIT $1`,
    [limit],
  );

  console.log(`  embedding ${rows.length} monograph(s) (top by brand count)`);

  for (const row of rows) {
    // Render as markdown so the chunker's heading logic carries section names
    // into each chunk -- a chunk of dosing text is labelled as dosing text.
    const sections: Array<[string, string | null]> = [
      ['Indication', row.indication],
      ['Mode of action', row.mode_of_action],
      ['Adult dose', row.adult_dose],
      ['Child dose', row.child_dose],
      ['Renal dose', row.renal_dose],
      ['Contraindications', row.contra_indication],
      ['Precautions', row.precaution],
      ['Interactions', row.interaction],
      ['Side effects', row.side_effect],
      ['Pregnancy category', row.pregnancy_category],
    ];

    const markdown = [`# ${row.generic_name}`, '']
      .concat(sections
        .filter(([, v]) => v && v.trim())
        .flatMap(([label, v]) => [`## ${label}`, '', v!.trim(), '']))
      .join('\n');

    const { chunks, action } = await storeDocument({
      slug: `generic-${row.generic_id}`,
      title: `${row.generic_name} (monograph)`,
      sourceType: 'generic_monograph',
      uri: null,
      content: markdown,
      metadata: { generic_id: row.generic_id, generic_name: row.generic_name, brand_count: row.brand_count },
      // Clinical prose is dense; smaller chunks keep one topic per chunk.
      chunkTarget: 700,
    });

    report.perDocument.push({ slug: `generic-${row.generic_id}`, chunks, action });
    report.chunks += chunks;
    if (action === 'skipped') report.skipped++;
    else { report.documents++; report.embedded += chunks; }
  }

  return report;
}

export async function closePool(): Promise<void> {
  await pool.end();
}
