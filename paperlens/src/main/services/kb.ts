// 论文全文切块：固定窗口 + 重叠，保证检索段落上下文完整
export function chunkText(text: string, size = 1200, overlap = 150): string[] {
  const t = text.trim()
  if (!t) return []
  const step = Math.max(1, size - overlap)
  const out: string[] = []
  for (let i = 0; i < t.length; i += step) {
    out.push(t.slice(i, i + size))
    if (i + size >= t.length) break
  }
  return out
}
