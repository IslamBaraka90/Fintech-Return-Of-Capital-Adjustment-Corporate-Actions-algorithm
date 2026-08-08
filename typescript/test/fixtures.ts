/** Shared fixture access. The same JSON backs the Python suite. */

import { createRequire } from "node:module";

import { type ReturnOfCapitalResult, calculate } from "../src/core.ts";

const require = createRequire(import.meta.url);
const FIXTURE = require("./fixtures/fixtures.json") as {
  topicId: string;
  caseLabel: string;
  input: Record<string, any>;
  expected: ReturnOfCapitalResult;
};

export const TOPIC_ID = FIXTURE.topicId;
export const CASE_LABEL = FIXTURE.caseLabel;
export const INPUT = FIXTURE.input;
export const EXPECTED = FIXTURE.expected;

/** The fixture's single announcement revision. */
export const R1 = (INPUT.revisions as Array<Record<string, any>>)[0]!;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export const payload = (overrides: Record<string, unknown> = {}): Record<string, any> => ({
  ...clone(INPUT),
  ...overrides,
});

export const run = (overrides: Record<string, unknown> = {}): ReturnOfCapitalResult =>
  calculate(payload(overrides));

export const revision = (
  overrides: Record<string, unknown> = {},
): Record<string, any> => ({ ...clone(R1), ...overrides });

/** The fixture with the revision's terms patched. */
export const withTerms = (
  termOverrides: Record<string, unknown> = {},
): Record<string, any> => {
  const row = clone(R1);
  row.terms = { ...row.terms, ...termOverrides };
  return { ...clone(INPUT), revisions: [row] };
};

export const runTerms = (
  termOverrides: Record<string, unknown> = {},
): ReturnOfCapitalResult => calculate(withTerms(termOverrides));

/** One of the fixture's top-level observation blocks, patched. */
export const section = (
  name: string,
  overrides: Record<string, unknown> = {},
): Record<string, any> => ({ ...clone(INPUT[name]), ...overrides });
