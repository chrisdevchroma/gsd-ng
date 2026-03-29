# Verification Patterns — Standard

> Pattern descriptions with when-to-use guidance (no code blocks). See also:
> - `@~/.claude/gsd-ng/references/verification-patterns-core.md` — quick reference
> - `@~/.claude/gsd-ng/references/verification-patterns-deep.md` — code examples
# Verification Patterns

How to verify different types of artifacts are real implementations, not stubs or placeholders.

<core_principle>
**Existence ≠ Implementation**

A file existing does not mean the feature works. Verification must check:
1. **Exists** - File is present at expected path
2. **Substantive** - Content is real implementation, not placeholder
3. **Wired** - Connected to the rest of the system
4. **Functional** - Actually works when invoked

Levels 1-3 can be checked programmatically. Level 4 often requires human verification.
</core_principle>

<stub_detection>

## Universal Stub Patterns

These patterns indicate placeholder code regardless of file type:

**Comment-based stubs:**

**Placeholder text in output:**

**Empty or trivial implementations:**

**Hardcoded values where dynamic expected:**

</stub_detection>

<react_components>

## React/Next.js Components

**Existence check:**

**Substantive check:**

**Stub patterns specific to React:**

**Wiring check:**

**Functional verification (human required):**
- Does the component render visible content?
- Do interactive elements respond to clicks?
- Does data load and display?
- Do error states show appropriately?

</react_components>

<api_routes>

## API Routes (Next.js App Router / Express / etc.)

**Existence check:**

**Substantive check:**

**Stub patterns specific to API routes:**

**Wiring check:**

**Functional verification (human or automated):**
- Does GET return real data from database?
- Does POST actually create a record?
- Does error response have correct status code?
- Are auth checks actually enforced?

</api_routes>

<database_schema>

## Database Schema (Prisma / Drizzle / SQL)

**Existence check:**

**Substantive check:**

**Stub patterns specific to schemas:**

**Wiring check:**

**Functional verification:**

</database_schema>

<hooks_utilities>

## Custom Hooks and Utilities

**Existence check:**

**Substantive check:**

**Stub patterns specific to hooks:**

**Wiring check:**

</hooks_utilities>

<environment_config>

## Environment Variables and Configuration

**Existence check:**

**Substantive check:**

**Stub patterns specific to env:**

**Wiring check:**

</environment_config>

<wiring_verification>

## Wiring Verification Patterns

Wiring verification checks that components actually communicate. This is where most stubs hide.

### Pattern: Component → API

**Check:** Does the component actually call the API?


**Red flags:**

### Pattern: API → Database

**Check:** Does the API route actually query the database?


**Red flags:**

### Pattern: Form → Handler

**Check:** Does the form submission actually do something?


**Red flags:**

### Pattern: State → Render

**Check:** Does the component render state, not hardcoded content?


**Red flags:**
</div>

</wiring_verification>

<verification_checklist>

## Quick Verification Checklist

For each artifact type, run through this checklist:

### Component Checklist
- [ ] File exists at expected path
- [ ] Exports a function/const component
- [ ] Returns JSX (not null/empty)
- [ ] No placeholder text in render
- [ ] Uses props or state (not static)
- [ ] Event handlers have real implementations
- [ ] Imports resolve correctly
- [ ] Used somewhere in the app

### API Route Checklist
- [ ] File exists at expected path
- [ ] Exports HTTP method handlers
- [ ] Handlers have more than 5 lines
- [ ] Queries database or service
- [ ] Returns meaningful response (not empty/placeholder)
- [ ] Has error handling
- [ ] Validates input
- [ ] Called from frontend

### Schema Checklist
- [ ] Model/table defined
- [ ] Has all expected fields
- [ ] Fields have appropriate types
- [ ] Relationships defined if needed
- [ ] Migrations exist and applied
- [ ] Client generated

### Hook/Utility Checklist
- [ ] File exists at expected path
- [ ] Exports function
- [ ] Has meaningful implementation (not empty returns)
- [ ] Used somewhere in the app
- [ ] Return values consumed

### Wiring Checklist
- [ ] Component → API: fetch/axios call exists and uses response
- [ ] API → Database: query exists and result returned
- [ ] Form → Handler: onSubmit calls API/mutation
- [ ] State → Render: state variables appear in JSX

</verification_checklist>

<automated_verification_script>

## Automated Verification Approach

For the verification subagent, use this pattern:


Run these checks against each must-have artifact. Aggregate results into VERIFICATION.md.

</automated_verification_script>

<human_verification_triggers>

## When to Require Human Verification

Some things can't be verified programmatically. Flag these for human testing:

**Always human:**
- Visual appearance (does it look right?)
- User flow completion (can you actually do the thing?)
- Real-time behavior (WebSocket, SSE)
- External service integration (Stripe, email sending)
- Error message clarity (is the message helpful?)
- Performance feel (does it feel fast?)

**Human if uncertain:**
- Complex wiring that grep can't trace
- Dynamic behavior depending on state
- Edge cases and error states
- Mobile responsiveness
- Accessibility

**Format for human verification request:**

</human_verification_triggers>

<checkpoint_automation_reference>

## Pre-Checkpoint Automation

For automation-first checkpoint patterns, server lifecycle management, CLI installation handling, and error recovery protocols, see:

**@~/.claude/gsd-ng/references/checkpoints.md** → `<automation_reference>` section

Key principles:
- Claude sets up verification environment BEFORE presenting checkpoints
- Users never run CLI commands (visit URLs only)
- Server lifecycle: start before checkpoint, handle port conflicts, keep running for duration
- CLI installation: auto-install where safe, checkpoint for user choice otherwise
- Error handling: fix broken environment before checkpoint, never present checkpoint with failed setup

</checkpoint_automation_reference>
