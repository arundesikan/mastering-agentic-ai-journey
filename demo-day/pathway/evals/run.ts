/**
 * Eval runner. These are the G3 launch gates, executable.
 *
 * Gates:
 *   hallucinated fields        = 0
 *   constraint violations      = 0
 *   schema validity            = 100%
 *
 * A failure here blocks the pilot. Run in CI on every change to a prompt.
 */
import fixtures from './fixtures.json';
import { extract, isGrounded } from '../lib/extraction';

interface Assertion {
  type: string;
  pattern?: string;
  value?: unknown;
  label: string;
}

async function main() {
  let passed = 0;
  let failed = 0;
  const failures: string[] = [];

  for (const f of fixtures as any[]) {
    let result;
    try {
      result = await extract(f.input, {});
    } catch (e) {
      failed++;
      failures.push(`${f.name}: extraction threw — ${(e as Error).message}`);
      continue;
    }

    const flat = JSON.stringify(result);
    let caseOk = true;

    for (const a of f.assertions as Assertion[]) {
      let ok = true;
      switch (a.type) {
        case 'forbidden_pattern':
          ok = !new RegExp(a.pattern!, 'i').test(flat);
          break;
        case 'required_pattern':
          ok = new RegExp(a.pattern!, 'i').test(flat);
          break;
        case 'has_proposal_type':
          ok = result.proposals.some((p) => p.type === a.value);
          break;
        case 'no_proposal_type':
          ok = !result.proposals.some((p) => p.type === a.value);
          break;
        case 'max_proposals':
          ok = result.proposals.length <= (a.value as number);
          break;
        case 'min_proposals':
          ok = result.proposals.length >= (a.value as number);
          break;
        case 'no_high_confidence_activity_matching':
          ok = !result.proposals.some(
            (p) =>
              p.type === 'new_activity' &&
              new RegExp(a.pattern!, 'i').test(`${p.summary} ${p.detail}`) &&
              p.confidence === 'high'
          );
          break;
        case 'all_evidence_grounded':
          ok = result.proposals.every((p) => isGrounded(p.evidence, f.input));
          break;
      }
      if (!ok) {
        caseOk = false;
        failures.push(`${f.name}: ${a.label}`);
      }
    }

    if (caseOk) passed++;
    else failed++;
    console.log(`${caseOk ? 'PASS' : 'FAIL'}  ${f.name}`);
  }

  console.log(`\n${passed}/${passed + failed} cases passed`);
  if (failures.length) {
    console.log('\nFailures:');
    failures.forEach((f) => console.log('  - ' + f));
  }
  process.exit(failed === 0 ? 0 : 1);
}

main();
