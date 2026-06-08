import type { Paper } from '@shared/types'

export function ReaderView({ paper }: { paper: Paper | null }) {
  void paper
  return <div>阅读</div>
}
