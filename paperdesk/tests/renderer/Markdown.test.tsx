import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Markdown } from '../../src/renderer/components/Markdown'

describe('Markdown page citations', () => {
  it('renders [页N] as a clickable chip and fires onPageJump', () => {
    const onPageJump = vi.fn()
    render(<Markdown onPageJump={onPageJump}>{'结论很重要 [页3]。'}</Markdown>)
    const btn = screen.getByRole('button', { name: '[页3]' })
    fireEvent.click(btn)
    expect(onPageJump).toHaveBeenCalledWith(3, undefined)
  })
  it('leaves [页N] as plain text when onPageJump is absent', () => {
    render(<Markdown>{'结论 [页3]。'}</Markdown>)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByText(/\[页3\]/)).toBeInTheDocument()
  })
  it('renders [页N:"quote"] chip as [页N] and fires onPageJump with the quote', () => {
    const onPageJump = vi.fn()
    render(<Markdown onPageJump={onPageJump}>{'详见 [页3:"自注意力机制"]。'}</Markdown>)
    const btn = screen.getByRole('button', { name: '[页3]' })
    fireEvent.click(btn)
    expect(onPageJump).toHaveBeenCalledWith(3, '自注意力机制')
  })
  it('old-format [页N] fires onPageJump with undefined quote', () => {
    const onPageJump = vi.fn()
    render(<Markdown onPageJump={onPageJump}>{'见 [页2]。'}</Markdown>)
    fireEvent.click(screen.getByRole('button', { name: '[页2]' }))
    expect(onPageJump).toHaveBeenCalledWith(2, undefined)
  })
})
