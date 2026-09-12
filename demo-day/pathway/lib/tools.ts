/**
 * The deterministic layer, exposed to the model as callable tools.
 *
 * Rule: the model is never asked "is this student eligible?" or "when is this due?"
 * It must call one of these. A hallucinated eligibility claim is therefore not a
 * possible failure mode — it is not a thing the model is ever allowed to produce.
 */

export type EligibilityState = 'eligible' | 'not_eligible' | 'unknown';

export interface StudentConstraints {
  grade: number;
  budgetPerYearCents: number;
  hasTransport: boolean;
  hoursPerWeek: number;
}

export interface Opportunity {
  id: string;
  name: string;
  costCents: number;
  transitAccessible: boolean;
  minGrade: number | null;
  maxGrade: number | null;
  hoursPerWeek: number | null;
  state: 'live' | 'unverified' | 'retired';
}

export function checkEligibility(
  o: Opportunity,
  c: StudentConstraints
): { state: EligibilityState; reason: string } {
  if (o.state !== 'live') {
    return { state: 'unknown', reason: 'Listing is unverified; the provider page could not be reached.' };
  }
  if (o.costCents > c.budgetPerYearCents) {
    return {
      state: 'not_eligible',
      reason: `Costs $${(o.costCents / 100).toFixed(0)}, over the $${(c.budgetPerYearCents / 100).toFixed(0)} annual budget.`,
    };
  }
  if (!o.transitAccessible && !c.hasTransport) {
    return { state: 'not_eligible', reason: 'No transit route and the student has no car.' };
  }
  // Three states, not two. "We don't know" is a supported answer.
  if (o.minGrade === null && o.maxGrade === null) {
    return { state: 'unknown', reason: 'Eligibility is not stated in the posting. Verification is queued.' };
  }
  if (o.minGrade !== null && c.grade < o.minGrade) {
    return { state: 'not_eligible', reason: `Open from grade ${o.minGrade}.` };
  }
  if (o.maxGrade !== null && c.grade > o.maxGrade) {
    return { state: 'not_eligible', reason: `Open through grade ${o.maxGrade}.` };
  }
  return { state: 'eligible', reason: 'Meets cost, transport and grade constraints.' };
}

/** All date arithmetic lives here. Tested across timezones and DST. */
export function daysUntil(dateISO: string, now: Date = new Date()): number {
  const target = new Date(dateISO + 'T00:00:00Z');
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

/**
 * Capacity is computed per week, never averaged. This is why an in-season
 * athlete gets a smaller plan rather than the same plan spread thinner.
 */
export function weeklyCapacity(
  baseHours: number,
  commitments: { hoursPerWeek: number; startsOn: string; endsOn: string }[],
  weekOf: Date
): number {
  const active = commitments.filter((c) => {
    const s = new Date(c.startsOn).getTime();
    const e = new Date(c.endsOn).getTime();
    return weekOf.getTime() >= s && weekOf.getTime() <= e;
  });
  const used = active.reduce((sum, c) => sum + c.hoursPerWeek, 0);
  return Math.max(0, baseHours - used);
}

/** A plan that exceeds the week's real hours is invalid before it is ever shown. */
export function validatePlan(
  tasks: { effortMinutes: number; costCents: number }[],
  capacityHours: number,
  budgetRemainingCents: number,
  maxTasks = 4
): { valid: boolean; violations: string[] } {
  const violations: string[] = [];
  if (tasks.length > maxTasks) violations.push(`${tasks.length} tasks exceeds the cap of ${maxTasks}.`);
  const totalMinutes = tasks.reduce((s, t) => s + t.effortMinutes, 0);
  if (totalMinutes > capacityHours * 60) {
    violations.push(`${totalMinutes} minutes exceeds ${capacityHours} available hours.`);
  }
  const totalCost = tasks.reduce((s, t) => s + t.costCents, 0);
  if (totalCost > budgetRemainingCents) violations.push('Plan exceeds the remaining budget.');
  return { valid: violations.length === 0, violations };
}
