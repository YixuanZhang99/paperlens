import { describe, it, expect } from 'vitest'
import { domRectToPdfRect, pdfRectToBox, isMeaningfulRect, type Rect4 } from '../../src/renderer/lib/pdf-highlight'

// 模拟 pdf.js viewport：scale=2、页高(viewport)=800。
// convertToPdfPoint: 视口(x,y) → PDF(x/scale, (H - y)/scale)  —— y 轴翻转
const SCALE = 2
const VH = 800
const convertToPdfPoint = (x: number, y: number) => [x / SCALE, (VH - y) / SCALE]
// convertToViewportRectangle: PDF[x1,y1,x2,y2] → 视口[x1*s, H - y1*s, x2*s, H - y2*s]
const convertToViewportRectangle = (r: Rect4) => [r[0] * SCALE, VH - r[1] * SCALE, r[2] * SCALE, VH - r[3] * SCALE]

describe('domRectToPdfRect', () => {
  it('converts a viewport rect to a normalised PDF rect (y flips, x1<x2, y1<y2)', () => {
    // 视口矩形：left=100 top=200 right=300 bottom=240
    const pdf = domRectToPdfRect({ left: 100, top: 200, right: 300, bottom: 240 }, convertToPdfPoint)
    // x: 100/2..300/2 = 50..150 ; y: (800-240)/2=280 .. (800-200)/2=300
    expect(pdf).toEqual([50, 280, 150, 300])
  })
})

describe('pdfRectToBox', () => {
  it('converts a PDF rect back to a positive-size viewport box', () => {
    const box = pdfRectToBox([50, 280, 150, 300], convertToViewportRectangle)
    // 视口: x 100..300 ; y: 800-560=240 .. 800-600=200 → top=200 height=40
    expect(box).toEqual({ left: 100, top: 200, width: 200, height: 40 })
  })

  it('round-trips dom → pdf → box back to the original viewport rect', () => {
    const orig = { left: 100, top: 200, right: 300, bottom: 240 }
    const box = pdfRectToBox(domRectToPdfRect(orig, convertToPdfPoint), convertToViewportRectangle)
    expect(box).toEqual({ left: 100, top: 200, width: 200, height: 40 })
  })
})

describe('isMeaningfulRect', () => {
  it('keeps normal rects and drops tiny slivers', () => {
    expect(isMeaningfulRect({ width: 200, height: 14 })).toBe(true)
    expect(isMeaningfulRect({ width: 1, height: 14 })).toBe(false)
    expect(isMeaningfulRect({ width: 200, height: 0 })).toBe(false)
  })
})
