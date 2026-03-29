# Checkpoints Reference — Standard

> Writing guidelines and patterns. See also:
> - `@~/.claude/gsd-ng/references/checkpoints-core.md` — type definitions
> - `@~/.claude/gsd-ng/references/checkpoints-deep.md` — full examples
<execution_protocol>

When Claude encounters `type="checkpoint:*"`:

1. **Stop immediately** - do not proceed to next task
2. **Display checkpoint clearly** using the format below
3. **Wait for user response** - do not hallucinate completion
4. **Verify if possible** - check files, run tests, whatever is specified
5. **Resume execution** - continue to next task only after confirmation

**For checkpoint:human-verify:**

**For checkpoint:decision:**

**For checkpoint:human-action:**
</execution_protocol>

<authentication_gates>

**Auth gate = Claude tried CLI/API, got auth error.** Not a failure — a gate requiring human input to unblock.

**Pattern:** Claude tries automation → auth error → creates checkpoint:human-action → user authenticates → Claude retries → continues

**Gate protocol:**
1. Recognize it's not a failure - missing auth is expected
2. Stop current task - don't retry repeatedly
3. Create checkpoint:human-action dynamically
4. Provide exact authentication steps
5. Verify authentication works
6. Retry the original task
7. Continue normally

**Key distinction:**
- Pre-planned checkpoint: "I need you to do X" (wrong - Claude should automate)
- Auth gate: "I tried to automate X but need credentials" (correct - unblocks automation)

</authentication_gates>

<automation_reference>

**The rule:** If it has CLI/API, Claude does it. Never ask human to perform automatable work.

## Service CLI Reference

| Service | CLI/API | Key Commands | Auth Gate |
|---------|---------|--------------|-----------|
| Vercel | `vercel` | `--yes`, `env add`, `--prod`, `ls` | `vercel login` |
| Railway | `railway` | `init`, `up`, `variables set` | `railway login` |
| Fly | `fly` | `launch`, `deploy`, `secrets set` | `fly auth login` |
| Stripe | `stripe` + API | `listen`, `trigger`, API calls | API key in .env |
| Supabase | `supabase` | `init`, `link`, `db push`, `gen types` | `supabase login` |
| Upstash | `upstash` | `redis create`, `redis get` | `upstash auth login` |
| PlanetScale | `pscale` | `database create`, `branch create` | `pscale auth login` |
| GitHub | `gh` | `repo create`, `pr create`, `secret set` | `gh auth login` |
| Node | `npm`/`pnpm` | `install`, `run build`, `test`, `run dev` | N/A |
| Xcode | `xcodebuild` | `-project`, `-scheme`, `build`, `test` | N/A |
| Convex | `npx convex` | `dev`, `deploy`, `env set`, `env get` | `npx convex login` |

## Environment Variable Automation

**Env files:** Use Write/Edit tools. Never ask human to create .env manually.

**Dashboard env vars via CLI:**

| Platform | CLI Command | Example |
|----------|-------------|---------|
| Convex | `npx convex env set` | `npx convex env set OPENAI_API_KEY sk-...` |
| Vercel | `vercel env add` | `vercel env add STRIPE_KEY production` |
| Railway | `railway variables set` | `railway variables set API_KEY=value` |
| Fly | `fly secrets set` | `fly secrets set DATABASE_URL=...` |
| Supabase | `supabase secrets set` | `supabase secrets set MY_SECRET=value` |

**Secret collection pattern:**

## Dev Server Automation

| Framework | Start Command | Ready Signal | Default URL |
|-----------|---------------|--------------|-------------|
| Next.js | `npm run dev` | "Ready in" or "started server" | http://localhost:3000 |
| Vite | `npm run dev` | "ready in" | http://localhost:5173 |
| Convex | `npx convex dev` | "Convex functions ready" | N/A (backend only) |
| Express | `npm start` | "listening on port" | http://localhost:3000 |
| Django | `python manage.py runserver` | "Starting development server" | http://localhost:8000 |

**Server lifecycle:**

**Port conflicts:** Kill stale process (`lsof -ti:3000 | xargs kill`) or use alternate port (`--port 3001`).

**Server stays running** through checkpoints. Only kill when plan complete, switching to production, or port needed for different service.

## CLI Installation Handling

| CLI | Auto-install? | Command |
|-----|---------------|---------|
| npm/pnpm/yarn | No - ask user | User chooses package manager |
| vercel | Yes | `npm i -g vercel` |
| gh (GitHub) | Yes | `brew install gh` (macOS) or `apt install gh` (Linux) |
| stripe | Yes | `npm i -g stripe` |
| supabase | Yes | `npm i -g supabase` |
| convex | No - use npx | `npx convex` (no install needed) |
| fly | Yes | `brew install flyctl` or curl installer |
| railway | Yes | `npm i -g @railway/cli` |

**Protocol:** Try command → "command not found" → auto-installable? → yes: install silently, retry → no: checkpoint asking user to install.

## Pre-Checkpoint Automation Failures

| Failure | Response |
|---------|----------|
| Server won't start | Check error, fix issue, retry (don't proceed to checkpoint) |
| Port in use | Kill stale process or use alternate port |
| Missing dependency | Run `npm install`, retry |
| Build error | Fix the error first (bug, not checkpoint issue) |
| Auth error | Create auth gate checkpoint |
| Network timeout | Retry with backoff, then checkpoint if persistent |

**Never present a checkpoint with broken verification environment.** If `curl localhost:3000` fails, don't ask user to "visit localhost:3000".

## Automatable Quick Reference

| Action | Automatable? | Claude does it? |
|--------|--------------|-----------------|
| Deploy to Vercel | Yes (`vercel`) | YES |
| Create Stripe webhook | Yes (API) | YES |
| Write .env file | Yes (Write tool) | YES |
| Create Upstash DB | Yes (`upstash`) | YES |
| Run tests | Yes (`npm test`) | YES |
| Start dev server | Yes (`npm run dev`) | YES |
| Add env vars to Convex | Yes (`npx convex env set`) | YES |
| Add env vars to Vercel | Yes (`vercel env add`) | YES |
| Seed database | Yes (CLI/API) | YES |
| Click email verification link | No | NO |
| Enter credit card with 3DS | No | NO |
| Complete OAuth in browser | No | NO |
| Visually verify UI looks correct | No | NO |
| Test interactive user flows | No | NO |

</automation_reference>

<writing_guidelines>

**DO:**
- Automate everything with CLI/API before checkpoint
- Be specific: "Visit https://myapp.vercel.app" not "check deployment"
- Number verification steps
- State expected outcomes: "You should see X"
- Provide context: why this checkpoint exists

**DON'T:**
- Ask human to do work Claude can automate ❌
- Assume knowledge: "Configure the usual settings" ❌
- Skip steps: "Set up database" (too vague) ❌
- Mix multiple verifications in one checkpoint ❌

**Placement:**
- **After automation completes** - not before Claude does the work
- **After UI buildout** - before declaring phase complete
- **Before dependent work** - decisions before implementation
- **At integration points** - after configuring external services

**Bad placement:** Before automation ❌ | Too frequent ❌ | Too late (dependent tasks already needed the result) ❌
</writing_guidelines>
