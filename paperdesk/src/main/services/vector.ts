// 向量工具：Float32 向量与 SQLite BLOB 互转 + 相似度（embedding 已归一化，点积即余弦）。

export function serializeVector(v: Float32Array): Buffer {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength)
}

export function deserializeVector(buf: Buffer): Float32Array {
  // 复制成对齐到 0 的 ArrayBuffer，避免 Buffer 池化导致的非 4 字节对齐
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  return new Float32Array(ab)
}

export function dot(a: Float32Array, b: Float32Array): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

export interface VecCandidate { id: number; vec: Float32Array }

// 按点积（=归一化向量的余弦相似度）降序取 top-k
export function topKByDot(query: Float32Array, candidates: VecCandidate[], k: number): Array<{ id: number; score: number }> {
  return candidates
    .map(c => ({ id: c.id, score: dot(query, c.vec) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
}
