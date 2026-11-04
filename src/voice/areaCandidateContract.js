/** Shared producer/consumer contract for `resolve_area.candidateId`. */

/** Room for every currently emitted bundled candidate (observed maximum: 45). */
export const MAX_AREA_CANDIDATE_ID_LENGTH = 80;

// Tool-schema patterns have no Unicode flag, and the Realtime validator rejects
// Unicode property escapes. Accept slug characters without ASCII punctuation;
// isAreaCandidateId below still enforces letters/marks/numbers at execution.
const SCHEMA_SLUG_PART = '(?:[A-Za-z0-9]|[^\\x00-\\x7f\\s])+';

/** Portable wire grammar that also admits non-Latin bundled candidate handles. */
export const AREA_CANDIDATE_ID_PATTERN = `^ne:(?:country|state|county|natural):${SCHEMA_SLUG_PART}(?:-${SCHEMA_SLUG_PART})*$`;

const AREA_CANDIDATE_ID_RE =
  /^ne:(?:country|state|county|natural):[\p{L}\p{M}\p{N}]+(?:-[\p{L}\p{M}\p{N}]+)*$/u;

export function isAreaCandidateId(value) {
  const candidateId = String(value || '');
  return (
    candidateId.length > 0 &&
    candidateId.length <= MAX_AREA_CANDIDATE_ID_LENGTH &&
    AREA_CANDIDATE_ID_RE.test(candidateId)
  );
}
