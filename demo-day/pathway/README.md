# Pathway

An ongoing college-planning agent for U.S. high school students, built around a two-minute weekly check-in rather than a one-time questionnaire.

The problem is not choosing a college. It's the ~180 weeks between grade 9 and application, where the record actually gets built and nothing keeps it current.

## The one design decision everything else follows from

There is a hard line between what is **computed** and what is **generated**.

| Always computed — plain code and SQL | Always generated — the model |
|---|---|
| Eligibility: grade, age, geography, cost, dates | Why something fits this student |
| Deadline arithmetic and days remaining | Wording of goals, tasks, insights |
| Prerequisite satisfaction, course sequencing | Extraction of facts from free text |
| Weekly capacity versus task effort | Ranking within an already-filtered set |
| Replan trigger evaluation | Re-interpretation on a direction change |

The model is never asked "is this student eligible?" or "when is this due?" It receives the computed answer and explains it. A hallucinated eligibility claim is therefore not a possible failure mode.

There is also **no write tool**. The model returns a proposal document; the profile is written only after the student confirms.

## Repo layout

```
supabase/schema.sql     tables, RLS policies, the atomic resolve_proposals function
lib/tools.ts            eligibility, date math, capacity, plan validation
lib/triggers.ts         deterministic replan trigger rules
lib/extraction.ts       free text -> proposals, with groundedness validation
lib/retrieval.ts        lexical retrieval + citation verification
app/api/updates/        POST a check-in. Persists raw text before any model call.
app/api/proposals/      Resolve proposals in one transaction. All or nothing.
evals/                  8 fixtures and a CI runner. These are the G3 launch gates.
docs/                   architecture and deployment notes
```

## Setup

```bash
npm install
cp .env.example .env.local     # fill in Supabase and Anthropic keys
supabase db push               # apply schema.sql
npm run dev
```

Run the eval suite before shipping any prompt change:

```bash
npm run eval
```

It exits non-zero on failure, so it works as a CI gate.

## Invariants worth knowing before you change anything

1. **Raw text is committed before any model call**, in its own transaction. An extraction failure must never lose a student's words.
2. **Reflections have exactly one RLS policy**: the owning student. Not counselors, not guardians, not support staff. A test reads them with a full-scope grant and expects zero rows.
3. **Plans are immutable versions.** A revision writes a new version and carries completed work forward by `task_key`. It never mutates history.
4. **An opportunity cannot exist without a linked source row.** That's a NOT NULL foreign key, not a convention.
5. **No admission-probability score, ever.** Not a feature gap — a product commitment. Transparent readiness indicators replace it.

## What is not built yet

Being explicit, so nobody mistakes the prototype for the product:

- Accounts, auth, and the COPPA consent gate (schema is ready; flows are not)
- Reminders, quiet hours, catch-up mode — the entire cadence system
- Real catalog data (target: 200-400 reviewed listings at launch)
- Evidence file storage and exports
- Embedding-based retrieval (lexical today; pgvector column exists)
- Admin curation tooling beyond the demo view

## Status

Prototype. The agent layer, the guardrails, and the evals are real. Persistence is being built. Nothing here has been used by an actual student yet, and the assumption that a teenager completes four check-ins in a row without an adult forcing it (VA-1) remains unvalidated — which is the only thing that really matters next.
