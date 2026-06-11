import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ReactNode } from 'react'

// Matches [页N] or [页N:"quote"] — quote group (m[2]) is optional.
const PAGE_RE = /\[页(\d+)(?::"([^"]{1,80})")?\]/g

// 把文本里的 [页N] / [页N:"quote"] 替换成可点 chip，递归处理 react-markdown 传入的 children（字符串/数组）
// chip 文案统一显示 [页N]，引文通过回调透传给 onPageJump
function linkifyPages(children: ReactNode, onPageJump: (p: number, quote?: string) => void): ReactNode {
  if (typeof children === 'string') {
    const parts: ReactNode[] = []
    let last = 0
    let m: RegExpExecArray | null
    PAGE_RE.lastIndex = 0
    while ((m = PAGE_RE.exec(children)) !== null) {
      if (m.index > last) parts.push(children.slice(last, m.index))
      const page = Number(m[1])
      const quote = m[2] as string | undefined
      parts.push(
        <button key={`${m.index}-${page}`} className="page-cite" onClick={() => onPageJump(page, quote)}>[页{page}]</button>
      )
      last = m.index + m[0].length
    }
    if (parts.length === 0) return children
    if (last < children.length) parts.push(children.slice(last))
    return parts
  }
  if (Array.isArray(children)) return children.map((c, i) => <span key={i}>{linkifyPages(c, onPageJump)}</span>)
  return children
}

// AI 输出统一经此渲染（react-markdown 默认不注入原始 HTML，安全）。
// 传入 onPageJump 时，文本中的 [页N] / [页N:"quote"] 渲染成可点 chip；不传则行为与纯文本渲染完全一致。
export function Markdown({ children, onPageJump }: { children: string; onPageJump?: (page: number, quote?: string) => void }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const components = onPageJump
    ? {
        p: ({ children }: any) => <p>{linkifyPages(children, onPageJump)}</p>,
        li: ({ children }: any) => <li>{linkifyPages(children, onPageJump)}</li>,
      }
    : undefined
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{children}</ReactMarkdown>
    </div>
  )
}
