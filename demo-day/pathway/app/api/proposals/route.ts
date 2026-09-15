/**
 * POST /api/proposals/resolve — the confirmation gate.
 *
 * One transaction: snapshot check, writes, history events, version increment,
 * proposals resolved. All or nothing. This is delegated to the resolve_proposals
 * Postgres function so the atomicity is enforced by the database, not by
 * application code that might be interrupted halfway.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: NextRequest) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { studentId, submissionId, expectedVersion, resolutions } = await req.json();

  const { data, error } = await supabase.rpc('resolve_proposals', {
    p_student_id: studentId,
    p_submission_id: submissionId,
    p_expected_version: expectedVersion,
    p_resolutions: resolutions,
  });

  if (error) {
    // A stale snapshot is a conflict, not a crash. The client shows a
    // side-by-side "Yours / Current" and lets the student keep per field.
    // The server never merges silently or picks a winner.
    if (error.message.includes('stale_snapshot')) {
      return NextResponse.json({ error: 'conflict', detail: error.message }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ newVersion: data });
}
