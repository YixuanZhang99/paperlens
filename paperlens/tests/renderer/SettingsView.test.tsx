import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SettingsView } from '../../src/renderer/components/SettingsView'

const empty = { zoteroApiKey: '', zoteroUserId: '', deepseekApiKey: '', deepseekModel: 'deepseek-chat', notionToken: '', notionDatabaseId: '' }

describe('SettingsView', () => {
  it('loads existing config and saves edits', async () => {
    const setConfig = vi.fn(async (p: any) => ({ ...empty, ...p }))
    ;(window as any).api = { getConfig: vi.fn(async () => empty), setConfig }
    render(<SettingsView onClose={vi.fn()} />)

    fireEvent.change(await screen.findByLabelText(/Zotero User ID/), { target: { value: '42' } })
    fireEvent.change(screen.getByLabelText(/Zotero API Key/), { target: { value: 'zk' } })
    fireEvent.click(screen.getByRole('button', { name: /保存/ }))

    await waitFor(() => expect(setConfig).toHaveBeenCalledWith(
      expect.objectContaining({ zoteroUserId: '42', zoteroApiKey: 'zk' })
    ))
  })
})
