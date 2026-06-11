/**
 * Span-aware text matching for the PDF text layer.
 *
 * pdf.js splits a page's text into many small spans (often mid-word), so naive
 * per-span substring search misses anything that straddles a span boundary.
 * These helpers concatenate the spans into one normalised string, search that,
 * then map character offsets back to the span indices they cover.
 *
 * Normalisation: lower-case + strip all whitespace (so "Foo Bar" matches a
 * "foobar" that pdf.js emitted as two adjacent spans without a space).
 */

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, '')

/** Concatenate normalised span texts, recording each span's [start, end) offset. */
function buildIndex(spanTexts: string[]): { offsets: Array<{ start: number; end: number }>; fullText: string } {
  const offsets: Array<{ start: number; end: number }> = []
  let fullText = ''
  for (const text of spanTexts) {
    const n = norm(text)
    offsets.push({ start: fullText.length, end: fullText.length + n.length })
    fullText += n
  }
  return { offsets, fullText }
}

/** Map a [idx, matchEnd] char range in the concatenated text to a closed span-index range. */
function mapRange(
  offsets: Array<{ start: number; end: number }>,
  idx: number,
  matchEnd: number,
): { start: number; end: number } | null {
  let startSpan = -1
  let endSpan = -1
  for (let i = 0; i < offsets.length; i++) {
    const { start, end } = offsets[i]
    if (startSpan === -1 && end > idx) startSpan = i
    if (start <= matchEnd) endSpan = i
  }
  if (startSpan === -1 || endSpan === -1) return null
  return { start: startSpan, end: endSpan }
}

/**
 * findQuoteRange — locate the FIRST occurrence of a quote inside span texts.
 * Returns the closed [start, end] span-index range, or null if not found or the
 * quote normalises to < 4 chars (used by citation sentence-flash).
 */
export function findQuoteRange(
  spanTexts: string[],
  quote: string,
): { start: number; end: number } | null {
  const normQuote = norm(quote)
  if (normQuote.length < 4) return null
  const { offsets, fullText } = buildIndex(spanTexts)
  const idx = fullText.indexOf(normQuote)
  if (idx === -1) return null
  return mapRange(offsets, idx, idx + normQuote.length - 1)
}

/**
 * findAllMatchRanges — locate EVERY (non-overlapping) occurrence of a query
 * inside span texts, for the in-PDF search box. Each result is the closed
 * [start, end] span-index range the match covers (cross-span aware). Returns []
 * if the query normalises to fewer than `minLen` chars (default 2).
 */
export function findAllMatchRanges(
  spanTexts: string[],
  query: string,
  minLen = 2,
): Array<{ start: number; end: number }> {
  const normQuery = norm(query)
  if (normQuery.length < minLen) return []
  const { offsets, fullText } = buildIndex(spanTexts)
  const ranges: Array<{ start: number; end: number }> = []
  let from = 0
  for (;;) {
    const idx = fullText.indexOf(normQuery, from)
    if (idx === -1) break
    const r = mapRange(offsets, idx, idx + normQuery.length - 1)
    if (r) ranges.push(r)
    from = idx + normQuery.length // non-overlapping: advance past this match
  }
  return ranges
}
