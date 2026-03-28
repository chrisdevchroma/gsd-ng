# Phase 3: Bug Fix - Context

**Status:** Ready for planning

## Problem

`parseConfig` in `src/utils.js` crashes with `SyntaxError: Unexpected end of JSON input` when called with an empty string, null, or malformed JSON. This was discovered during Phase 2 testing.

## Decisions

- Fix must handle: empty string, null, undefined, malformed JSON, and valid JSON
- Return a default config object `{ widgets: [] }` for all error cases
- Add test cases for each error input type
