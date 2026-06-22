/**
 * PDF 高亮坐标转换。
 *
 * 选区在屏幕上是「viewport 坐标」（CSS px，原点页面左上，随缩放变化）；
 * 存储用「PDF 坐标」（pt，原点页面左下，与缩放无关），这样换倍率/重开都能对位。
 * 转换交给 pdf.js viewport 的 convertToPdfPoint / convertToViewportRectangle，
 * 这里只做「取两角 + 归一化成 [x1,y1,x2,y2] / {left,top,width,height}」的纯逻辑，便于测试。
 */

export type Rect4 = [number, number, number, number]

/** 把页面内的一个 DOM 矩形（viewport 坐标）转成归一化的 PDF 矩形。 */
export function domRectToPdfRect(
  rel: { left: number; top: number; right: number; bottom: number },
  convertToPdfPoint: (x: number, y: number) => number[],
): Rect4 {
  const [ax, ay] = convertToPdfPoint(rel.left, rel.top)
  const [bx, by] = convertToPdfPoint(rel.right, rel.bottom)
  return [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)]
}

/** 把 PDF 矩形转成页面内叠加层用的盒子（viewport 坐标，已归一化为正的宽高）。 */
export function pdfRectToBox(
  rect: Rect4,
  convertToViewportRectangle: (r: Rect4) => number[],
): { left: number; top: number; width: number; height: number } {
  const [x1, y1, x2, y2] = convertToViewportRectangle(rect)
  return {
    left: Math.min(x1, x2),
    top: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  }
}

/** 过滤掉过小的矩形（选区里的零宽换行碎块），避免存一堆无意义高亮条。 */
export function isMeaningfulRect(r: { width: number; height: number }, minW = 4, minH = 3): boolean {
  return r.width >= minW && r.height >= minH
}
