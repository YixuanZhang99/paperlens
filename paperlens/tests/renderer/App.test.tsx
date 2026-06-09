import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { App } from '../../src/renderer/App'

beforeEach(() => {
  ;(window as any).api = {
    listPapers: vi.fn(async () => []),
    getConfig: vi.fn(async () => ({ zoteroApiKey: '', zoteroUserId: '', deepseekApiKey: '', deepseekModel: 'deepseek-chat', notionToken: '', notionDatabaseId: '' })),
  }
})

describe('App', () => {
  it('renders the three-pane layout with library, reader, chat regions', async () => {
    render(<App />)
    expect(await screen.findByRole('navigation', { name: /论文库/ })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: /阅读/ })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: /对话/ })).toBeInTheDocument()
  })

  it('opens the settings dialog and closes it with Escape', async () => {
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /设置/ }))
    expect(await screen.findByRole('dialog', { name: /设置/ })).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('closes settings on backdrop click but not when clicking inside the panel', async () => {
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /设置/ }))
    const dialog = await screen.findByRole('dialog')
    const heading = await screen.findByRole('heading', { name: '设置' })
    fireEvent.click(heading) // inside the panel → stays open
    expect(screen.queryByRole('dialog')).toBeInTheDocument()
    fireEvent.click(dialog.parentElement!) // the backdrop → closes
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})
