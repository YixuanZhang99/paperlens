import type { Paper } from '@shared/types'

export function ChatView({ paper }: { paper: Paper | null }) {
  void paper
  return <div>对话</div>
}
