# What to build next, in order

Screens are cheap. The things below are what turn this into a product people use.

## 1. Persistence (blocks everything else)
Supabase project, apply `schema.sql`, wire the two API routes to real tables.
Until this exists, nothing accumulates — and accumulation *is* the value thesis.
**Done when:** a student closes the tab, comes back tomorrow, and their record is there.

## 2. Auth and the consent gate (FR-01)
Supabase Auth, age gate, guardian consent for 13-15.
Decision needed first: floor at 13, or accept under-13 with verifiable guardian consent? (OQ-1)
**Done when:** two students exist and neither can see the other's anything.

## 3. Intake (FR-02)
Hours, budget, transport, obligations, direction (including "undecided").
This is the constraint set everything downstream filters by.
**Done when:** a new student reaches their first plan without a developer involved.

## 4. Reminders and cadence (FR-32)
Inngest scheduled jobs. Quiet hours, snooze, pause, catch-up mode, auto-pause at 8 weeks.
Max three notifications per student per week, one per day. No streaks, no leaderboards.
**This is where VA-1 actually gets tested** — the loop only compounds if people return.
**Done when:** a student who ignores it for three weeks gets a humane re-entry, not a guilt trip.

## 5. Real catalog (FR-36)
200-400 reviewed listings with linked source rows. Freshness sweep, admin review queue.
Staffed work, not an engineering task. Needs a named owner by month 2 (OQ-8).
**Done when:** a $150-budget student with no car gets three eligible matches.

## 6. Exports (FR-15, FR-45)
JSON, PDF, CSV. Résumé export is immediately useful for jobs and programs.
Cheap to build, and it's what makes "the student owns this" true rather than rhetorical.

## 7. Pilot
60-100 students, 3+ counselors, 12 weeks, no new features.
Go/no-go against the validation assumptions.

---

## The assumptions the whole thesis rests on

| ID | Assumption | Kill signal |
|---|---|---|
| VA-1 | Students complete a two-minute check-in four weeks running, without an adult forcing it | Under 25% reach four consecutive weeks |
| VA-2 | Confirmed extraction feels like a benefit, not a chore | Under 60% of proposals reviewed within seven days |
| VA-3 | Families pay for continuity, not only for grade-12 applications | No conversion at any tested price |
| VA-4 | A few hundred curated opportunities feel personal | Over 30% of students get fewer than three eligible, affordable matches |
| VA-6 | A real counselor judges the generated plans realistic | Under 70% rated "would give this to a student" |

VA-1 is the one that matters. Everything else is downstream of whether a teenager
comes back in week four. It is also cheap to test — 15-20 students and four weeks,
no further engineering required. Do this before building more product.
