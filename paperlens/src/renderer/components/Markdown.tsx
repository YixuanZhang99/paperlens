import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

// AI 输出统一经此渲染（react-markdown 默认不注入原始 HTML，安全）
export function Markdown({ children }: { children: string }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  )
}
