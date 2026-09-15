# Deployment and infrastructure

## Stack, and why each piece

| Concern | Choice | Reasoning for a team of 2-4 |
|---|---|---|
| Frontend + API | Next.js on Vercel | One language, one repo, one deploy. Server components keep the mobile payload small, which matters for a product used on phones. |
| Database, auth, storage | Supabase (Postgres + RLS) | One vendor covers four concerns. Row-level security is enforced *at the database*, so a bug in application code cannot leak another student's record. |
| Background work | Inngest | Step-level retries and replay without operating a worker fleet. Extraction, freshness sweeps, and reminders are all jobs. |
| Search | Postgres FTS + pgvector | Adequate well past our scale. One datastore to back up, secure, and disclose. |
| AI | Anthropic API | Students act on this output; quality is the product. |

## On adding a vector database or a memory vendor

Resist it, at least until there is real usage.

The argument for Pinecone or Mem0 is usually semantic retrieval or cross-session memory. Neither is Pathway's actual problem:

- **Our memory is the confirmed profile.** It is relational and structured — activities, hours, constraints, edit history — and it needs row-level security, version history, and atomic writes. Those are database properties, not vector-store properties.
- **Semantic search applies only to the catalog and college corpus**, a few hundred to a few thousand documents. pgvector handles that without strain.
- **Every additional processor is a COPPA disclosure.** The amended Rule requires separate consent for third-party disclosures. Two data stores means two consent surfaces, two breach surfaces, and two vendors in the legal review.

Revisit when the corpus passes roughly 10k documents or retrieval quality is measurably the bottleneck — measured, not assumed.

## Environments

- `production` — Vercel production, Supabase production project
- `preview` — Vercel preview deploys, Supabase branch database
- `local` — `supabase start` for a local Postgres with the same schema

Schema changes go through migrations, never the dashboard. The schema is the contract.

## Cost model

From our own analysis, per month excluding salaries:

| Monthly active students | Infrastructure | AI | Total | Per student |
|---|---|---|---|---|
| 100 (pilot) | $50-140 | $44-138 | $95-280 | $0.95-2.80 |
| 1,000 | $160-515 | $440-1,380 | $600-1,900 | $0.60-1.90 |
| 10,000 | $935-2,930 | $4,400-13,800 | $5,300-16,700 | $0.53-1.67 |

Two conclusions:

1. **AI is 75-85% of marginal cost at every scale.** Engineering effort belongs on prompt caching, context sizing, and per-student budget caps — not infrastructure tuning. Infrastructure is close to a rounding error until roughly 10,000 students.
2. **A fully free tier at 10,000 students costs $4.4k-13.8k a month.** That has to be a deliberate, capped, funded decision, not a default. Hence `AI_BUDGET_PER_STUDENT_CENTS`.

The largest real cost at every scale is not in this table: the catalog curator. Without a named person, catalog quality decays and the product's central trust claim goes with it.

## Launch gates

No partial launch. Any failing gate stops the pilot.

- **G1 Correctness** — profile round-trip, write atomicity, plan versioning, duplicate submissions, deadline arithmetic. Zero known data-loss defects.
- **G2 Permissions** — every endpoint × role × grant state. A manual attempt to read another student's reflections fails by every available path.
- **G3 AI safety** — hallucinated fields = 0, constraint violations = 0, safety redirects = 100%, counselor approval of generated plans ≥70%. Enforced by `npm run eval`.
- **G4 Resilience** — chaos test green, restore drill inside the four-hour recovery objective.
- **G5 Legal** — review complete, model-provider agreement signed, policies published in plain language.
- **G6 Accessibility** — WCAG 2.2 AA, zero critical findings.

A permissions or data-loss defect found by a student handling their own record is not recoverable. That is why there is no partial launch.

## Privacy posture

Obligations needing counsel:

- **COPPA** — amended Rule adds a written security programme, a written retention policy, and separate consent for third-party disclosures. Disclosure to a model provider plausibly qualifies.
- **FERPA** — generally outside a direct-to-family product; a school deployment likely brings us in as a school official.
- **State operator laws** — SOPIPA-style: no targeted advertising, no commercial profiling, no data sale.

Product controls we hold regardless of what applies:

- Reflections private by default and unreachable from every staff surface
- Scoped, revocable, audited access grants; the student always owns the profile
- Self-service export and deletion; purge within 30 days
- No ad targeting, profiling, data sale, or marketing trackers in the authenticated product
- Not collected at all: SSNs, full addresses, family financial detail, race, religion, health, immigration status, biometrics, continuous location

Pursue zero data retention with the model provider before the pilot. It materially simplifies the legal review.
