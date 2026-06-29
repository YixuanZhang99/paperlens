import { describe, it, expect } from 'vitest'
import { serializeVector, deserializeVector, dot, topKByDot } from '../../src/main/services/vector'

describe('vector serialize/deserialize', () => {
  it('round-trips a Float32Array through a Buffer losslessly', () => {
    const v = new Float32Array([0.5, -0.25, 1, 0])
    const buf = serializeVector(v)
    expect(Buffer.isBuffer(buf)).toBe(true)
    expect(buf.length).toBe(16) // 4 floats × 4 bytes
    const back = deserializeVector(buf)
    expect(Array.from(back)).toEqual([0.5, -0.25, 1, 0])
  })
})

describe('dot', () => {
  it('computes the dot product (= cosine for unit vectors)', () => {
    expect(dot(new Float32Array([1, 0]), new Float32Array([1, 0]))).toBeCloseTo(1)
    expect(dot(new Float32Array([1, 0]), new Float32Array([0, 1]))).toBeCloseTo(0)
    expect(dot(new Float32Array([1, 0]), new Float32Array([-1, 0]))).toBeCloseTo(-1)
  })
})

describe('topKByDot', () => {
  const q = new Float32Array([1, 0])
  const cands = [
    { id: 1, vec: new Float32Array([1, 0]) },     // 最相关 dot=1
    { id: 2, vec: new Float32Array([0.6, 0.8]) }, // dot=0.6
    { id: 3, vec: new Float32Array([0, 1]) },     // dot=0
    { id: 4, vec: new Float32Array([-1, 0]) },    // dot=-1
  ]
  it('returns top-k ids by descending dot, with scores', () => {
    const out = topKByDot(q, cands, 2)
    expect(out.map(h => h.id)).toEqual([1, 2])
    expect(out[0].score).toBeCloseTo(1)
    expect(out[1].score).toBeCloseTo(0.6)
  })
  it('k larger than candidates returns all sorted', () => {
    expect(topKByDot(q, cands, 99).map(h => h.id)).toEqual([1, 2, 3, 4])
  })
  it('empty candidates → []', () => {
    expect(topKByDot(q, [], 5)).toEqual([])
  })
})
