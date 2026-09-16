/**
 * Retrieval metrics.
 *
 * Retrieval quality and answer quality are separate failure modes and have to be
 * measured apart: a system can retrieve the right passage and write a wrong
 * answer, or retrieve nothing and write a plausible-sounding one. Scoring only
 * the final answer cannot tell those apart, and they need different fixes.
 *
 * All four take `relevant` as an unordered set and `retrieved` as a ranked list.
 */

export function recallAtK(retrieved: string[], relevant: string[], k: number): number {
  if (relevant.length === 0) return 1; // nothing to find: trivially complete
  const top = new Set(retrieved.slice(0, k));
  const found = relevant.filter((ref) => top.has(ref)).length;
  return found / relevant.length;
}

export function precisionAtK(retrieved: string[], relevant: string[], k: number): number {
  const top = retrieved.slice(0, k);
  if (top.length === 0) return 0;
  const relevantSet = new Set(relevant);
  return top.filter((ref) => relevantSet.has(ref)).length / top.length;
}

/**
 * Mean reciprocal rank -- here, reciprocal rank for a single query.
 * Answers "how far down the list is the first useful result?". 1.0 means the
 * top hit was relevant; 0.2 means the user had to read five results.
 */
export function reciprocalRank(retrieved: string[], relevant: string[]): number {
  const relevantSet = new Set(relevant);
  const idx = retrieved.findIndex((ref) => relevantSet.has(ref));
  return idx === -1 ? 0 : 1 / (idx + 1);
}

/**
 * Normalised discounted cumulative gain, binary relevance.
 *
 * Unlike recall, nDCG rewards putting relevant results *early*: two systems that
 * both retrieve all three relevant chunks score identically on recall but
 * differently here if one ranks them 1,2,3 and the other 4,5,6. For a system
 * that feeds the top-k into a context window, that ordering is what determines
 * whether the useful passage survives truncation.
 */
export function ndcg(retrieved: string[], relevant: string[], k: number): number {
  if (relevant.length === 0) return 1;
  const relevantSet = new Set(relevant);

  const dcg = retrieved.slice(0, k).reduce((sum, ref, i) => {
    return sum + (relevantSet.has(ref) ? 1 / Math.log2(i + 2) : 0);
  }, 0);

  // Ideal ranking: every relevant item at the top, capped at k.
  const idealCount = Math.min(relevant.length, k);
  let idcg = 0;
  for (let i = 0; i < idealCount; i++) idcg += 1 / Math.log2(i + 2);

  return idcg === 0 ? 0 : dcg / idcg;
}

/**
 * Substring assertions on the answer.
 *
 * Deliberately crude. A real judge would be an LLM, which costs money and
 * introduces its own bias into a comparison whose whole point is comparing
 * models. Exact-substring checks on the facts that must appear (a price, a
 * company name, a retention period) are cheap, deterministic, and cannot
 * flatter a model that happens to share the judge's family.
 */
export function answerContains(answer: string, expected: string[]): {
  matched: boolean;
  hits: string[];
  misses: string[];
} {
  const haystack = answer.toLowerCase();
  const hits: string[] = [];
  const misses: string[] = [];
  for (const needle of expected) {
    if (haystack.includes(needle.toLowerCase())) hits.push(needle);
    else misses.push(needle);
  }
  return { matched: expected.length > 0 && misses.length === 0, hits, misses };
}

export interface ScoreSet {
  recallAtK: number;
  precisionAtK: number;
  mrr: number;
  ndcg: number;
}

export function scoreRetrieval(retrieved: string[], relevant: string[], k: number): ScoreSet {
  return {
    recallAtK: recallAtK(retrieved, relevant, k),
    precisionAtK: precisionAtK(retrieved, relevant, k),
    mrr: reciprocalRank(retrieved, relevant),
    ndcg: ndcg(retrieved, relevant, k),
  };
}

/** Mean of a numeric field, ignoring nulls. Returns null for an empty set. */
export function mean(values: Array<number | null | undefined>): number | null {
  const nums = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}
