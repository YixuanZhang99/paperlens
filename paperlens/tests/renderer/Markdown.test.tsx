import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Markdown } from '../../src/renderer/components/Markdown'

describe('Markdown page citations', () => {
  it('renders [页N] as a clickable chip and fires onPageJump', () => {
    const onPageJump = vi.fn()
    render(<Markdown onPageJump={onPageJump}>{'结论很重要 [页3]。'}</Markdown>)
    const btn = screen.getByRole('button', { name: '[页3]' })
    fireEvent.click(btn)
    expect(onPageJump).toHaveBeenCalledWith(3)
  })
  it('leaves [页N] as plain text when onPageJump is absent', () => {
    render(<Markdown>{'结论 [页3]。'}</Markdown>)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByText(/\[页3\]/)).toBeInTheDocument()
  })
})
