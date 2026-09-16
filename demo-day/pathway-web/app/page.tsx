"use client";

import { useEffect, useRef } from "react";

const MARKUP = String.raw`<div id="pathway-demo">
  <p class="pw-eyebrow">Pathway — live agent demo</p>
  <h1 class="pw-title">One check-in, through the whole loop</h1>
  <p class="pw-sub">A student's free text becomes confirmed record updates, a deterministic check decides whether the plan is affected, and only then does the agent draft a revision. The student decides at every gate.</p>

  <div class="pw-stage-bar">
    <span class="pw-stage active" id="pw-stage-1">1 · Check-in</span>
    <span class="pw-stage" id="pw-stage-2">2 · Proposed updates</span>
    <span class="pw-stage" id="pw-stage-3">3 · Trigger check</span>
    <span class="pw-stage" id="pw-stage-4">4 · Plan revision</span>
  </div>

  <div class="pw-input-card">
    <div class="pw-input-label">Student's check-in — Jordan Reyes, week of Oct 20</div>
    <textarea id="pw-textarea">Soccer went to playoffs so practice went up. I helped organize the robotics club's fall demo night — did the signup sheet and ran the check-in table, about 6 hours over two weeks. Also finished 4 more Python lessons. Algebra 2 quiz was a 78.</textarea>
    <div class="pw-run-row">
      <button class="pw-btn" id="pw-run-btn">Run the agent</button>
      <span id="pw-status"></span>
    </div>
  </div>

  <div class="pw-split">
    <div class="pw-computed">
      <div class="pw-panel-head">
        <span class="pw-panel-title">Known before the call</span>
        <span class="pw-panel-note">plain code</span>
      </div>
      <div class="pw-fact">
        <span class="pw-fact-label">Weekly capacity</span>
        <span class="pw-fact-value">2 hrs/wk in season</span>
      </div>
      <div class="pw-fact">
        <span class="pw-fact-label">AP CSA prerequisite</span>
        <span class="pw-fact-value">Algebra 2, C or better — now C+</span>
      </div>
      <div class="pw-fact">
        <span class="pw-fact-label">Course registration</span>
        <span class="pw-fact-value">Feb 2, 2027 · 104 days out</span>
      </div>
      <div class="pw-fact">
        <span class="pw-fact-label">Python track</span>
        <span class="pw-fact-value">8 of 24 lessons</span>
      </div>
      <div class="pw-fact">
        <span class="pw-fact-label">Current plan</span>
        <span class="pw-fact-value">3 actions/wk · 90 min</span>
      </div>
    </div>

    <div class="pw-generated">
      <div class="pw-panel-head">
        <span class="pw-panel-title">Proposed by the agent</span>
        <span class="pw-panel-note">nothing saved until accepted</span>
      </div>
      <div id="pw-output">
        <div class="pw-placeholder">Run the agent to see proposals generated from the text above.</div>
      </div>
      <div class="pw-confirm-bar pw-hidden" id="pw-confirm-bar">
        <span class="pw-confirm-text" id="pw-confirm-text">Accept or reject each proposal above.</span>
        <button class="pw-btn" id="pw-commit-btn">Save accepted updates</button>
      </div>
    </div>
  </div>

  <div class="pw-section pw-hidden" id="pw-trigger-section">
    <h2 class="pw-section-title">Does the plan need to change?</h2>
    <p class="pw-section-sub">This decision is made in code, not by the model. Each rule is evaluated against the updates the student just confirmed.</p>
    <div class="pw-trigger" id="pw-trigger-box"></div>
    <div class="pw-run-row" id="pw-replan-row">
      <button class="pw-btn" id="pw-replan-btn">Draft a revised plan</button>
      <span id="pw-status2"></span>
    </div>
  </div>

  <div class="pw-section pw-hidden" id="pw-revision-section">
    <h2 class="pw-section-title">Proposed plan revision</h2>
    <p class="pw-section-sub">The rules above decided <em>that</em> the plan changes and what the constraints are. The agent only writes the reasoning a student actually reads.</p>
    <div id="pw-revision-output"></div>
  </div>

  <div class="pw-section pw-hidden" id="pw-after-section">
    <h2 class="pw-section-title">Where the update lands</h2>
    <p class="pw-section-sub">Same student, after accepting. These screens are built from what Jordan confirmed — the record only contains things he said and approved.</p>
    <div class="pw-tabs">
      <button class="pw-tab active" data-screen="dash">Dashboard</button>
      <button class="pw-tab" data-screen="profile">Profile</button>
      <button class="pw-tab" data-screen="roadmap">Roadmap</button>
      <button class="pw-tab" data-screen="portfolio">Portfolio</button>
      <button class="pw-tab" data-screen="opps">Opportunities</button>
    </div>
    <div class="pw-screen active" id="pw-screen-dash"></div>
    <div class="pw-screen" id="pw-screen-profile"></div>
    <div class="pw-screen" id="pw-screen-roadmap"></div>
    <div class="pw-screen" id="pw-screen-portfolio"></div>
    <div class="pw-screen" id="pw-screen-opps"></div>
  </div>

  <div class="pw-section pw-hidden" id="pw-counselor-section">
    <h2 class="pw-section-title">The same record, seen by a counselor</h2>
    <p class="pw-section-sub">Ms. Alvarez has 380 students and has never met Jordan. She needs a 60-second read, not a data-entry task. She sees only what Jordan granted.</p>
    <div class="pw-run-row" style="margin-bottom:16px">
      <button class="pw-btn" id="pw-counselor-btn">Open counselor view</button>
      <span id="pw-status3"></span>
    </div>
    <div id="pw-counselor-output"></div>
  </div>

  <div class="pw-section pw-hidden" id="pw-coach-section">
    <h2 class="pw-section-title">Ask the coach</h2>
    <p class="pw-section-sub">FR-56. The agent has tools and must call them. It is forbidden from deciding eligibility, computing dates, or assuming capacity on its own — every one of those is a function call into code.</p>
    <input class="pw-ask" id="pw-ask" value="Can I do the Summer Computing Institute, and what should I focus on this week?">
    <div class="pw-chips">
      <button class="pw-chip" data-q="Should I sign up for the Elite CS Bootcamp?">Budget trap</button>
      <button class="pw-chip" data-q="How many days until course registration, and am I on track for AP CSA?">Deadline check</button>
      <button class="pw-chip" data-q="What free things fit my schedule right now?">Free options</button>
    </div>
    <div class="pw-run-row">
      <button class="pw-btn" id="pw-coach-btn">Ask</button>
      <span id="pw-status4" style="font-size:13px;color:var(--ink-soft)"></span>
    </div>
    <div id="pw-coach-trace"></div>
  </div>

  <div class="pw-section pw-hidden" id="pw-mcp-section">
    <h2 class="pw-section-title">Real capacity, from a real calendar</h2>
    <p class="pw-section-sub">Capacity is the constraint everything else is filtered by, and asking a teenager to self-report it is the weakest link. Over MCP the agent reads the connected Google Calendar and computes actual free hours. Read-only — nothing is written.</p>
    <div class="pw-run-row">
      <button class="pw-btn" id="pw-mcp-btn">Read calendar over MCP</button>
      <span id="pw-status5" style="font-size:13px;color:var(--ink-soft)"></span>
    </div>
    <div id="pw-mcp-trace"></div>
  </div>

  <div class="pw-section pw-hidden" id="pw-college-section">
    <h2 class="pw-section-title">College workspace</h2>
    <p class="pw-section-sub">SC-7. Every value carries its source and as-of date. Answers are generated only from retrieved source rows, and each claim must cite the row it came from — an uncited claim is a failure, not a style issue.</p>
    <input class="pw-ask" id="pw-rag-ask" value="What would State University A actually cost, and what math do they require?">
    <div class="pw-chips">
      <button class="pw-chip" data-rag="What are my chances of getting into State University A?">Score trap</button>
      <button class="pw-chip" data-rag="Which of these colleges offers computer science and what do they cost?">CS + cost</button>
      <button class="pw-chip" data-rag="What is Regional College B's admission rate?">Data gap</button>
    </div>
    <div class="pw-run-row">
      <button class="pw-btn" id="pw-rag-btn">Ask, grounded in sources</button>
      <span id="pw-status7" style="font-size:13px;color:var(--ink-soft)"></span>
    </div>
    <div id="pw-rag-output"></div>
    <div id="pw-compare"></div>
  </div>

  <div class="pw-section" id="pw-admin-section">
    <h2 class="pw-section-title">Admin console</h2>
    <p class="pw-section-sub">SC-9. Catalog rot is guaranteed, so curation is staffed work with a tool, not an automated pipeline. Nothing returns to the catalog from a crawl — only a human puts it back.</p>
    <div class="pw-run-row">
      <button class="pw-btn" id="pw-admin-btn">Open admin console</button>
      <span id="pw-status8" style="font-size:13px;color:var(--ink-soft)"></span>
    </div>
    <div id="pw-admin-output"></div>
  </div>

  <div class="pw-section" id="pw-evals-section">
    <h2 class="pw-section-title">Quality gates</h2>
    <p class="pw-section-sub">Six fixtures against the extraction module. Three are traps — text that invites inventing a title, inflating a grade, or framing paid work as a shortfall. Every assertion runs in JavaScript; the model never grades itself.</p>
    <div class="pw-run-row">
      <button class="pw-btn" id="pw-evals-btn">Run eval suite</button>
      <span id="pw-status6" style="font-size:13px;color:var(--ink-soft)"></span>
    </div>
    <div id="pw-scorecard"></div>
    <div id="pw-eval-results"></div>
  </div>
</div>`;

export default function Home() {
  const ref = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    // The demo logic is plain DOM code, so it runs after the markup mounts.
    import("../lib/demo.js").then((m: any) => m.initDemo());
  }, []);

  return <div ref={ref} dangerouslySetInnerHTML={{ __html: MARKUP }} />;
}
