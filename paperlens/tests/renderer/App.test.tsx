import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
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
})
