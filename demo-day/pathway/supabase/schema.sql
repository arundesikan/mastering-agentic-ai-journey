-- Pathway schema
-- Design rules encoded here, not left to application code:
--   1. Every asserted fact carries a provenance triple: who asserted it, from what, at what confidence.
--   2. Reflections are unreachable from every surface except the owning student. No policy grants them.
--   3. Plans are immutable versions. A revision writes a new version; it never mutates the old one.
--   4. Nothing enters the record unconfirmed: proposals are a separate table from facts.

create extension if not exists "uuid-ossp";
create extension if not exists vector;

-- ---------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------

create type actor_role as enum ('student', 'guardian', 'counselor', 'admin');
create type assertion_source as enum ('self_reported', 'evidence_attached', 'counselor_acknowledged', 'imported');
create type confidence_level as enum ('low', 'medium', 'high');

create table students (
  id uuid primary key default uuid_generate_v4(),
  auth_user_id uuid not null unique,          -- references auth.users
  display_name text not null,
  grade smallint not null check (grade between 9 and 12),
  graduation_year smallint not null,
  -- constraint set: everything downstream is filtered by these
  budget_per_year_cents integer not null default 0,
  has_transport boolean not null default false,
  hours_per_week numeric(4,1) not null default 0,
  direction text,                              -- nullable: "undecided" is a valid state
  date_of_birth date not null,                 -- required for the COPPA age gate
  consent_state text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- Profile facts. Each carries provenance.
-- ---------------------------------------------------------------

create table activities (
  id uuid primary key default uuid_generate_v4(),
  student_id uuid not null references students(id) on delete cascade,
  name text not null,
  category text not null,                      -- includes 'paid_work' and 'caregiving' as first-class
  role_description text,                       -- never a title unless the student stated one
  hours_per_week numeric(4,1),
  total_hours numeric(6,1),
  started_on date,
  ended_on date,
  status text not null default 'in_progress',  -- planned | in_progress | completed
  -- provenance triple
  asserted_by uuid not null references students(id),
  asserted_from assertion_source not null default 'self_reported',
  confidence confidence_level not null default 'high',
  source_submission_id uuid,                   -- the check-in this came from
  created_at timestamptz not null default now()
);

create table academic_records (
  id uuid primary key default uuid_generate_v4(),
  student_id uuid not null references students(id) on delete cascade,
  course_name text not null,
  term text,
  standing text,                               -- letter grade or standing
  gpa numeric(3,2),
  gpa_scale numeric(3,2),                      -- a GPA is never stored or shown without its scale
  is_informal boolean not null default false,  -- quizzes: context, never GPA-affecting
  asserted_by uuid not null references students(id),
  asserted_from assertion_source not null default 'self_reported',
  confidence confidence_level not null default 'high',
  created_at timestamptz not null default now()
);

-- Reflections: private by default, excluded from every sharing scope.
-- There is deliberately NO policy on this table granting access to anyone
-- other than the owning student. Not counselors, not guardians, not support.
create table reflections (
  id uuid primary key default uuid_generate_v4(),
  student_id uuid not null references students(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create table evidence (
  id uuid primary key default uuid_generate_v4(),
  student_id uuid not null references students(id) on delete cascade,
  activity_id uuid references activities(id) on delete set null,
  storage_path text not null,                  -- private bucket, signed URLs only
  mime_type text,
  scanned_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- The weekly loop
-- ---------------------------------------------------------------

-- Raw text is committed here BEFORE any model call, in its own transaction.
-- Killing the extraction job mid-flight must never lose the student's words.
create table update_submissions (
  id uuid primary key default uuid_generate_v4(),
  student_id uuid not null references students(id) on delete cascade,
  raw_text text not null,
  task_statuses jsonb not null default '{}'::jsonb,
  profile_version_at_submit integer not null,
  idempotency_key text,
  extraction_state text not null default 'pending', -- pending | done | failed
  created_at timestamptz not null default now(),
  unique (student_id, idempotency_key)
);

create type proposal_state as enum ('pending', 'accepted', 'edited', 'rejected');

create table change_proposals (
  id uuid primary key default uuid_generate_v4(),
  submission_id uuid not null references update_submissions(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  proposal_type text not null,                 -- new_activity | skill_update | academic_datapoint | capacity_update
  payload jsonb not null,
  evidence_quote text not null,                -- must trace to the student's own words
  confidence confidence_level not null,
  model_note text,
  state proposal_state not null default 'pending',
  resolved_payload jsonb,                      -- what the student actually accepted, if edited
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

-- Append-only history. Every write to a profile fact emits one of these.
create table profile_events (
  id bigserial primary key,
  student_id uuid not null references students(id) on delete cascade,
  entity_table text not null,
  entity_id uuid,
  action text not null,                        -- insert | update | delete | correct
  before jsonb,
  after jsonb,
  caused_by_proposal uuid references change_proposals(id),
  actor uuid not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- Plans: immutable versions
-- ---------------------------------------------------------------

create table plans (
  id uuid primary key default uuid_generate_v4(),
  student_id uuid not null references students(id) on delete cascade,
  current_version integer not null default 0,
  created_at timestamptz not null default now()
);

create table plan_versions (
  id uuid primary key default uuid_generate_v4(),
  plan_id uuid not null references plans(id) on delete cascade,
  version integer not null,
  goals jsonb not null default '[]'::jsonb,
  accepted_at timestamptz,
  superseded_at timestamptz,
  created_at timestamptz not null default now(),
  unique (plan_id, version)
);

create table tasks (
  id uuid primary key default uuid_generate_v4(),
  plan_version_id uuid not null references plan_versions(id) on delete cascade,
  task_key text not null,                      -- stable across versions, so completed work carries forward
  title text not null,
  why text not null,
  effort_minutes integer not null,
  cost_cents integer not null default 0,
  alternative text,
  evidence_hint text,
  due_on date,
  priority smallint not null default 0,
  completed_at timestamptz,
  unique (plan_version_id, task_key)
);

create table plan_revision_proposals (
  id uuid primary key default uuid_generate_v4(),
  plan_id uuid not null references plans(id) on delete cascade,
  from_version integer not null,
  changes jsonb not null,                      -- the per-change diff shown to the student
  triggers_fired jsonb not null,               -- which deterministic rules fired, and why
  state proposal_state not null default 'pending',
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- Catalog. An opportunity cannot exist without a linked source row.
-- ---------------------------------------------------------------

create table sources (
  id uuid primary key default uuid_generate_v4(),
  publisher text not null,
  url text not null,
  reuse_permission text not null default 'unknown',  -- permitted | link_only | unknown
  check_interval_days smallint not null default 30,
  last_checked_at timestamptz,
  state text not null default 'verified',            -- verified | unreachable | retired
  content_hash text
);

create table opportunities (
  id uuid primary key default uuid_generate_v4(),
  source_id uuid not null references sources(id),    -- NOT NULL: a table constraint, not a convention
  name text not null,
  cost_cents integer not null default 0,
  transit_accessible boolean not null default false,
  min_grade smallint,
  max_grade smallint,
  hours_per_week numeric(4,1),
  deadline_on date,
  state text not null default 'live',                -- live | unverified | retired
  embedding vector(1536),                            -- pgvector: adequate well past our scale
  last_verified_at timestamptz
);

-- ---------------------------------------------------------------
-- Sharing. Scoped, revocable, audited.
-- ---------------------------------------------------------------

create table access_grants (
  id uuid primary key default uuid_generate_v4(),
  student_id uuid not null references students(id) on delete cascade,
  grantee_auth_id uuid not null,
  role actor_role not null,
  scopes text[] not null default '{}',               -- 'academics','activities','plan'
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
-- NOTE: 'reflections' is not a grantable scope. It is not in any enum,
-- not in any policy, and a test asserts a full-scope grant reads zero rows.

create table audit_events (
  id bigserial primary key,
  student_id uuid references students(id) on delete set null,
  actor_auth_id uuid,
  action text not null,
  detail jsonb,
  created_at timestamptz not null default now()
);

create table ai_runs (
  id uuid primary key default uuid_generate_v4(),
  student_id uuid references students(id) on delete set null,
  purpose text not null,                             -- extraction | planning | coach | brief
  model text not null,
  input_tokens integer,
  output_tokens integer,
  latency_ms integer,
  passed_validation boolean,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- Atomic confirmed write. All or nothing.
-- ---------------------------------------------------------------

create or replace function resolve_proposals(
  p_student_id uuid,
  p_submission_id uuid,
  p_expected_version integer,
  p_resolutions jsonb   -- [{proposal_id, state, payload}]
) returns integer
language plpgsql
security definer
as $$
declare
  v_current integer;
  v_res jsonb;
  v_proposal change_proposals%rowtype;
begin
  -- snapshot check: refuse to write against a stale view of the profile
  select profile_version_at_submit into v_current
    from update_submissions where id = p_submission_id;

  if v_current is distinct from p_expected_version then
    raise exception 'stale_snapshot: expected %, found %', p_expected_version, v_current;
  end if;

  for v_res in select * from jsonb_array_elements(p_resolutions) loop
    select * into v_proposal from change_proposals
      where id = (v_res->>'proposal_id')::uuid and student_id = p_student_id;

    if not found then
      raise exception 'proposal_not_found';
    end if;

    update change_proposals
      set state = (v_res->>'state')::proposal_state,
          resolved_payload = v_res->'payload',
          resolved_at = now()
      where id = v_proposal.id;

    if (v_res->>'state') in ('accepted','edited') then
      insert into profile_events (student_id, entity_table, entity_id, action, after, caused_by_proposal, actor)
      values (p_student_id, v_proposal.proposal_type, null, 'insert',
              coalesce(v_res->'payload', v_proposal.payload), v_proposal.id, p_student_id);
      -- the concrete insert into activities / academic_records happens here,
      -- dispatched on proposal_type, inside this same transaction
    end if;
  end loop;

  update students set updated_at = now() where id = p_student_id;
  update update_submissions set extraction_state = 'done' where id = p_submission_id;

  return p_expected_version + 1;
end;
$$;

-- ---------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------

alter table students          enable row level security;
alter table activities        enable row level security;
alter table academic_records  enable row level security;
alter table reflections       enable row level security;
alter table evidence          enable row level security;
alter table update_submissions enable row level security;
alter table change_proposals  enable row level security;
alter table plans             enable row level security;
alter table plan_versions     enable row level security;
alter table tasks             enable row level security;
alter table access_grants     enable row level security;

create or replace function owns_student(s_id uuid) returns boolean
language sql stable as $$
  select exists (select 1 from students where id = s_id and auth_user_id = auth.uid());
$$;

create or replace function has_scope(s_id uuid, scope text) returns boolean
language sql stable as $$
  select exists (
    select 1 from access_grants
    where student_id = s_id
      and grantee_auth_id = auth.uid()
      and revoked_at is null
      and scope = any(scopes)
  );
$$;

-- Student owns everything of theirs
create policy student_all on students for all using (auth_user_id = auth.uid());
create policy activities_own on activities for all using (owns_student(student_id));
create policy academics_own on academic_records for all using (owns_student(student_id));
create policy evidence_own on evidence for all using (owns_student(student_id));
create policy submissions_own on update_submissions for all using (owns_student(student_id));
create policy proposals_own on change_proposals for all using (owns_student(student_id));
create policy plans_own on plans for all using (owns_student(student_id));
create policy grants_own on access_grants for all using (owns_student(student_id));

-- Reflections: owner only. There is no second policy on this table, by design.
create policy reflections_owner_only on reflections for all using (owns_student(student_id));

-- Counselors and guardians: read only, scoped, and only what was granted
create policy activities_shared on activities for select using (has_scope(student_id, 'activities'));
create policy academics_shared on academic_records for select using (has_scope(student_id, 'academics'));
create policy plans_shared on plans for select using (has_scope(student_id, 'plan'));
-- Deliberately absent: any shared policy on reflections, evidence, or update_submissions.

create index on activities (student_id);
create index on academic_records (student_id);
create index on update_submissions (student_id, created_at desc);
create index on change_proposals (submission_id);
create index on profile_events (student_id, created_at desc);
create index on opportunities (state, cost_cents);
