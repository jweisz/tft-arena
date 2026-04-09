import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { MentionInput } from './MentionInput'

describe('MentionInput', () => {
  it('inserts an agent mention when selecting from popup with mouse', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [
        { id: 1, name: 'Contrarian Futurist', role_description: 'Desc', is_active: true },
        { id: 2, name: 'Devil\'s Advocate', role_description: 'Desc', is_active: true },
      ],
      headers: new Headers({ 'content-type': 'application/json' }),
      status: 200,
    } as Response)

    render(<MentionInput roomId={123} onSend={vi.fn()} />)

    const editor = document.querySelector('[contenteditable="true"]') as HTMLDivElement | null
    expect(editor).not.toBeNull()
    if (!editor) {
      fetchMock.mockRestore()
      throw new Error('editor missing')
    }

    editor.textContent = '@Con'
    const textNode = editor.firstChild
    expect(textNode).not.toBeNull()
    if (!textNode) {
      fetchMock.mockRestore()
      throw new Error('editor text node missing')
    }

    const range = document.createRange()
    range.setStart(textNode, '@Con'.length)
    range.collapse(true)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)

    fireEvent.input(editor)

    const option = await screen.findByText('Contrarian Futurist')

    // Simulate selection loss that happens when clicking outside the editor.
    selection?.removeAllRanges()
    fireEvent.mouseDown(option)

    await waitFor(() => {
      const slug = editor.querySelector('.mention-slug') as HTMLSpanElement | null
      expect(slug).not.toBeNull()
      expect(slug?.dataset.agent).toBe('Contrarian Futurist')
      expect(slug?.innerText).toBe('@Contrarian Futurist')
      expect(screen.queryByText('Contrarian Futurist')).not.toBeInTheDocument()
    })

    fetchMock.mockRestore()
  })

  it('closes the mention popup when Escape is pressed', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [
        { id: 1, name: 'Contrarian Futurist', role_description: 'Desc', is_active: true },
      ],
      headers: new Headers({ 'content-type': 'application/json' }),
      status: 200,
    } as Response)

    render(<MentionInput roomId={123} onSend={vi.fn()} />)

    const editor = document.querySelector('[contenteditable="true"]') as HTMLDivElement | null
    expect(editor).not.toBeNull()
    if (!editor) {
      fetchMock.mockRestore()
      throw new Error('editor missing')
    }

    editor.textContent = '@Con'
    const textNode = editor.firstChild
    expect(textNode).not.toBeNull()
    if (!textNode) {
      fetchMock.mockRestore()
      throw new Error('editor text node missing')
    }

    const range = document.createRange()
    range.setStart(textNode, '@Con'.length)
    range.collapse(true)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)

    fireEvent.input(editor)
    expect(await screen.findByText('Contrarian Futurist')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })

    await waitFor(() => {
      expect(screen.queryByText('Contrarian Futurist')).not.toBeInTheDocument()
    })

    fetchMock.mockRestore()
  })

  it('serializes mentions with apostrophe-stripped slugs when sending', async () => {
    const onSend = vi.fn()
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [
        { id: 1, name: "Devil's Advocate", role_description: 'Desc', is_active: true },
      ],
      headers: new Headers({ 'content-type': 'application/json' }),
      status: 200,
    } as Response)

    render(<MentionInput roomId={123} onSend={onSend} />)

    const editor = document.querySelector('[contenteditable="true"]') as HTMLDivElement | null
    expect(editor).not.toBeNull()
    if (!editor) {
      fetchMock.mockRestore()
      throw new Error('editor missing')
    }

    editor.textContent = '@Dev'
    const textNode = editor.firstChild
    expect(textNode).not.toBeNull()
    if (!textNode) {
      fetchMock.mockRestore()
      throw new Error('editor text node missing')
    }

    const range = document.createRange()
    range.setStart(textNode, '@Dev'.length)
    range.collapse(true)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)

    fireEvent.input(editor)

    const option = await screen.findByText("Devil's Advocate")
    selection?.removeAllRanges()
    fireEvent.mouseDown(option)

    editor.appendChild(document.createTextNode('hello'))
    fireEvent.keyDown(editor, { key: 'Enter' })

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith('@devils_advocate hello', ["Devil's Advocate"])
    })

    fetchMock.mockRestore()
  })
})
