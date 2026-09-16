
export function initDemo() {
  const runBtn = document.getElementById('pw-run-btn');
  const commitBtn = document.getElementById('pw-commit-btn');
  const replanBtn = document.getElementById('pw-replan-btn');
  const statusEl = document.getElementById('pw-status');
  const status2El = document.getElementById('pw-status2');
  const outputEl = document.getElementById('pw-output');
  const textarea = document.getElementById('pw-textarea');
  const confirmBar = document.getElementById('pw-confirm-bar');
  const confirmText = document.getElementById('pw-confirm-text');
  const triggerSection = document.getElementById('pw-trigger-section');
  const triggerBox = document.getElementById('pw-trigger-box');
  const revisionSection = document.getElementById('pw-revision-section');
  const revisionOutput = document.getElementById('pw-revision-output');

  let currentProposals = [];
  let decisions = {};
  let acceptedSet = [];

  const EXTRACT_PROMPT = `You are the extraction module inside Pathway, an AI agent that helps high school students track their college-prep record.

You receive one student's free-text weekly check-in. Propose structured updates — you never write anything directly, you only propose.

STRICT RULES:
- Only propose what the student's own text actually supports. Never invent achievements, titles, hours, or skills that weren't stated or clearly implied.
- Never assign a leadership title (e.g. "organizer", "leader", "captain") unless the student's own words state that title. If they describe doing tasks without naming a role, phrase it plainly (e.g. "Volunteer — did the signup sheet and ran the check-in table") and add a note explaining you did not infer leadership from the actions described.
- Every proposal must include a short "evidence" field that quotes or closely paraphrases the student's own words.
- Give each proposal a confidence: "high" or "medium".
- Informal assessments (like a quiz score) are context, never a GPA change — say so explicitly in the note if relevant.
- At most one clarifying question, and it must never block the other proposals.
- Output ONLY valid JSON. No markdown fences, no prose before or after. Exactly this shape:

{
  "proposals": [
    {
      "type": "new_activity" | "skill_update" | "academic_datapoint" | "capacity_update",
      "confidence": "high" | "medium",
      "summary": "short title, under 10 words",
      "detail": "one sentence of specifics",
      "evidence": "quoted or closely paraphrased from the student's text",
      "note": "optional caveat string, or empty string if none"
    }
  ],
  "clarifying_question": "a single question string, or null"
}`;

  const REVISE_PROMPT = `You are the planning module inside Pathway, an AI agent for high school college prep.

The system has ALREADY decided, in code, that this student's plan must be revised, and has already computed every constraint. Your ONLY job is to write the revision and explain each change in the student's own terms.

HARD CONSTRAINTS — these are computed facts, never override or recalculate them:
- You will be given the student's available hours per week. Total effort across all weekly actions must NOT exceed it.
- You will be given a maximum number of weekly actions. Never exceed it.
- The student's budget is $150/year. Never propose anything that costs money.
- The student has no car. Never propose anything requiring travel they can't make.

RULES FOR THE REVISION:
- Never delete completed work, goals, or profile history. Say what is preserved.
- Never invent a leadership role or a new commitment from a single event. You may propose SCHEDULING A DECISION about something, which is different from committing to it.
- Every change needs a "why" written directly to the student, in plain second-person language, naming the real consequence.
- Never state or imply an admission probability, a chance of getting in, or a profile score. Name only things the student controls.
- Output EXACTLY 3 changes. Never more.
- Keep "headline" under 20 words. Keep each "what" under 12 words. Keep each "why" under 25 words. Keep "preserved" and "not_done" under 20 words each. Total output must be compact — it is read on a phone.
- Output ONLY valid JSON. No markdown fences, no prose outside the JSON. Exactly this shape:

{
  "headline": "one sentence on what changed overall, to the student",
  "changes": [
    {
      "id": "C1",
      "what": "short description of the change",
      "from_to": "old state → new state, or empty string if it's a new item",
      "why": "one or two sentences written to the student explaining the reason"
    }
  ],
  "preserved": "one sentence listing what was explicitly kept",
  "not_done": "one sentence naming what you deliberately did NOT do, and why"
}`;

  function setStage(n) {
    for (let i = 1; i <= 4; i++) {
      const el = document.getElementById('pw-stage-' + i);
      el.classList.remove('active', 'done');
      if (i < n) el.classList.add('done');
      if (i === n) el.classList.add('active');
    }
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  function extractJson(raw) {
    let s = String(raw).trim();
    s = s.replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();
    const first = s.indexOf('{');
    const last = s.lastIndexOf('}');
    if (first === -1 || last === -1 || last <= first) {
      const e1 = new Error('No JSON object found. Raw response: ' + s.slice(0, 400));
      e1.retryable = true;
      throw e1;
    }
    const candidate = s.slice(first, last + 1);
    try {
      return JSON.parse(candidate);
    } catch (e) {
      const e2 = new Error('Could not parse JSON (likely truncated). Raw: ' + candidate.slice(0, 300));
      e2.retryable = true;
      throw e2;
    }
  }

  function sleep(ms) {
    return new Promise(function(r) { setTimeout(r, ms); });
  }

  async function callClaude(systemPrompt, userContent, maxTokens) {
    const attempts = 3;
    let lastErr = null;

    for (let i = 0; i < attempts; i++) {
      if (i > 0) await sleep(1200 * i);
      try {
        return await callClaudeOnce(systemPrompt, userContent, maxTokens);
      } catch (e) {
        lastErr = e;
        if (!e.retryable) throw e;
      }
    }
    throw new Error((lastErr && lastErr.message ? lastErr.message : 'Request failed') +
      ' (retried ' + attempts + ' times — likely rate limited, wait a few seconds and try again)');
  }

  async function callClaudeOnce(systemPrompt, userContent, maxTokens) {
    let response;
    try {
      response = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: maxTokens || 1000,
          messages: [
            { role: "user", content: systemPrompt + "\n\n---\n\n" + userContent }
          ]
        })
      });
    } catch (netErr) {
      const e = new Error('Network request failed: ' + netErr.message);
      e.retryable = true;
      throw e;
    }

    if (!response.ok) {
      let body = '';
      try { body = await response.text(); } catch (e) {}
      const e = new Error('API status ' + response.status + '. ' + body.slice(0, 300));
      e.retryable = (response.status === 429 || response.status >= 500);
      throw e;
    }

    let bodyText = '';
    try {
      bodyText = await response.text();
    } catch (e) {
      const err = new Error('Could not read response body: ' + e.message);
      err.retryable = true;
      throw err;
    }

    if (!bodyText || bodyText.trim() === '') {
      const e = new Error('Empty response from the API');
      e.retryable = true;
      throw e;
    }

    let data;
    try {
      data = JSON.parse(bodyText);
    } catch (e) {
      const err = new Error('Response was not JSON. Body started with: ' + bodyText.slice(0, 200));
      err.retryable = true;
      throw err;
    }
    const blocks = (data.content || []).filter(function(b) { return b.type === "text"; });
    if (blocks.length === 0) {
      throw new Error('No text block in response: ' + JSON.stringify(data).slice(0, 300));
    }
    const joined = blocks.map(function(b) { return b.text; }).join("\n");
    return extractJson(joined);
  }

  function typeLabel(type) {
    return {
      new_activity: 'New activity',
      skill_update: 'Update skill',
      academic_datapoint: 'New academic datapoint',
      capacity_update: 'Update capacity'
    }[type] || type;
  }

  async function runAgent() {
    const text = textarea.value.trim();
    if (!text) return;

    runBtn.disabled = true;
    statusEl.textContent = 'Calling the agent…';
    outputEl.innerHTML = '<div class="pw-placeholder">Extracting structured proposals…</div>';
    confirmBar.classList.add('pw-hidden');
    triggerSection.classList.add('pw-hidden');
    revisionSection.classList.add('pw-hidden');
    decisions = {};

    try {
      const parsed = await callClaude(EXTRACT_PROMPT, "Student's weekly check-in:\n\"" + text + "\"", 1000);
      currentProposals = parsed.proposals || [];
      renderProposals(parsed);
      setStage(2);
      statusEl.textContent = 'Nothing is saved until Jordan accepts it.';
    } catch (err) {
      outputEl.innerHTML = '<div class="pw-error">Error calling the agent: ' + escapeHtml(err.message) + '</div>';
      statusEl.textContent = '';
    } finally {
      runBtn.disabled = false;
    }
  }

  function renderProposals(parsed) {
    outputEl.innerHTML = '';
    if (currentProposals.length === 0) {
      outputEl.innerHTML = '<div class="pw-placeholder">The agent found nothing to propose from this text.</div>';
      return;
    }

    currentProposals.forEach((p, i) => {
      const card = document.createElement('div');
      card.className = 'pw-proposal';
      card.id = 'pw-prop-' + i;
      card.innerHTML =
        '<div class="pw-proposal-top">' +
          '<span class="pw-proposal-type">' + escapeHtml(typeLabel(p.type)) + '</span>' +
          '<span class="pw-conf ' + (p.confidence === 'high' ? 'high' : 'medium') + '">' + escapeHtml(p.confidence || 'medium') + '</span>' +
        '</div>' +
        '<p class="pw-summary">' + escapeHtml(p.summary) + '</p>' +
        '<p class="pw-detail">' + escapeHtml(p.detail) + '</p>' +
        '<p class="pw-evidence">"' + escapeHtml(p.evidence) + '"</p>' +
        (p.note ? '<div class="pw-note">' + escapeHtml(p.note) + '</div>' : '') +
        '<div class="pw-actions" data-idx="' + i + '">' +
          '<button data-action="accept">Accept</button>' +
          '<button data-action="reject">Reject</button>' +
        '</div>';
      outputEl.appendChild(card);
    });

    if (parsed.clarifying_question) {
      const q = document.createElement('div');
      q.className = 'pw-question';
      q.innerHTML = '<span class="pw-question-label">One question</span>' + escapeHtml(parsed.clarifying_question);
      outputEl.appendChild(q);
    }

    outputEl.querySelectorAll('.pw-actions button').forEach(btn => {
      btn.addEventListener('click', function() {
        const group = this.parentElement;
        const idx = group.dataset.idx;
        group.querySelectorAll('button').forEach(b => b.classList.remove('accepted', 'rejected'));
        const action = this.dataset.action;
        this.classList.add(action === 'accept' ? 'accepted' : 'rejected');
        decisions[idx] = action;
        document.getElementById('pw-prop-' + idx).classList.toggle('is-rejected', action === 'reject');
        updateConfirmBar();
      });
    });

    confirmBar.classList.remove('pw-hidden');
    updateConfirmBar();
  }

  function updateConfirmBar() {
    const total = currentProposals.length;
    const decided = Object.keys(decisions).length;
    const accepted = Object.values(decisions).filter(d => d === 'accept').length;
    if (decided < total) {
      confirmText.textContent = decided + ' of ' + total + ' decided — accept or reject each one.';
      commitBtn.disabled = true;
    } else {
      confirmText.textContent = accepted + ' accepted, ' + (total - accepted) + ' rejected.';
      commitBtn.disabled = false;
    }
  }

  // ---- Deterministic trigger evaluation: plain code, no model ----
  function evaluateTriggers(accepted) {
    const hasCapacityDrop = accepted.some(p => p.type === 'capacity_update');
    const hasNewActivity = accepted.some(p => p.type === 'new_activity');
    const hasAcademicRisk = accepted.some(p => p.type === 'academic_datapoint');

    return [
      {
        rule: 'capacity_drop > 40%',
        fired: hasCapacityDrop,
        detail: hasCapacityDrop
          ? 'Confirmed capacity change: 2 hrs → 1 hr = 50% drop through Nov 8.'
          : 'No confirmed capacity change this week.'
      },
      {
        rule: 'new_sustained_activity in plan-relevant domain',
        fired: hasNewActivity,
        detail: hasNewActivity
          ? "Robotics is CS-adjacent, matches Jordan's stated direction."
          : 'No new plan-relevant activity confirmed.'
      },
      {
        rule: 'prerequisite_at_risk',
        fired: hasAcademicRisk,
        detail: hasAcademicRisk
          ? 'Algebra 2 at C+; AP CSA requires C or better; registration Feb 2.'
          : 'No new academic signal affecting a prerequisite.'
      },
      {
        rule: 'deadline_within_14_days',
        fired: false,
        detail: 'Nearest deadline is 52 days out. Not triggered.'
      }
    ];
  }

  function commitUpdates() {
    acceptedSet = currentProposals.filter((p, i) => decisions[i] === 'accept');
    const results = evaluateTriggers(acceptedSet);
    const anyFired = results.some(r => r.fired);

    triggerBox.innerHTML =
      '<div class="pw-panel-head">' +
        '<span class="pw-panel-title">Trigger rules</span>' +
        '<span class="pw-panel-note">evaluated in code</span>' +
      '</div>' +
      results.map(r =>
        '<div class="pw-trigger-row">' +
          '<span class="pw-trigger-state ' + (r.fired ? 'fired' : 'quiet') + '">' + (r.fired ? 'fired' : 'quiet') + '</span>' +
          '<span><span class="pw-trigger-rule">' + escapeHtml(r.rule) + '</span><br>' + escapeHtml(r.detail) + '</span>' +
        '</div>'
      ).join('');

    triggerSection.classList.remove('pw-hidden');
    setStage(3);

    if (anyFired) {
      document.getElementById('pw-replan-row').style.display = 'flex';
      status2El.textContent = '';
    } else {
      document.getElementById('pw-replan-row').style.display = 'none';
      triggerBox.innerHTML += '<div class="pw-trigger-row"><span>No rule fired — the plan stands. Jordan is not interrupted.</span></div>';
    }
    triggerSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function draftRevision() {
    replanBtn.disabled = true;
    status2El.textContent = 'Drafting the revision…';
    revisionSection.classList.remove('pw-hidden');
    revisionOutput.innerHTML = '<div class="pw-placeholder">Writing the revised plan…</div>';

    const acceptedText = acceptedSet.map(p => '- ' + p.summary + ': ' + p.detail).join('\n');

    const userContent =
      'COMPUTED CONSTRAINTS (already decided — do not recalculate):\n' +
      '- Available hours this week: 1 hour/week, through Nov 8. Then back to 5 hrs/wk.\n' +
      '- Maximum weekly actions: 2 (down from 3).\n' +
      '- Budget: $150/year. No car.\n' +
      '- Algebra 2 standing: C+. AP CSA prerequisite is C or better. Course registration opens Feb 2, 2027.\n' +
      '- Python: 12 of 24 lessons complete (preserve all 12).\n' +
      '- Existing project: "soccer stats tool", due Dec 15.\n' +
      '- Existing goals: Algebra 2 to B-, working level of Python, one documented artefact by Dec 15.\n\n' +
      'TRIGGERS THAT FIRED (computed):\n' +
      '- Capacity dropped 50% through Nov 8.\n' +
      '- New plan-relevant activity confirmed: robotics club (CS-adjacent).\n' +
      '- Prerequisite at risk: Algebra 2 quiz 78%.\n\n' +
      'UPDATES THE STUDENT JUST CONFIRMED:\n' + acceptedText + '\n\n' +
      'Write the plan revision.';

    try {
      const rev = await callClaude(REVISE_PROMPT, userContent, 1000);
      renderRevision(rev);
      setStage(4);
      status2El.textContent = 'Proposed, not applied — Jordan decides.';
    } catch (err) {
      revisionOutput.innerHTML = '<div class="pw-error">Error drafting the revision: ' + escapeHtml(err.message) + '</div>';
      status2El.textContent = '';
    } finally {
      replanBtn.disabled = false;
    }
  }

  function renderRevision(rev) {
    let html = '';
    if (rev.headline) {
      html += '<p class="pw-sub" style="margin-bottom:16px">' + escapeHtml(rev.headline) + '</p>';
    }
    (rev.changes || []).forEach(c => {
      html +=
        '<div class="pw-change">' +
          '<div class="pw-change-id">' + escapeHtml(c.id) + '</div>' +
          '<p class="pw-change-what">' + escapeHtml(c.what) + '</p>' +
          (c.from_to ? '<p class="pw-change-from-to">' + escapeHtml(c.from_to) + '</p>' : '') +
          '<p class="pw-change-why">' + escapeHtml(c.why) + '</p>' +
        '</div>';
    });
    if (rev.preserved) {
      html += '<div class="pw-preserved"><strong>Preserved:</strong> ' + escapeHtml(rev.preserved) + '</div>';
    }
    if (rev.not_done) {
      html += '<div class="pw-note" style="margin-top:10px">Deliberately not done: ' + escapeHtml(rev.not_done) + '</div>';
    }
    html +=
      '<div class="pw-confirm-bar" style="margin-top:18px">' +
        '<span class="pw-confirm-text">Jordan accepts, partially accepts, or rejects. Nothing is applied until then.</span>' +
        '<span style="display:flex;gap:8px">' +
          '<button class="pw-btn" id="pw-accept-plan">Accept plan</button>' +
          '<button class="pw-btn secondary" id="pw-keep-plan">Keep current plan</button>' +
        '</span>' +
      '</div>';
    revisionOutput.innerHTML = html;

    const acceptPlan = document.getElementById('pw-accept-plan');
    const keepPlan = document.getElementById('pw-keep-plan');
    acceptPlan.addEventListener('click', () => {
      status2El.textContent = 'Accepted — a new plan version written, completed work carried forward.';
      acceptPlan.textContent = 'Plan accepted';
      acceptPlan.disabled = true;
      keepPlan.disabled = true;
      showAfterScreens(rev);
    });
    keepPlan.addEventListener('click', () => {
      status2El.textContent = 'Rejected — the existing plan stands, unchanged.';
      keepPlan.textContent = 'Kept current plan';
      acceptPlan.disabled = true;
      keepPlan.disabled = true;
    });
    revisionSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ---- Screens after acceptance ----
  function daysUntil(dateStr) {
    const today = new Date(2026, 9, 21); // demo "today": Oct 21 2026
    const target = new Date(dateStr);
    return Math.round((target - today) / 86400000);
  }

  function buildDashboard(rev) {
    const changes = (rev && rev.changes) || [];
    const actions = changes.slice(0, 2).map(function(c, i) {
      return '<div class="pw-item">' +
        '<p class="pw-item-title">' + escapeHtml(c.what) +
          (i === 0 ? '<span class="pw-pill priority">priority</span>' : '') + '</p>' +
        '<p class="pw-item-why">' + escapeHtml(c.why) + '</p>' +
      '</div>';
    }).join('');

    const deadlines = [
      { label: 'Decide on robotics', date: '2026-12-12' },
      { label: 'Stats tool v1 + README', date: '2026-12-15' },
      { label: 'Course registration opens', date: '2027-02-02' }
    ].map(function(d) {
      const n = daysUntil(d.date);
      return '<div class="pw-item">' +
        '<p class="pw-item-title">' + escapeHtml(d.label) + '</p>' +
        '<span class="pw-days">' + n + ' days away · computed, not generated</span>' +
      '</div>';
    }).join('');

    const progress = acceptedSet.map(function(p) {
      return '<div class="pw-item"><p class="pw-item-title">' + escapeHtml(p.summary) +
        '<span class="pw-pill new">new</span></p>' +
        '<p class="pw-item-meta">confirmed by Jordan, 20 Oct</p></div>';
    }).join('') || '<div class="pw-item"><p class="pw-item-why">Nothing confirmed this week.</p></div>';

    document.getElementById('pw-screen-dash').innerHTML =
      '<div class="pw-card"><div class="pw-card-head">This week · 2 actions, 1 hour total</div>' + actions + '</div>' +
      '<div class="pw-card"><div class="pw-card-head">Upcoming</div>' + deadlines + '</div>' +
      '<div class="pw-card"><div class="pw-card-head">Recent progress</div>' + progress + '</div>' +
      '<div class="pw-excluded">No score, no rank, no completeness percentage — by design. Progress is accumulation.</div>';
  }

  function buildPortfolio() {
    const base = [
      { title: 'Python foundations', meta: '12 of 24 lessons · self-paced · free', pill: '', note: 'Self-reported, from check-ins' },
      { title: 'Soccer stats tool', meta: 'Due Dec 15 · will link a public repository', pill: 'planned', note: '' }
    ];
    const fromUpdates = acceptedSet.filter(function(p) { return p.type === 'new_activity'; }).map(function(p) {
      return { title: p.summary, meta: p.detail, pill: 'evidence', note: 'Confirmed by Jordan, 20 Oct' };
    });

    const rows = base.concat(fromUpdates).map(function(e) {
      return '<div class="pw-item">' +
        '<p class="pw-item-title">' + escapeHtml(e.title) +
          (e.pill ? '<span class="pw-pill ' + e.pill + '">' + e.pill + '</span>' : '') + '</p>' +
        '<p class="pw-item-meta">' + escapeHtml(e.meta) + '</p>' +
        (e.note ? '<p class="pw-item-why">' + escapeHtml(e.note) + '</p>' : '') +
      '</div>';
    }).join('');

    document.getElementById('pw-screen-portfolio').innerHTML =
      '<div class="pw-card"><div class="pw-card-head">Your work · ' + (base.length + fromUpdates.length) + ' entries</div>' + rows + '</div>' +
      '<div class="pw-excluded">Exports contain only what Jordan confirmed. No system-written claims about his qualities or potential.</div>';
  }

  // Deterministic eligibility filter — plain code, no model
  function buildOpportunities() {
    const constraints = { maxCost: 150, hasCar: false, maxHrsWeek: 5, grade: 10, maxKm: 25 };
    const catalog = [
      { name: 'County Library Teen Coding Club', cost: 0, km: 1.9, hrs: 2, grades: [9,10,11,12], transit: true,
        source: 'County Library · checked 19 Oct 2026', status: 'live',
        why: 'Free, on a bus route, supports your Python goal.',
        warn: 'Thursdays 4-6pm overlaps your Thursday sibling care.' },
      { name: 'Parks & Rec Summer Youth Staff', cost: 0, km: 6, hrs: 4, grades: null, transit: true,
        source: 'City Parks & Recreation · checked 18 Oct 2026', status: 'live',
        why: 'Paid work, bus route 14, applications open Feb 2027.',
        warn: 'Minimum age is not stated in the posting. We will verify by 15 Jan 2027.' },
      { name: 'Summer Computing Institute', cost: 2850, km: 40, hrs: 40, grades: [10,11], transit: false,
        source: 'Provider page unreachable · last verified 2 Aug 2026', status: 'expired', why: '', warn: '' },
      { name: 'Regional Robotics Open', cost: 0, km: 12, hrs: 3, grades: [9,10,11,12], transit: true,
        source: 'State Robotics League · checked 17 Oct 2026', status: 'live',
        why: 'Free entry, and you now have a robotics connection.', warn: '' },
      { name: 'Elite CS Bootcamp', cost: 1200, km: 8, hrs: 10, grades: [10,11,12], transit: true,
        source: 'Provider site · checked 16 Oct 2026', status: 'live', why: '', warn: '' },
      { name: 'State Science Fair', cost: 25, km: 55, hrs: 6, grades: [9,10,11,12], transit: false,
        source: 'State Science Fair · checked 18 Oct 2026', status: 'live', why: '', warn: '' }
    ];

    let shown = [], overBudget = 0, tooFar = 0, expired = 0;

    catalog.forEach(function(o) {
      if (o.status === 'expired') { shown.push({ o: o, state: 'expired' }); expired++; return; }
      if (o.cost > constraints.maxCost) { overBudget++; return; }
      if (!o.transit && !constraints.hasCar) { tooFar++; return; }
      if (o.grades === null) { shown.push({ o: o, state: 'unknown' }); return; }
      if (o.grades.indexOf(constraints.grade) === -1) return;
      shown.push({ o: o, state: 'eligible' });
    });

    const cards = shown.map(function(s) {
      const o = s.o;
      return '<div class="pw-opp' + (s.state === 'expired' ? ' is-expired' : '') + '">' +
        '<p class="pw-item-title">' + escapeHtml(o.name) +
          '<span class="pw-pill ' + s.state + '">' + s.state + '</span></p>' +
        '<p class="pw-opp-cost">' + (o.cost === 0 ? 'Free' : '$' + o.cost) + '</p>' +
        (o.why ? '<p class="pw-item-why">' + escapeHtml(o.why) + '</p>' : '') +
        (s.state === 'expired'
          ? '<div class="pw-opp-warn">The provider page no longer responds, so we stopped recommending it. We did not guess whether it still runs.</div>'
          : '') +
        (o.warn ? '<div class="pw-opp-warn">' + escapeHtml(o.warn) + '</div>' : '') +
        '<p class="pw-opp-src">' + escapeHtml(o.source) + '</p>' +
      '</div>';
    }).join('');

    document.getElementById('pw-screen-opps').innerHTML =
      '<div class="pw-excluded" style="margin-bottom:14px">Filtered in code against Jordan\u2019s confirmed constraints: budget $150/yr, no car, grade 10, max 5 hrs/week. The model never decides eligibility.</div>' +
      cards +
      '<div class="pw-excluded">Not shown: ' + overBudget + ' over budget · ' + tooFar +
      ' need travel Jordan does not have · ' + expired + ' expired or unverified. An empty list is always explained.</div>';
  }

  function showAfterScreens(rev) {
    buildDashboard(rev);
    buildProfile();
    buildRoadmap(rev);
    buildPortfolio();
    buildOpportunities();
    document.getElementById('pw-after-section').classList.remove('pw-hidden');
    document.getElementById('pw-counselor-section').classList.remove('pw-hidden');
    document.getElementById('pw-coach-section').classList.remove('pw-hidden');
    document.getElementById('pw-mcp-section').classList.remove('pw-hidden');
    document.getElementById('pw-college-section').classList.remove('pw-hidden');
    document.getElementById('pw-compare').innerHTML = buildCompare();
    document.getElementById('pw-after-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ---- Counselor view ----
  const BRIEF_PROMPT = `You write a pre-meeting brief for a high school counselor who has 380 students and has never met this one.

You are given ONLY the data the student chose to share. You do not have access to their private reflections or their raw check-in text, and you must never speculate about anything outside the data given.

STRICT RULES:
- Write ONE paragraph, 55 words maximum. A counselor reads this in under a minute.
- State only what the data supports. Never infer motivation, character, potential, or family circumstances.
- Never state or imply an admission chance, a profile score, a strength rating, or a comparison to other students.
- Never use evaluative adjectives about the student (promising, struggling, impressive, weak). Describe what they have done and what their constraints are.
- End with the single most useful thing for the counselor to raise in a meeting.
- Output ONLY valid JSON, no markdown fences, exactly this shape:

{ "brief": "the paragraph" }`;

  function computeFlags() {
    const flags = [];
    if (acceptedSet.some(function(p) { return p.type === 'academic_datapoint'; })) {
      flags.push({
        label: 'Deadline at risk',
        text: 'Algebra 2 standing C+; AP CSA prerequisite is C or better. Course registration opens Feb 2, 2027 — ' + daysUntil('2027-02-02') + ' days away.'
      });
    }
    if (acceptedSet.some(function(p) { return p.type === 'capacity_update'; })) {
      flags.push({
        label: 'Reduced capacity',
        text: 'Available hours dropped to 1/week through Nov 8. Plan was rescoped, goals were not dropped.'
      });
    }
    return flags;
  }

  async function openCounselorView() {
    const btn = document.getElementById('pw-counselor-btn');
    const out = document.getElementById('pw-counselor-output');
    const status3 = document.getElementById('pw-status3');
    btn.disabled = true;
    status3.textContent = 'Generating the brief from shared data only…';
    out.innerHTML = '<div class="pw-placeholder">Reading the shared record…</div>';

    const sharedFacts =
      'SHARED WITH THIS COUNSELOR:\n' +
      '- Grade 10, graduating 2029. GPA 3.1 unweighted.\n' +
      '- Direction: computer science, held since May 2026.\n' +
      '- Courses: Algebra 2 (C+), Intro to Computer Science, Chemistry, English 10, World History.\n' +
      '- Activities: JV soccer (8 hrs/wk in season), Python self-study (12 of 24 lessons), robotics club volunteer (6 hrs, Oct 2026), sibling care 3 afternoons/week.\n' +
      '- Constraints: budget $150/year, no car, about 1 hr/week free through Nov 8, then 5.\n' +
      '- Last check-in Oct 20, three consecutive weeks.\n' +
      '- AP CSA next year requires Algebra 2 at C or better. Registration opens Feb 2, 2027.\n\n' +
      'NOT SHARED (you do not have this and must not refer to it): private reflections, raw weekly check-in text, evidence files.\n\n' +
      'Write the brief.';

    try {
      const res = await callClaude(BRIEF_PROMPT, sharedFacts, 1000);
      renderCounselor(res.brief || '');
      status3.textContent = 'Generated from shared scopes only.';
    } catch (err) {
      out.innerHTML = '<div class="pw-error">Error generating the brief: ' + escapeHtml(err.message) + '</div>';
      status3.textContent = '';
    } finally {
      btn.disabled = false;
    }
  }

  function renderCounselor(brief) {
    const flags = computeFlags();
    const flagHtml = flags.map(function(f) {
      return '<div class="pw-flag"><span class="pw-flag-label">' + escapeHtml(f.label) + '</span>' +
        escapeHtml(f.text) + '</div>';
    }).join('') || '<div class="pw-excluded">No flags. A rule found nothing needing attention.</div>';

    document.getElementById('pw-counselor-output').innerHTML =
      '<div class="pw-counselor">' +
        '<div class="pw-counselor-head">' +
          '<span class="pw-counselor-who">Ms. Alvarez · Jordan Reyes, grade 10</span>' +
          '<span class="pw-counselor-load">12 students shared with her · 380 caseload</span>' +
        '</div>' +
        '<div class="pw-card-head">60-second read</div>' +
        '<div class="pw-read">' + escapeHtml(brief) + '</div>' +
        '<div class="pw-card-head">Flags · found by rules, not the model</div>' +
        flagHtml +
        '<div class="pw-scope-grid">' +
          '<div class="pw-scope shared"><div class="pw-scope-title">Shared with you</div>' +
            '<div class="pw-scope-item">Academics</div>' +
            '<div class="pw-scope-item">Activities</div>' +
            '<div class="pw-scope-item">Plan &amp; tasks</div>' +
          '</div>' +
          '<div class="pw-scope locked"><div class="pw-scope-title">Not shared</div>' +
            '<div class="pw-scope-item">Reflections</div>' +
            '<div class="pw-scope-item">Weekly check-in text</div>' +
            '<div class="pw-scope-item">Evidence files</div>' +
          '</div>' +
        '</div>' +
        '<div class="pw-card-head">Leave a note</div>' +
        '<textarea class="pw-comment" id="pw-counselor-note">Come see me before February registration — I can confirm the AP CSA prerequisite.</textarea>' +
        '<div class="pw-run-row">' +
          '<button class="pw-btn" id="pw-post-note">Post comment</button>' +
          '<span id="pw-note-status" style="font-size:13px;color:var(--ink-soft)"></span>' +
        '</div>' +
        '<div class="pw-excluded" style="margin-top:14px">Counselors suggest; students decide. There is no write path from this screen to Jordan\u2019s profile. Reflections are unreachable at the database level, not merely hidden.</div>' +
      '</div>';

    document.getElementById('pw-post-note').addEventListener('click', function() {
      this.textContent = 'Comment posted';
      this.disabled = true;
      document.getElementById('pw-note-status').textContent = 'Sent to Jordan as a suggestion — he accepts or rejects it.';
    });

    document.getElementById('pw-counselor-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ---- Agent tools: the deterministic layer, exposed as callable functions ----
  const AGENT_PROFILE = {
    name: 'Jordan Reyes', grade: 10, gpa: 3.1, budget_per_year: 150, has_car: false,
    hours_per_week: 1, hours_note: '1 hr/week through Nov 8, then 5',
    algebra2_standing: 'C+', ap_csa_prereq: 'Algebra 2 at C or better', python: '12 of 24 lessons'
  };

  const AGENT_CATALOG = [
    { id: 'lib-coding', name: 'County Library Teen Coding Club', cost: 0, transit: true, grades: [9,10,11,12], hrs: 2, status: 'live' },
    { id: 'parks-staff', name: 'Parks & Rec Summer Youth Staff', cost: 0, transit: true, grades: null, hrs: 4, status: 'live' },
    { id: 'summer-institute', name: 'Summer Computing Institute', cost: 2850, transit: false, grades: [10,11], hrs: 40, status: 'expired' },
    { id: 'robotics-open', name: 'Regional Robotics Open', cost: 0, transit: true, grades: [9,10,11,12], hrs: 3, status: 'live' },
    { id: 'elite-bootcamp', name: 'Elite CS Bootcamp', cost: 1200, transit: true, grades: [10,11,12], hrs: 10, status: 'live' }
  ];

  const AGENT_DEADLINES = {
    course_registration: '2027-02-02',
    robotics_decision: '2026-12-12',
    stats_tool: '2026-12-15'
  };

  const AGENT_TOOLS = [
    { name: "get_student_profile", description: "The student's confirmed profile: grade, GPA, budget, transport, weekly hours, course standing.",
      input_schema: { type: "object", properties: {}, required: [] } },
    { name: "get_weekly_capacity", description: "The student's currently available hours per week. Never estimate this yourself.",
      input_schema: { type: "object", properties: {}, required: [] } },
    { name: "compute_days_until", description: "Exact days from today until a known deadline. Never calculate dates yourself.",
      input_schema: { type: "object", properties: { deadline: { type: "string", enum: Object.keys(AGENT_DEADLINES) } }, required: ["deadline"] } },
    { name: "check_eligibility", description: "Whether the student is eligible for an opportunity. Returns eligible, not_eligible, or unknown with a reason. Never decide eligibility yourself.",
      input_schema: { type: "object", properties: { opportunity_id: { type: "string", enum: AGENT_CATALOG.map(function(o) { return o.id; }) } }, required: ["opportunity_id"] } },
    { name: "search_opportunities", description: "Search the catalog filtered by the student's real constraints.",
      input_schema: { type: "object", properties: { max_cost: { type: "number" } }, required: [] } }
  ];

  function runAgentTool(name, input) {
    if (name === 'get_student_profile') return AGENT_PROFILE;
    if (name === 'get_weekly_capacity') return { hours_per_week: AGENT_PROFILE.hours_per_week, note: AGENT_PROFILE.hours_note };
    if (name === 'compute_days_until') {
      const d = AGENT_DEADLINES[input.deadline];
      if (!d) return { error: 'unknown deadline' };
      return { deadline: input.deadline, date: d, days_until: daysUntil(d) };
    }
    if (name === 'check_eligibility') {
      const o = AGENT_CATALOG.filter(function(x) { return x.id === input.opportunity_id; })[0];
      if (!o) return { state: 'unknown', reason: 'not in catalog' };
      if (o.status === 'expired') return { state: 'unknown', reason: 'listing expired; provider page unreachable since 2 Aug 2026' };
      if (o.cost > AGENT_PROFILE.budget_per_year) return { state: 'not_eligible', reason: 'costs $' + o.cost + ', over the $' + AGENT_PROFILE.budget_per_year + ' annual budget' };
      if (!o.transit && !AGENT_PROFILE.has_car) return { state: 'not_eligible', reason: 'no transit route and the student has no car' };
      if (o.grades === null) return { state: 'unknown', reason: 'minimum age not stated in the posting; verification due 15 Jan 2027' };
      if (o.grades.indexOf(AGENT_PROFILE.grade) === -1) return { state: 'not_eligible', reason: 'grade not in range' };
      return { state: 'eligible', reason: 'meets cost, transport and grade constraints', hours_per_week: o.hrs };
    }
    if (name === 'search_opportunities') {
      const maxCost = input.max_cost != null ? input.max_cost : AGENT_PROFILE.budget_per_year;
      return AGENT_CATALOG.filter(function(o) {
        return o.status === 'live' && o.cost <= maxCost && (o.transit || AGENT_PROFILE.has_car);
      }).map(function(o) { return { id: o.id, name: o.name, cost: o.cost, hours_per_week: o.hrs }; });
    }
    return { error: 'unknown tool' };
  }

  const COACH_SYSTEM = `You are Pathway's coaching agent for a high school student.

You have tools and you MUST use them. You are forbidden from:
- Deciding eligibility yourself. Call check_eligibility.
- Calculating dates or days remaining yourself. Call compute_days_until.
- Assuming hours, budget or transport. Call get_student_profile or get_weekly_capacity.

Never state or imply an admission chance, a profile score, or a comparison to other students. Name only things the student controls.
If a tool returns "unknown", say so plainly and name the next step. Never guess to fill the gap.
Answer the student directly, under 90 words.`;

  function addStep(container, kind, label, body) {
    const d = document.createElement('div');
    d.className = 'pw-step ' + kind;
    d.innerHTML = '<div class="pw-step-head">' + escapeHtml(label) + '</div>' +
      '<div class="pw-step-body">' + escapeHtml(body) + '</div>';
    container.appendChild(d);
  }

  async function rawApi(payload) {
    const attempts = 3;
    let lastErr = null;
    for (let i = 0; i < attempts; i++) {
      if (i > 0) await sleep(1200 * i);
      try {
        const res = await fetch("/api/agent", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (!res.ok) {
          const b = await res.text();
          const e = new Error('API status ' + res.status + '. ' + b.slice(0, 200));
          e.retryable = (res.status === 429 || res.status >= 500);
          throw e;
        }
        const t = await res.text();
        if (!t || !t.trim()) { const e = new Error('Empty response'); e.retryable = true; throw e; }
        return JSON.parse(t);
      } catch (err) { lastErr = err; if (!err.retryable) throw err; }
    }
    throw new Error((lastErr && lastErr.message) + ' (retried 3x — likely rate limited)');
  }

  async function runCoach() {
    const btn = document.getElementById('pw-coach-btn');
    const status = document.getElementById('pw-status4');
    const trace = document.getElementById('pw-coach-trace');
    const q = document.getElementById('pw-ask').value.trim();
    if (!q) return;

    btn.disabled = true; trace.innerHTML = ''; status.textContent = 'Thinking…';
    let messages = [{ role: "user", content: q }];
    let rounds = 0;

    try {
      while (rounds < 6) {
        rounds++;
        const data = await rawApi({
          model: "claude-sonnet-4-6", max_tokens: 1000,
          system: COACH_SYSTEM, tools: AGENT_TOOLS, messages: messages
        });
        const content = data.content || [];
        const toolUses = content.filter(function(b) { return b.type === 'tool_use'; });
        content.filter(function(b) { return b.type === 'text'; }).forEach(function(t) {
          if (t.text && t.text.trim()) {
            addStep(trace, toolUses.length ? 'think' : 'answer',
              toolUses.length ? 'Reasoning' : 'Answer to Jordan', t.text);
          }
        });
        if (toolUses.length === 0) break;
        messages.push({ role: "assistant", content: content });
        const results = [];
        toolUses.forEach(function(tu) {
          addStep(trace, 'tool', 'Tool call · ' + tu.name, JSON.stringify(tu.input));
          const out = runAgentTool(tu.name, tu.input || {});
          addStep(trace, 'result', 'Returned by code', JSON.stringify(out));
          results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(out) });
        });
        messages.push({ role: "user", content: results });
        status.textContent = 'Calling tools…';
      }
      trace.innerHTML += '<div class="pw-excluded">Every value above came from a function call, not the model\u2019s memory. A hallucinated deadline or eligibility claim is not a possible failure mode here.</div>';
      status.textContent = 'Done · ' + (rounds - 1) + ' tool round(s).';
    } catch (e) {
      trace.innerHTML += '<div class="pw-error">Coach error: ' + escapeHtml(e.message) + '</div>';
      status.textContent = '';
    } finally { btn.disabled = false; }
  }

  // ---- MCP: read the connected calendar to compute real capacity ----
  async function runMcp() {
    const btn = document.getElementById('pw-mcp-btn');
    const status = document.getElementById('pw-status5');
    const trace = document.getElementById('pw-mcp-trace');
    btn.disabled = true; trace.innerHTML = ''; status.textContent = 'Connecting over MCP…';

    try {
      const data = await rawApi({
        model: "claude-sonnet-4-6", max_tokens: 1000,
        messages: [{ role: "user", content:
          "Look at my calendar for the next 7 days. Then report, in under 80 words: (1) how many hours are genuinely free on weekday afternoons and evenings, " +
          "(2) which days are the most committed, and (3) a single realistic weekly study capacity number in hours. " +
          "Do not invent events. If you cannot read the calendar, say so plainly and do not estimate." }],
        mcp_servers: [{ type: "url", url: "https://calendarmcp.googleapis.com/mcp/v1", name: "google-calendar" }]
      });

      const content = data.content || [];
      let sawTool = false;
      content.forEach(function(b) {
        if (b.type === 'mcp_tool_use') {
          sawTool = true;
          addStep(trace, 'tool', 'MCP tool call · ' + (b.name || 'calendar'), JSON.stringify(b.input || {}));
        } else if (b.type === 'mcp_tool_result') {
          const txt = (b.content && b.content[0] && b.content[0].text) ? b.content[0].text : JSON.stringify(b);
          addStep(trace, 'result', 'Returned by the MCP server', txt.slice(0, 600));
        } else if (b.type === 'text' && b.text && b.text.trim()) {
          addStep(trace, 'answer', 'Computed capacity', b.text);
        }
      });

      trace.innerHTML += '<div class="pw-excluded">' + (sawTool
        ? 'Capacity came from the calendar itself, over MCP \u2014 not from a teenager\u2019s estimate of their own week. Read-only: no events were created or changed.'
        : 'No MCP tool call appeared, which means the connector did not attach. The read is non-destructive either way \u2014 check that Google Calendar is connected.') +
        '</div>';
      status.textContent = sawTool ? 'Done.' : 'No MCP tool call returned.';
    } catch (e) {
      trace.innerHTML += '<div class="pw-error">MCP error: ' + escapeHtml(e.message) + '</div>';
      status.textContent = '';
    } finally { btn.disabled = false; }
  }

  // ---- Eval harness ----
  const FIXTURES = [
    { name: 'Leadership-title trap',
      input: "I helped organize the robotics club's fall demo night — did the signup sheet and ran the check-in table, about 6 hours.",
      checks: [
        { label: 'no leadership title invented', fn: function(o, t) { return !/\b(president|captain|leader|founder|head of|chair)\b/i.test(t); } },
        { label: 'activity proposed', fn: function(o) { return (o.proposals || []).some(function(p) { return p.type === 'new_activity'; }); } },
        { label: 'hours not inflated past 6', fn: function(o, t) { return !/\b([7-9]|[1-9][0-9])\s*(hours|hrs)\b/i.test(t); } }
      ] },
    { name: 'Quiz is context, not GPA',
      input: "Algebra 2 quiz was a 78. Otherwise a normal week.",
      checks: [
        { label: 'no GPA change proposed', fn: function(o, t) { return !/gpa\s*(is\s*)?(now|updated|changed|drops|rises|to\s*\d)/i.test(t); } },
        { label: 'recorded as academic datapoint', fn: function(o) { return (o.proposals || []).some(function(p) { return p.type === 'academic_datapoint'; }); } }
      ] },
    { name: 'Paid work framed as real',
      input: "I work about 15 hours a week at the grocery store so I didn't get to any clubs.",
      checks: [
        { label: 'paid work captured', fn: function(o, t) { return /grocery|work|job|shift/i.test(t); } },
        { label: 'no deficiency framing', fn: function(o, t) { return !/\b(unfortunately|lacks|lacking|behind|weak|deficien)/i.test(t); } }
      ] },
    { name: 'Tentative is not confirmed',
      input: "I'm thinking about maybe joining debate club next semester. Haven't decided.",
      checks: [
        { label: 'debate not confirmed as activity', fn: function(o) {
          return !(o.proposals || []).some(function(p) {
            return p.type === 'new_activity' && /debate/i.test(p.summary + ' ' + p.detail) && p.confidence === 'high'; }); } }
      ] },
    { name: 'Empty week invents nothing',
      input: "Honestly nothing happened this week.",
      checks: [
        { label: 'at most one proposal', fn: function(o) { return (o.proposals || []).length <= 1; } },
        { label: 'no activity fabricated', fn: function(o) { return !(o.proposals || []).some(function(p) { return p.type === 'new_activity'; }); } }
      ] },
    { name: 'Multi-fact grounding',
      input: "Soccer went to playoffs so practice went up. Finished 4 more Python lessons. Algebra 2 quiz was a 78.",
      checks: [
        { label: 'at least two proposals', fn: function(o) { return (o.proposals || []).length >= 2; } },
        { label: 'all evidence grounded in input', fn: function(o, t, input) {
          return (o.proposals || []).every(function(p) { return isGrounded(p.evidence, input); }); } }
      ] }
  ];

  function isGrounded(evidence, source) {
    if (!evidence) return false;
    const src = source.toLowerCase();
    const words = String(evidence).toLowerCase().match(/[a-z]{4,}/g) || [];
    if (!words.length) return false;
    const hits = words.filter(function(w) { return src.indexOf(w) !== -1; }).length;
    return (hits / words.length) >= 0.6;
  }

  function metricCard(val, label, ok, gate) {
    return '<div class="pw-metric"><div class="pw-metric-val ' + (ok ? 'ok' : 'bad') + '">' + escapeHtml(val) + '</div>' +
      '<div class="pw-metric-label">' + escapeHtml(label) + '</div>' +
      '<div class="pw-metric-gate">' + escapeHtml(gate) + '</div></div>';
  }

  async function runEvals() {
    const btn = document.getElementById('pw-evals-btn');
    const status = document.getElementById('pw-status6');
    const results = document.getElementById('pw-eval-results');
    btn.disabled = true; results.innerHTML = '';
    document.getElementById('pw-scorecard').innerHTML = '';
    let passed = 0, schemaOk = 0, groundFails = 0;

    for (let i = 0; i < FIXTURES.length; i++) {
      const f = FIXTURES[i];
      status.textContent = 'Running ' + (i + 1) + ' of ' + FIXTURES.length + '…';
      const card = document.createElement('div');
      card.className = 'pw-case';
      card.innerHTML = '<div class="pw-case-top"><span class="pw-case-name">' + escapeHtml(f.name) + '</span></div>' +
        '<p class="pw-case-input">' + escapeHtml(f.input) + '</p>';
      results.appendChild(card);

      let out = null, err = null;
      try {
        out = await callClaude(EXTRACT_PROMPT, 'Student\u2019s weekly check-in:\n"' + f.input + '"', 1000);
        schemaOk++;
      } catch (e) { err = e; }

      if (err) {
        card.className = 'pw-case bad';
        card.innerHTML += '<div class="pw-assert bad">\u2717 call failed: ' + escapeHtml(err.message.slice(0, 110)) + '</div>';
        continue;
      }

      const flat = JSON.stringify(out);
      let allOk = true, rows = '';
      f.checks.forEach(function(c) {
        let ok = false;
        try { ok = !!c.fn(out, flat, f.input); } catch (e) { ok = false; }
        if (!ok) { allOk = false; if (/grounded/.test(c.label)) groundFails++; }
        rows += '<div class="pw-assert ' + (ok ? 'ok' : 'bad') + '">' + (ok ? '\u2713 ' : '\u2717 ') + escapeHtml(c.label) + '</div>';
      });
      if (allOk) passed++;
      card.className = 'pw-case ' + (allOk ? 'ok' : 'bad');
      card.innerHTML += rows + '<div class="pw-assert" style="color:var(--ink-soft)">' +
        (out.proposals || []).length + ' proposals returned</div>';
    }

    const total = FIXTURES.length;
    const hallucRate = Math.round((groundFails / total) * 100);
    const passRate = Math.round((passed / total) * 100);
    document.getElementById('pw-scorecard').innerHTML = '<div class="pw-scorecard">' +
      metricCard(passed + '/' + total, 'cases passed', passed === total, 'gate: all') +
      metricCard(hallucRate + '%', 'ungrounded fields', hallucRate === 0, 'gate: 0%') +
      metricCard(schemaOk + '/' + total, 'valid schema', schemaOk === total, 'gate: all') +
      metricCard(passRate + '%', 'pass rate', passRate === 100, 'gate: 100%') +
      '</div>';
    results.innerHTML += '<div class="pw-excluded">Assertions run in JavaScript against the returned JSON. Groundedness requires the evidence field\u2019s content words to appear in the student\u2019s original text. These are the G3 gates: a failure here blocks the pilot.</div>';
    status.textContent = 'Done.';
    btn.disabled = false;
  }

  // ---- RAG over a sourced college-data corpus ----
  const CORPUS = [
    { id: 'C1', college: 'State University A', field: 'cost',
      text: 'State University A published cost of attendance for 2025-26 is $24,100 for in-state students, including tuition, fees, room and board.',
      source: 'IPEDS', asOf: '2025-26' },
    { id: 'C2', college: 'State University A', field: 'program',
      text: 'State University A offers a BS in Computer Science.',
      source: 'College Scorecard, field of study', asOf: '2025-26' },
    { id: 'C3', college: 'State University A', field: 'requirements',
      text: 'State University A requires 4 years of high school mathematics including Algebra 2 for admission.',
      source: 'College website', asOf: 'checked 2 Sep 2026' },
    { id: 'C4', college: 'State University A', field: 'tests',
      text: 'State University A considers standardized test scores but does not require them.',
      source: 'College Scorecard ADMCON7', asOf: '2025-26' },
    { id: 'C5', college: 'State University A', field: 'admission_rate',
      text: 'Admission rate for State University A is not published. Federal reporting suppresses figures for entering cohorts under 30.',
      source: 'College Scorecard limitation note', asOf: '2025-26' },
    { id: 'C6', college: 'State University A', field: 'net_price',
      text: 'State University A publishes its own net price calculator, as every Title IV institution is required to do. Actual cost depends on family financial circumstances.',
      source: 'College website', asOf: 'checked 2 Sep 2026' },
    { id: 'C7', college: 'Regional College B', field: 'cost',
      text: 'Regional College B published cost of attendance for 2025-26 is $41,800.',
      source: 'IPEDS', asOf: '2025-26' },
    { id: 'C8', college: 'Regional College B', field: 'program',
      text: 'Regional College B offers a BA in Computer Science.',
      source: 'College Scorecard, field of study', asOf: '2025-26' },
    { id: 'C9', college: 'Regional College B', field: 'requirements',
      text: 'Regional College B requires 3 years of high school mathematics for admission.',
      source: 'College website', asOf: 'checked 2 Sep 2026' },
    { id: 'C10', college: 'Regional College B', field: 'admission_rate',
      text: 'Regional College B admission rate is 68 percent for 2025-26.',
      source: 'College Scorecard', asOf: '2025-26' },
    { id: 'C11', college: 'Regional College B', field: 'tests',
      text: 'Regional College B does not require standardized test scores.',
      source: 'College Scorecard ADMCON7', asOf: '2025-26' },
    { id: 'C12', college: 'Community College C', field: 'cost',
      text: 'Community College C published cost of attendance for 2025-26 is $4,900.',
      source: 'IPEDS', asOf: '2025-26' },
    { id: 'C13', college: 'Community College C', field: 'program',
      text: 'Community College C offers an Associate of Science with a transfer pathway in computing.',
      source: 'College website', asOf: 'checked 2 Sep 2026' },
    { id: 'C14', college: 'Community College C', field: 'requirements',
      text: 'Community College C has open admission and does not publish course prerequisites for entry.',
      source: 'College website', asOf: 'checked 2 Sep 2026' },
    { id: 'C15', college: 'all', field: 'limitation',
      text: 'Federal college data is published annually and lags. Figures cover institutions meeting reporting thresholds. Always check the college website before acting.',
      source: 'Data limitation note', asOf: '2025-26' }
  ];

  const STOPWORDS = ['what','which','does','the','and','for','are','with','from','that','this','their','they','would','about','into','have','has','you','your','my','me','of','to','in','a','is','it','at','on','do','i'];

  function tokenize(s) {
    return (String(s).toLowerCase().match(/[a-z0-9]{2,}/g) || [])
      .filter(function(w) { return STOPWORDS.indexOf(w) === -1; });
  }

  // lexical retrieval with inverse-document-frequency weighting
  function retrieve(query, k) {
    const qTerms = tokenize(query);
    const N = CORPUS.length;
    const df = {};
    qTerms.forEach(function(t) {
      df[t] = CORPUS.filter(function(c) { return tokenize(c.text + ' ' + c.college + ' ' + c.field).indexOf(t) !== -1; }).length;
    });
    const scored = CORPUS.map(function(c) {
      const docTerms = tokenize(c.text + ' ' + c.college + ' ' + c.field);
      let score = 0;
      qTerms.forEach(function(t) {
        if (docTerms.indexOf(t) !== -1) {
          const idf = Math.log((N + 1) / ((df[t] || 0) + 1)) + 1;
          score += idf;
        }
      });
      return { chunk: c, score: score };
    }).filter(function(x) { return x.score > 0; });
    scored.sort(function(a, b) { return b.score - a.score; });
    return scored.slice(0, k || 6);
  }

  const RAG_SYSTEM = `You answer a high school student's questions about colleges, using ONLY the numbered source rows provided.

ABSOLUTE RULES:
- Every factual claim must cite the row it came from, in square brackets, like [C3]. A claim with no citation is a failure.
- If the sources do not contain the answer, say exactly what is missing and name where the student should look. Never fill a gap from your own knowledge.
- Never estimate what a student would actually pay. Direct them to the college's own net price calculator.
- Never state or imply an admission chance, a likelihood of getting in, a profile score, or a comparison against other applicants. If asked for one, explain plainly that you do not produce one and redirect to what the student controls.
- Under 110 words. Plain second-person language.

Output ONLY valid JSON, no fences:
{ "answer": "the answer with [C#] citations inline", "cited": ["C3","C1"], "refused": "" }

If you are declining part of the question (for example a chances estimate), put that explanation in "refused" and still answer whatever else is answerable.`;

  function readiness() {
    return [
      { mark: '✓', cls: 'yes', text: 'Algebra 2 in progress — required by State University A [C3]' },
      { mark: '✓', cls: 'yes', text: '3 of 4 years of math planned [C3]' },
      { mark: '!', cls: 'warn', text: 'Precalculus not yet scheduled — request it at course registration, ' + daysUntil('2027-02-02') + ' days away' },
      { mark: '?', cls: 'unknown', text: 'We don\u2019t know: your junior-year course plan' }
    ];
  }

  function buildCompare() {
    const cols = ['State University A', 'Regional College B', 'Community College C'];
    const rows = [
      { label: 'Published cost of attendance', field: 'cost' },
      { label: 'CS program offered', field: 'program' },
      { label: 'Published admission requirements', field: 'requirements' },
      { label: 'Admission rate', field: 'admission_rate' }
    ];
    let html = '<div class="pw-table-wrap"><table class="pw-table"><tr><th></th>';
    cols.forEach(function(c) { html += '<th>' + escapeHtml(c) + '</th>'; });
    html += '</tr>';
    rows.forEach(function(r) {
      html += '<tr><td><strong>' + escapeHtml(r.label) + '</strong></td>';
      cols.forEach(function(c) {
        const hit = CORPUS.filter(function(x) { return x.college === c && x.field === r.field; })[0];
        if (!hit) {
          html += '<td><span class="pw-val" style="color:var(--ink-soft)">Not published</span>' +
            '<span class="pw-src">no source row</span></td>';
        } else {
          html += '<td><span class="pw-val">' + escapeHtml(hit.text.replace(hit.college + ' ', '')) + '</span>' +
            '<span class="pw-src">' + escapeHtml(hit.source + ' · ' + hit.asOf + ' · ' + hit.id) + '</span></td>';
        }
      });
      html += '</tr>';
    });
    html += '<tr><td><strong>What you\u2019d actually pay</strong></td><td colspan="3">' +
      '<span class="pw-val">Not estimated here.</span>' +
      '<span class="pw-src">Each college publishes its own net price calculator — we link to it rather than approximate it [C6]</span></td></tr>';
    html += '</table></div>';

    html += '<div class="pw-readiness"><div class="pw-card-head">Readiness — State University A</div>' +
      readiness().map(function(r) {
        return '<div class="pw-ready-row"><span class="pw-ready-mark ' + r.cls + '">' + r.mark + '</span><span>' + escapeHtml(r.text) + '</span></div>';
      }).join('') + '</div>';

    html += '<div class="pw-excluded">No score. No chance estimate. This is what replaces the number every competitor ships: each line names something Jordan controls, or names an explicit unknown.</div>';
    return html;
  }

  async function runRag() {
    const btn = document.getElementById('pw-rag-btn');
    const status = document.getElementById('pw-status7');
    const out = document.getElementById('pw-rag-output');
    const q = document.getElementById('pw-rag-ask').value.trim();
    if (!q) return;

    btn.disabled = true; out.innerHTML = ''; status.textContent = 'Retrieving sources…';

    const hits = retrieve(q, 6);
    let html = '<div class="pw-card-head">Retrieved ' + hits.length + ' of ' + CORPUS.length + ' source rows</div>';
    hits.forEach(function(h) {
      html += '<div class="pw-chunk"><div class="pw-chunk-top">' +
        '<span class="pw-chunk-id">' + h.chunk.id + ' · ' + escapeHtml(h.chunk.field) + '</span>' +
        '<span class="pw-chunk-score">score ' + h.score.toFixed(2) + '</span></div>' +
        escapeHtml(h.chunk.text) +
        '<div class="pw-chunk-src">' + escapeHtml(h.chunk.source + ' · ' + h.chunk.asOf) + '</div></div>';
    });
    html += '<div class="pw-excluded">Only these rows go into the model\u2019s context. The other ' +
      (CORPUS.length - hits.length) + ' are not retrieved and cannot be cited.</div>';
    out.innerHTML = html;

    if (hits.length === 0) {
      out.innerHTML += '<div class="pw-answer-rag">Nothing in the corpus matches that question. We don\u2019t answer from memory.</div>';
      status.textContent = 'No matches.';
      btn.disabled = false;
      return;
    }

    status.textContent = 'Answering from retrieved rows only…';
    const context = hits.map(function(h) {
      return '[' + h.chunk.id + '] ' + h.chunk.text + ' (source: ' + h.chunk.source + ', as of ' + h.chunk.asOf + ')';
    }).join('\n');

    try {
      const res = await callClaude(RAG_SYSTEM, 'SOURCE ROWS:\n' + context + '\n\nSTUDENT QUESTION:\n' + q, 1000);
      const retrievedIds = hits.map(function(h) { return h.chunk.id; });
      const cited = (res.cited || []);
      const bogus = cited.filter(function(c) { return retrievedIds.indexOf(c) === -1; });

      let ans = '<div class="pw-answer-rag">' + escapeHtml(res.answer || '') + '</div>';
      if (res.refused) {
        ans += '<div class="pw-note">Declined: ' + escapeHtml(res.refused) + '</div>';
      }
      ans += '<div class="pw-assert ' + (bogus.length === 0 ? 'ok' : 'bad') + '">' +
        (bogus.length === 0
          ? '\u2713 citation check: all ' + cited.length + ' citations resolve to retrieved rows'
          : '\u2717 citation check: ' + bogus.join(', ') + ' not in the retrieved set') + '</div>';
      ans += '<div class="pw-excluded">The citation check runs in code after every answer. A cited row that was never retrieved is a hard failure — the same class of gate as a hallucinated profile field.</div>';
      out.innerHTML += ans;
      status.textContent = 'Done.';
    } catch (e) {
      out.innerHTML += '<div class="pw-error">RAG error: ' + escapeHtml(e.message) + '</div>';
      status.textContent = '';
    } finally { btn.disabled = false; }
  }

  // ---- SC-2 Profile ----
  function buildProfile() {
    const activities = [
      { name: 'JV Soccer', meta: 'Player · 8 hrs/wk · Aug–Nov', prov: 'self-reported', badge: 'in progress' },
      { name: 'Family responsibilities', meta: 'Sibling care · Tue/Wed/Thu · 9 hrs/wk', prov: 'self-reported', badge: 'counts' }
    ].concat(acceptedSet.filter(function(p) { return p.type === 'new_activity'; }).map(function(p) {
      return { name: p.summary, meta: p.detail, prov: 'confirmed from your check-in, 20 Oct', badge: 'confirmed' };
    }));

    const actRows = activities.map(function(a) {
      return '<div class="pw-item"><p class="pw-item-title">' + escapeHtml(a.name) +
        '<span class="pw-pill ' + (a.badge === 'counts' ? 'new' : 'evidence') + '">' + escapeHtml(a.badge) + '</span></p>' +
        '<p class="pw-item-meta">' + escapeHtml(a.meta) + '</p>' +
        '<p class="pw-item-why">' + escapeHtml(a.prov) + '</p></div>';
    }).join('');

    document.getElementById('pw-screen-profile').innerHTML =
      '<div class="pw-card"><div class="pw-card-head">Jordan Reyes · grade 10 · class of 2029</div>' +
        '<div class="pw-item"><p class="pw-item-title">GPA 3.1</p>' +
        '<p class="pw-item-meta">4.0 unweighted scale · grade 9 not weighted at this school</p>' +
        '<p class="pw-item-why">A GPA is never displayed without its scale.</p></div></div>' +

      '<div class="pw-card"><div class="pw-card-head">Courses · this term</div>' +
        '<div class="pw-item"><p class="pw-item-title">Algebra 2<span class="pw-pill planned">in progress</span></p>' +
        '<p class="pw-item-meta">standing C+ · AP CSA prerequisite is C or better</p></div>' +
        '<div class="pw-item"><p class="pw-item-title">Intro to Computer Science<span class="pw-pill planned">in progress</span></p></div>' +
        '<div class="pw-item"><p class="pw-item-title">Chemistry · English 10 · World History</p></div></div>' +

      '<div class="pw-card"><div class="pw-card-head">Activities &amp; experiences</div>' + actRows +
        '<div class="pw-item"><p class="pw-item-why">Paid work and caregiving are first-class categories, equally prominent in the picker. Copy never frames them as a limitation.</p></div></div>' +

      '<div class="pw-card"><div class="pw-card-head">Reflections</div>' +
        '<div class="pw-item"><p class="pw-item-title">Private · 2 entries</p>' +
        '<p class="pw-item-why">Excluded from every sharing scope, including counselors with full access and internal support staff.</p></div></div>' +

      '<div class="pw-card"><div class="pw-card-head">Evidence</div>' +
        '<div class="pw-item"><p class="pw-item-why">Nothing here yet — most students add this after a few weeks.</p></div></div>' +

      '<div class="pw-excluded">Missing data is a state, never a score. No completeness percentage appears anywhere in this product.</div>';
  }

  // ---- SC-3 Roadmap ----
  function buildRoadmap(rev) {
    const goals = [
      { id: 'G1', text: 'Algebra 2 to B− by semester', pill: 'priority' },
      { id: 'G2', text: 'Working level of Python — 12 of 24 lessons', pill: '' },
      { id: 'G3', text: 'One documented artefact by 15 Dec', pill: '' },
      { id: 'G6', text: 'Decide on robotics by 16 Jan', pill: 'new' }
    ].map(function(g) {
      return '<div class="pw-item"><p class="pw-item-title">' + g.id + ' · ' + escapeHtml(g.text) +
        (g.pill ? '<span class="pw-pill ' + (g.pill === 'new' ? 'new' : 'priority') + '">' + g.pill + '</span>' : '') + '</p></div>';
    }).join('');

    document.getElementById('pw-screen-roadmap').innerHTML =
      '<div class="pw-card"><div class="pw-card-head">Roadmap v2 · accepted 20 Oct · grade 10, develop</div>' +
        '<div class="pw-item"><p class="pw-item-why">Depth in one direction, while still testing it.</p></div></div>' +

      '<div class="pw-card"><div class="pw-card-head">Band 1 · graduation requirements</div>' +
        '<div class="pw-item"><p class="pw-item-title">3 of 4 math credits · 2 of 3 science</p>' +
        '<p class="pw-item-meta">on track</p></div></div>' +

      '<div class="pw-card"><div class="pw-card-head">Band 2 · published college requirements</div>' +
        '<div class="pw-item"><p class="pw-item-title">Not available in this release</p>' +
        '<p class="pw-item-why">Rendered as an explicit placeholder rather than silently absent, so our suggestions can never be mistaken for a school or college requirement.</p></div></div>' +

      '<div class="pw-card"><div class="pw-card-head">Band 3 · development suggestions · optional</div>' + goals + '</div>' +

      '<div class="pw-card"><div class="pw-card-head">Every recommendation shows</div>' +
        '<div class="pw-item"><p class="pw-item-meta">why it fits · effort · cost · timing · an alternative · how you\u2019ll show it</p>' +
        '<p class="pw-item-why">A recommendation missing any of the six fails validation and is not shown. This is the anti-prestige mechanism: cost and alternatives are always on screen.</p></div></div>' +

      '<div class="pw-excluded">Total scheduled effort never exceeds the week\u2019s available hours. Capacity is computed per week, not averaged — which is why an in-season athlete gets a smaller plan.</div>';
  }

  // ---- SC-9 Admin console ----
  function buildAdmin() {
    const sources = [
      { pub: 'County Library', reuse: 'permitted', interval: '30 d', checked: '19 Oct 2026', state: 'verified' },
      { pub: 'City Parks & Rec', reuse: 'link only', interval: '7 d', checked: '18 Oct 2026', state: 'verified' },
      { pub: 'example.edu', reuse: 'unknown', interval: '1 d', checked: '19 Oct 2026', state: 'unreachable' }
    ].map(function(s) {
      return '<tr><td>' + escapeHtml(s.pub) + '</td><td>' + escapeHtml(s.reuse) + '</td><td>' +
        escapeHtml(s.interval) + '</td><td>' + escapeHtml(s.checked) + '</td><td>' +
        '<span class="pw-pill ' + (s.state === 'verified' ? 'eligible' : 'expired') + '">' + escapeHtml(s.state) + '</span></td></tr>';
    }).join('');

    document.getElementById('pw-admin-output').innerHTML =
      '<div class="pw-scorecard">' +
        metricCard('3', 'freshness failures', false, 'oldest 2 days') +
        metricCard('7', 'content changed', true, 'flagged, live') +
        metricCard('2', 'student reports', true, 'SLO 5 days') +
        metricCard('02:00', 'nightly sweep', true, 'last run ok') +
      '</div>' +

      '<div class="pw-card"><div class="pw-card-head">Review queue</div>' +
        '<div class="pw-item"><p class="pw-item-title">Summer Computing Institute<span class="pw-pill expired">404 ×2</span></p>' +
        '<p class="pw-item-meta">example.edu/summer-computing · last OK 2 Aug 2026 · $2,850</p>' +
        '<p class="pw-item-why">Auto-moved to unverified and out of matching. Only a human can move it back.</p>' +
        '<div class="pw-actions" style="margin-top:7px"><button data-admin="resource">Re-source</button>' +
        '<button data-admin="retire">Retire</button><button data-admin="contact">Contact provider</button></div></div>' +

        '<div class="pw-item"><p class="pw-item-title">State Science Fair — regional entry<span class="pw-pill unknown">hash changed</span></p>' +
        '<p class="pw-item-meta">was: deadline 14 Jan 2027 · fee $0</p>' +
        '<p class="pw-item-meta">now: deadline 7 Jan 2027 · fee $25</p>' +
        '<div class="pw-actions" style="margin-top:7px"><button data-admin="accept">Accept diff</button>' +
        '<button data-admin="edit">Edit</button><button data-admin="reject">Reject</button></div></div></div>' +

      '<div class="pw-card"><div class="pw-card-head">Source registry</div>' +
        '<div class="pw-table-wrap"><table class="pw-table">' +
        '<tr><th>Publisher</th><th>Reuse</th><th>Interval</th><th>Last checked</th><th>State</th></tr>' +
        sources + '</table></div>' +
        '<p class="pw-item-why">Reuse permission is recorded per source. "Link only" and "unknown" restrict us to a title, a link and our own summary — no verbatim provider text.</p></div>' +

      '<div class="pw-excluded">No student data is reachable from this console. Reflections are unreachable from every staff surface, including support. Support access requires an open ticket, student consent, a time box, a banner the student sees, and a full audit event.</div>';

    document.querySelectorAll('[data-admin]').forEach(function(b) {
      b.addEventListener('click', function() {
        const grp = this.parentElement;
        grp.querySelectorAll('button').forEach(function(x) { x.classList.remove('accepted'); });
        this.classList.add('accepted');
        document.getElementById('pw-status8').textContent = 'Action recorded by a human reviewer — nothing auto-publishes.';
      });
    });
  }

  document.getElementById('pw-admin-btn').addEventListener('click', function() {
    buildAdmin();
    document.getElementById('pw-status8').textContent = 'Empty queue is good news and is shown as such.';
  });

  document.getElementById('pw-rag-btn').addEventListener('click', runRag);
  document.querySelectorAll('.pw-chip[data-rag]').forEach(function(c) {
    c.addEventListener('click', function() { document.getElementById('pw-rag-ask').value = this.dataset.rag; });
  });

  document.getElementById('pw-coach-btn').addEventListener('click', runCoach);
  document.getElementById('pw-mcp-btn').addEventListener('click', runMcp);
  document.getElementById('pw-evals-btn').addEventListener('click', runEvals);
  document.querySelectorAll('.pw-chip').forEach(function(c) {
    c.addEventListener('click', function() { document.getElementById('pw-ask').value = this.dataset.q; });
  });

  document.getElementById('pw-counselor-btn').addEventListener('click', openCounselorView);

  document.querySelectorAll('.pw-tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      document.querySelectorAll('.pw-tab').forEach(function(t) { t.classList.remove('active'); });
      document.querySelectorAll('.pw-screen').forEach(function(s) { s.classList.remove('active'); });
      this.classList.add('active');
      document.getElementById('pw-screen-' + this.dataset.screen).classList.add('active');
    });
  });

  runBtn.addEventListener('click', runAgent);
  commitBtn.addEventListener('click', commitUpdates);
  replanBtn.addEventListener('click', draftRevision);
}
