# Pathway — web app

A Next.js app. The Anthropic API key is held server-side in a serverless route;
the browser never sees it.

```
app/page.tsx            the demo UI
app/api/agent/route.ts  server-side proxy — the key lives here
lib/demo.js             agent logic: extraction, triggers, tools, retrieval, evals
```

## Run locally

```bash
npm install
cp .env.local.example .env.local     # paste your real key into .env.local
npm run dev                          # http://localhost:3000
```

## Deploy to Vercel

1. Push this folder to GitHub.
2. vercel.com -> Add New -> Project -> import the repo.
3. BEFORE clicking Deploy, open Environment Variables and add:
   ANTHROPIC_API_KEY = your key
4. Deploy. Live URL in about a minute.

If the page loads but the agent errors, the key is missing or misspelled in
Vercel's environment variables. Fix it there and redeploy.

## Why the proxy

A key in client-side JavaScript is readable by anyone who opens devtools.
The route also pins the model and caps max_tokens, so a client cannot change
either.
