/**
 * POST /api/updates — the weekly check-in.
 *
 * The ordering here is the whole point:
 *   1. Persist the raw text in its own transaction.
 *   2. Return 202 immediately.
 *   3. Extract asynchronously.
 * Killing the extraction job mid-flight must never lose the student's words.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: NextRequest) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { studentId, rawText, taskStatuses, idempotencyKey } = await req.json();

  if (!rawText?.trim() && !taskStatuses) {
    return NextResponse.json({ error: 'empty_submission' }, { status: 400 });
  }

  const { data: student } = await supabase
    .from('students')
    .select('id, updated_at')
    .eq('id', studentId)
    .single();

  if (!student) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // Step 1: commit the words before any model call.
  const { data: submission, error } = await supabase
    .from('update_submissions')
    .insert({
      student_id: studentId,
      raw_text: rawText ?? '',
      task_statuses: taskStatuses ?? {},
      profile_version_at_submit: 0,
      idempotency_key: idempotencyKey,
    })
    .select()
    .single();

  // Duplicate submissions are a no-op, not a second write.
  if (error?.code === '23505') {
    return NextResponse.json({ status: 'already_received' }, { status: 200 });
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Step 2: hand off. Extraction runs in a background job (see docs/ARCHITECTURE.md).
  await fetch(`${process.env.INNGEST_URL}/e/update.submitted`, {
    method: 'POST',
    body: JSON.stringify({ name: 'update.submitted', data: { submissionId: submission.id } }),
  }).catch(() => {
    // A failed enqueue must not lose the submission. A sweeper picks up
    // rows left in extraction_state = 'pending'.
  });

  return NextResponse.json({ submissionId: submission.id, status: 'accepted' }, { status: 202 });
}
