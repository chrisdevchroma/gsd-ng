# Verification Patterns — Core

> Pattern names and one-line descriptions. See also:
> - `@~/.claude/gsd-ng/references/verification-patterns-standard.md` — full descriptions
> - `@~/.claude/gsd-ng/references/verification-patterns-deep.md` — code examples
## Universal Stub Patterns
## React/Next.js Components
## API Routes (Next.js App Router / Express / etc.)
## Database Schema (Prisma / Drizzle / SQL)
## Custom Hooks and Utilities
## Environment Variables and Configuration
## Wiring Verification Patterns
### Pattern: Component → API
### Pattern: API → Database
### Pattern: Form → Handler
### Pattern: State → Render
## Quick Verification Checklist
### Component Checklist
- [ ] File exists at expected path
- [ ] Exports a function/const component
- [ ] Returns JSX (not null/empty)
### API Route Checklist
- [ ] File exists at expected path
- [ ] Exports HTTP method handlers
- [ ] Handlers have more than 5 lines
### Schema Checklist
- [ ] Model/table defined
- [ ] Has all expected fields
- [ ] Fields have appropriate types
### Hook/Utility Checklist
- [ ] File exists at expected path
- [ ] Exports function
- [ ] Has meaningful implementation (not empty returns)
### Wiring Checklist
- [ ] Component → API: fetch/axios call exists and uses response
- [ ] API → Database: query exists and result returned
- [ ] Form → Handler: onSubmit calls API/mutation
## Automated Verification Approach
## When to Require Human Verification
## Pre-Checkpoint Automation
