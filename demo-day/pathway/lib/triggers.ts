/**
 * Replan trigger evaluation. Deterministic, so a student is never interrupted
 * because a model felt something had changed.
 */

export interface TriggerResult {
  rule: string;
  fired: boolean;
  detail: string;
}

export interface TriggerInput {
  previousCapacityHours: number;
  newCapacityHours: number;
  newSustainedActivityInDomain: boolean;
  prerequisiteAtRisk: boolean;
  nearestDeadlineDays: number;
}

export const CAPACITY_DROP_THRESHOLD = 0.4;
export const DEADLINE_WINDOW_DAYS = 14;

export function evaluateTriggers(i: TriggerInput): TriggerResult[] {
  const drop =
    i.previousCapacityHours > 0
      ? (i.previousCapacityHours - i.newCapacityHours) / i.previousCapacityHours
      : 0;

  return [
    {
      rule: 'capacity_drop > 40%',
      fired: drop > CAPACITY_DROP_THRESHOLD,
      detail: `${i.previousCapacityHours}h to ${i.newCapacityHours}h = ${Math.round(drop * 100)}% change.`,
    },
    {
      rule: 'new_sustained_activity_in_plan_relevant_domain',
      fired: i.newSustainedActivityInDomain,
      detail: i.newSustainedActivityInDomain
        ? "A confirmed activity matches the student's stated direction."
        : 'No new plan-relevant activity confirmed.',
    },
    {
      rule: 'prerequisite_at_risk',
      fired: i.prerequisiteAtRisk,
      detail: i.prerequisiteAtRisk
        ? 'A published prerequisite is no longer comfortably met.'
        : 'No prerequisite signal this cycle.',
    },
    {
      rule: `deadline_within_${DEADLINE_WINDOW_DAYS}_days`,
      fired: i.nearestDeadlineDays <= DEADLINE_WINDOW_DAYS,
      detail: `Nearest deadline is ${i.nearestDeadlineDays} days out.`,
    },
  ];
}

export function shouldReplan(results: TriggerResult[]): boolean {
  return results.some((r) => r.fired);
}
