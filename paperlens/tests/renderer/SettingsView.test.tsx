import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SettingsView } from '../../src/renderer/components/SettingsView'

const empty = { zoteroApiKey: '', zoteroUserId: '', zoteroDataDir: '', deepseekApiKey: '', deepseekModel: 'deepseek-chat', notionToken: '', notionDatabaseId: '' }

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

  it('shows an error and stays open when saving fails', async () => {
    const onClose = vi.fn()
    ;(window as any).api = {
      getConfig: vi.fn(async () => empty),
      setConfig: vi.fn(async () => { throw new Error('disk full') }),
    }
    render(<SettingsView onClose={onClose} />)
    fireEvent.click(await screen.findByRole('button', { name: /保存/ }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/失败/))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('shows and edits the Zotero data directory field', async () => {
    const setConfig = vi.fn(async (p: any) => ({ ...empty, ...p }))
    ;(window as any).api = { getConfig: vi.fn(async () => empty), setConfig }
    render(<SettingsView onClose={vi.fn()} />)
    fireEvent.change(await screen.findByLabelText(/Zotero 数据目录/), { target: { value: '/Users/me/Zotero' } })
    fireEvent.click(screen.getByRole('button', { name: /保存/ }))
    await waitFor(() => expect(setConfig).toHaveBeenCalledWith(
      expect.objectContaining({ zoteroDataDir: '/Users/me/Zotero' })
    ))
  })
})
