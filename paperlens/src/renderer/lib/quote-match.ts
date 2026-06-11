/**
 * findQuoteRange — locate a quote string inside an array of span texts.
 *
 * Normalisation: lower-case + strip all whitespace.
 * Returns the closed [start, end] index range of spans that cover the quote,
 * or null if the quote is not found or is too short (< 4 chars after normalisation).
 */
export function findQuoteRange(
  spanTexts: string[],
  quote: string,
): { start: number; end: number } | null {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '')

  const normQuote = norm(quote)
  if (normQuote.length < 4) return null

  // Build the concatenated normalised full text and record per-span offsets.
  const offsets: Array<{ start: number; end: number }> = []
  let fullText = ''
  for (const text of spanTexts) {
    const n = norm(text)
    offsets.push({ start: fullText.length, end: fullText.length + n.length })
    fullText += n
  }

  const idx = fullText.indexOf(normQuote)
  if (idx === -1) return null

  const matchEnd = idx + normQuote.length - 1

  // Map character offsets back to span indices.
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
