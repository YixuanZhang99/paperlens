import type { Highlight } from '@shared/types'

/**
 * Zotero PDF annotation helpers.
 *
 * Zotero 6+ 把 PDF 高亮/笔记存为 itemType='annotation' 的子条目（parentItem = PDF 附件）。
 * 本模块把 PaperDesk 的 Highlight 映射成 Zotero Web API 创建条目所需的 JSON。
 * 参考字段：annotationType / annotationText / annotationComment / annotationColor /
 * annotationPageLabel / annotationSortIndex / annotationPosition。
 */

export interface ZoteroAnnotationItem {
  itemType: 'annotation'
  parentItem: string
  annotationType: 'highlight'
  annotationText: string
  annotationComment: string
  annotationColor: string
  annotationPageLabel: string
  annotationSortIndex: string
  annotationPosition: string // JSON: { pageIndex, rects }
}

/**
 * sortIndex 决定标注在 Zotero 侧栏的排序，格式 "{页:5}|{字符偏移:6}|{距页顶:5}"。
 * 我们没有精确字符偏移，用 0；距页顶用 round(页高 - 矩形顶部 y)。
 */
export function buildAnnotationSortIndex(pageIndex: number, topFromPageTop: number): string {
  const pi = String(Math.max(0, Math.round(pageIndex))).padStart(5, '0')
  const off = '000000'
  const tp = String(Math.max(0, Math.round(topFromPageTop))).padStart(5, '0')
  return `${pi}|${off}|${tp}`
}

/**
 * 把一条 Highlight 映射成 Zotero annotation 条目。
 * @param pageHeightPt 该页 PDF 高度（pt），用于把「左下原点的 y」换算成「距页顶」做 sortIndex。
 */
export function buildAnnotationPayload(
  hl: Pick<Highlight, 'pageIndex' | 'rects' | 'text' | 'color' | 'comment'>,
  attachmentKey: string,
  pageHeightPt: number,
): ZoteroAnnotationItem {
  const ys = hl.rects.flatMap(r => [r[1], r[3]])
  const topY = ys.length ? Math.max(...ys) : 0 // PDF 中 y 越大越靠上
  const topFromPageTop = pageHeightPt > 0 ? pageHeightPt - topY : 0
  return {
    itemType: 'annotation',
    parentItem: attachmentKey,
    annotationType: 'highlight',
    annotationText: hl.text,
    annotationComment: hl.comment ?? '',
    annotationColor: hl.color,
    annotationPageLabel: String(hl.pageIndex + 1),
    annotationSortIndex: buildAnnotationSortIndex(hl.pageIndex, topFromPageTop),
    annotationPosition: JSON.stringify({ pageIndex: hl.pageIndex, rects: hl.rects }),
  }
}
