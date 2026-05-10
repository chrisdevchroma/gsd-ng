# Phase Argument Parsing

Parse and normalize phase arguments for commands that operate on phases.

## Extraction

From `$ARGUMENTS`:
- Extract phase number (first numeric argument)
- Extract flags (prefixed with `--`)
- Remaining text is description (for insert/add commands)

## Using gsd-tools

The `find-phase` command handles normalization and validation in one step:

```bash
node ./.claude/gsd-ng/bin/gsd-tools.cjs find-phase "${PHASE}" --json > $TMPDIR/phase-arg-info.json
# Read individual fields with init-get-from-file:
node ./.claude/gsd-ng/bin/gsd-tools.cjs init-get-from-file $TMPDIR/phase-arg-info.json found > $TMPDIR/phase-arg-found.txt
read PHASE_FOUND < $TMPDIR/phase-arg-found.txt
node ./.claude/gsd-ng/bin/gsd-tools.cjs init-get-from-file $TMPDIR/phase-arg-info.json directory > $TMPDIR/phase-arg-dir.txt
read PHASE_DIR < $TMPDIR/phase-arg-dir.txt
```

The JSON file `$TMPDIR/phase-arg-info.json` contains:
- `found`: true/false
- `directory`: Full path to phase directory
- `phase_number`: Normalized number (e.g., "06", "06.1")
- `phase_name`: Name portion (e.g., "foundation")
- `plans`: Array of PLAN.md files
- `summaries`: Array of SUMMARY.md files

## Manual Normalization (Legacy)

Zero-pad integer phases to 2 digits. Preserve decimal suffixes. Use `printf -v` to assign without command substitution.

```bash
# Normalize phase number
if [[ "$PHASE" =~ ^[0-9]+$ ]]; then
  # Integer: 8 → 08
  printf -v PHASE "%02d" "$PHASE"
elif [[ "$PHASE" =~ ^([0-9]+)\.([0-9]+)$ ]]; then
  # Decimal: 2.1 → 02.1
  printf -v PHASE "%02d.%s" "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}"
fi
```

## Validation

Use `roadmap get-phase` to validate phase exists:

```bash
node ./.claude/gsd-ng/bin/gsd-tools.cjs roadmap get-phase "${PHASE}" --pick found > $TMPDIR/phase-arg-roadmap-found.txt
read PHASE_FOUND < $TMPDIR/phase-arg-roadmap-found.txt
if [ "$PHASE_FOUND" = "false" ]; then
  echo "ERROR: Phase ${PHASE} not found in roadmap"
  exit 1
fi
```

## Directory Lookup

Use `find-phase` for a quick directory-only lookup (default scalar output):

```bash
node ./.claude/gsd-ng/bin/gsd-tools.cjs find-phase "${PHASE}" > $TMPDIR/phase-arg-dir-only.txt
read PHASE_DIR < $TMPDIR/phase-arg-dir-only.txt
```
