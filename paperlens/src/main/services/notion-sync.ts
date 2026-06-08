import type { Note, Paper } from '@shared/types'

const txt = (content: string) => [{ text: { content } }]

export function noteToNotionPage(note: Note, paper: Paper, databaseId: string) {
  const properties: Record<string, any> = {
    Title: { title: txt(paper.title) },
    Authors: { rich_text: txt(paper.authors.join(', ')) },
    Tags: { multi_select: note.tags.map(name => ({ name })) },
  }
  if (paper.year !== null) properties.Year = { number: paper.year }

  return {
    parent: { database_id: databaseId },
    properties,
    children: [
      { object: 'block', type: 'paragraph', paragraph: { rich_text: txt(note.content) } },
    ],
  }
}
