'use strict';

// Pattern-G escape-hatch helpers for discuss-phase.md.
// Each subcommand reads a file and emits its result to stdout.
//
// Subcommands:
//   extract-requirements <json-file>   read `roadmap get-phase --json` output,
//                                      regex-extract the Requirements line from
//                                      the freeform `section` body and emit the
//                                      requirement IDs (or empty string).
//
//   extract-parents <text-file>        read freeform "Depends on:" text and emit
//                                      one parent phase number per line (e.g.
//                                      "Phase 12" → "12"). // hygiene-allow: phase-ref (illustrative example of input format)
//
// See Plan 08 catalog for the broader Pattern-G rationale: these manipulations
// are too narrow / domain-specific to warrant a top-level gsd-tools subcommand,
// but their `node -e` form denied the bash-safety hook (single-quoted braces
// inside JSON parse / regex bodies).

const fs = require('fs');

function extractRequirements(jsonPath) {
  let text;
  try {
    const raw = fs.readFileSync(jsonPath, 'utf-8');
    const obj = JSON.parse(raw);
    text = obj && typeof obj.section === 'string' ? obj.section : '';
  } catch {
    text = '';
  }
  const m = text.match(/\*\*Requirements\*\*:\s*([^\n]+)/i);
  if (!m) {
    process.stdout.write('');
    return;
  }
  const trimmed = m[1]
    .trim()
    .replace(/^\[(.*)\]$/, '$1')
    .trim();
  process.stdout.write(trimmed);
}

function extractParents(textPath) {
  let body;
  try {
    body = fs.readFileSync(textPath, 'utf-8');
  } catch {
    body = '';
  }
  const matches = [...body.matchAll(/Phase\s+(\d+[A-Z]?(?:\.\d+)*)/gi)];
  const ids = matches.map((mm) => mm[1]);
  process.stdout.write(ids.join('\n'));
  if (ids.length > 0) process.stdout.write('\n');
}

function main(argv) {
  const sub = argv[2];
  if (!sub) {
    process.stderr.write(
      'Usage: discuss-phase-helpers.cjs <extract-requirements|extract-parents> <input-file>\n',
    );
    process.exit(2);
  }
  const inputFile = argv[3];
  if (!inputFile) {
    process.stderr.write(
      `Usage: discuss-phase-helpers.cjs ${sub} <input-file>\n`,
    );
    process.exit(2);
  }
  if (sub === 'extract-requirements') {
    extractRequirements(inputFile);
    return;
  }
  if (sub === 'extract-parents') {
    extractParents(inputFile);
    return;
  }
  process.stderr.write(`Unknown subcommand: ${sub}\n`);
  process.exit(2);
}

main(process.argv);
