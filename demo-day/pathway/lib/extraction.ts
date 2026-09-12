/**
 * Extraction: free text -> proposed structured changes.
 *
 * Two invariants this module exists to protect:
 *   1. The raw text is persisted BEFORE this is ever called (see app/api/updates).
 *   2. Nothing returned here is written. It becomes rows in change_proposals,
 *      and only a student's confirmation promotes it to a profile fact.
 */
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export const EXTRACTION_SYSTEM = `You are the extraction module inside Pathway.

You receive a student's free-text weekly check-in and propose structured updates. You never write anything.

STRICT RULES:
- Only propose what the text supports. Never invent achievements, titles, hours, or skills.
- Never assign a leadership title unless the student's own words state that title. Describing tasks is not a title.
- Every proposal needs an "evidence" field drawn from the student's own words.
- Informal assessments (quizzes) are context, never a GPA change.
- Paid work and caregiving are real experience. Never frame them as a limitation.
- Tentative statements ("I might", "thinking about") are not confirmed activities.
- At most two clarifying questions, and an unanswered question never blocks other proposals.

Output ONLY valid JSON:
{ "proposals": [ { "type": "new_activity"|"skill_update"|"academic_datapoint"|"capacity_update",
  "confidence": "high"|"medium", "summary": "...", "detail": "...", "evidence": "...", "note": "" } ],
  "clarifying_question": null }`;

export interface Proposal {
  type: string;
  confidence: 'low' | 'medium' | 'high';
  summary: string;
  detail: string;
  evidence: string;
  note?: string;
}

export interface ExtractionResult {
  proposals: Proposal[];
  clarifying_question: string | null;
}

export async function extract(
  rawText: string,
  computedFacts: Record<string, unknown>
): Promise<ExtractionResult> {
  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1500,
    system: EXTRACTION_SYSTEM,
    messages: [
      {
        role: 'user',
        content:
          `COMPUTED FACTS (already decided in code — do not recalculate):\n` +
          JSON.stringify(computedFacts, null, 2) +
          `\n\nSTUDENT CHECK-IN:\n"${rawText}"`,
      },
    ],
  });

  const text = msg.content.filter((b) => b.type === 'text').map((b: any) => b.text).join('\n');
  const parsed = JSON.parse(stripFences(text)) as ExtractionResult;
  return validate(parsed, rawText);
}

function stripFences(s: string): string {
  const t = s.trim().replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a === -1 || b <= a) throw new Error('No JSON object in model output');
  return t.slice(a, b + 1);
}

/**
 * Schema and groundedness validation runs before anything reaches the database.
 * A proposal whose evidence does not trace to the student's text is dropped,
 * not shown and quietly trusted.
 */
export function validate(r: ExtractionResult, source: string): ExtractionResult {
  const kept = (r.proposals || []).filter((p) => {
    if (!p.summary || !p.evidence || !p.type) return false;
    return isGrounded(p.evidence, source);
  });
  return { proposals: kept, clarifying_question: r.clarifying_question ?? null };
}

export function isGrounded(evidence: string, source: string, threshold = 0.6): boolean {
  const src = source.toLowerCase();
  const words = (evidence.toLowerCase().match(/[a-z]{4,}/g) || []);
  if (words.length === 0) return false;
  const hits = words.filter((w) => src.includes(w)).length;
  return hits / words.length >= threshold;
}
