// app/api/_whoami/route.ts
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const info = {
    ok: true,
    ts: Date.now(),
    // Variables Vercel d’identification
    vercel: {
      url: process.env.VERCEL_URL || null,
      env: process.env.VERCEL_ENV || null, // production / preview / development
      gitRepoOwner: process.env.VERCEL_GIT_REPO_OWNER || null,
      gitRepoSlug: process.env.VERCEL_GIT_REPO_SLUG || null,
      gitCommitSha: process.env.VERCEL_GIT_COMMIT_SHA || null,
      gitCommitRef: process.env.VERCEL_GIT_COMMIT_REF || null, // branche
    },
  };
  return NextResponse.json(info);
}
