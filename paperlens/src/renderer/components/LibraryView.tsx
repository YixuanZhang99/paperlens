import type { Paper } from '@shared/types'

export function LibraryView({ onSelect, selectedKey }: { onSelect: (p: Paper) => void; selectedKey: string | null }) {
  void onSelect; void selectedKey
  return <div>论文库</div>
}
