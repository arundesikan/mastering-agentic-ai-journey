/**
 * Retrieval over the sourced college corpus.
 *
 * Start lexical (below), move to pgvector embeddings when the corpus outgrows it.
 * Our own cost analysis says Postgres FTS + pgvector is adequate well past 10k
 * documents, which is why there is no separate vector vendor here: one datastore
 * to back up, one to secure, one COPPA disclosure instead of two.
 */

export interface SourceRow {
  id: string;
  subject: string;
  field: string;
  text: string;
  source: string;
  asOf: string;
}

const STOPWORDS = new Set([
  'what','which','does','the','and','for','are','with','from','that','this',
  'their','they','would','about','into','have','has','you','your','my','me',
  'of','to','in','a','is','it','at','on','do','i',
]);

export function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9]{2,}/g) || []).filter((w) => !STOPWORDS.has(w));
}

export function retrieve(query: string, corpus: SourceRow[], k = 6) {
  const qTerms = tokenize(query);
  const N = corpus.length;
  const df: Record<string, number> = {};
  for (const t of qTerms) {
    df[t] = corpus.filter((c) => tokenize(`${c.text} ${c.subject} ${c.field}`).includes(t)).length;
  }
  return corpus
    .map((c) => {
      const docTerms = tokenize(`${c.text} ${c.subject} ${c.field}`);
      let score = 0;
      for (const t of qTerms) {
        if (docTerms.includes(t)) score += Math.log((N + 1) / ((df[t] || 0) + 1)) + 1;
      }
      return { row: c, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

/**
 * A citation to a row that was never retrieved is a hard failure, in the same
 * class as a hallucinated profile field. This check runs after every answer.
 */
export function verifyCitations(cited: string[], retrievedIds: string[]) {
  const bogus = cited.filter((c) => !retrievedIds.includes(c));
  return { valid: bogus.length === 0, bogus };
}
