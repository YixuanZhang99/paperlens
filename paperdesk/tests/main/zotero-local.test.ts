import { describe, it, expect } from 'vitest'
import { createZoteroLocal } from '../../src/main/services/zotero-local'

// in-memory fake fs keyed by '/'-joined paths
function localFs(files: Record<string, Uint8Array>) {
  const allPaths = Object.keys(files)
  const dirs = new Set<string>()
  for (const p of allPaths) {
    const parts = p.split('/')
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'))
  }
  return {
    dataDir: '/data',
    join: (...parts: string[]) => parts.join('/'),
    exists: (p: string) => p in files || dirs.has(p),
    readFile: (p: string) => { const b = files[p]; if (!b) throw new Error('ENOENT ' + p); return b },
    readdir: (p: string) => allPaths.filter(f => f.startsWith(p + '/')).map(f => f.slice(p.length + 1).split('/')[0]),
  }
}
const bytes = (s: string) => new TextEncoder().encode(s)
const dec = (u: Uint8Array | null) => (u ? new TextDecoder().decode(u) : null)

describe('createZoteroLocal.readPdf', () => {
  it('reads the exact filename under storage/<key>/', () => {
    const local = createZoteroLocal(localFs({ '/data/storage/ABC123/paper.pdf': bytes('%PDF-A') }))
    expect(dec(local.readPdf('ABC123', 'paper.pdf'))).toBe('%PDF-A')
  })

  it('falls back to the first .pdf when the filename mismatches', () => {
    const local = createZoteroLocal(localFs({
      '/data/storage/K9/Actual Paper.pdf': bytes('%PDF-B'),
      '/data/storage/K9/.zotero-ft-cache': bytes('junk'),
    }))
    expect(dec(local.readPdf('K9', 'wrong-name.pdf'))).toBe('%PDF-B')
  })

  it('returns null when the storage folder does not exist', () => {
    const local = createZoteroLocal(localFs({ '/data/storage/OTHER/x.pdf': bytes('x') }))
    expect(local.readPdf('MISSING', 'x.pdf')).toBeNull()
  })

  it('returns null when the folder exists but contains no pdf', () => {
    const local = createZoteroLocal(localFs({ '/data/storage/K2/.zotero-ft-cache': bytes('junk') }))
    expect(local.readPdf('K2', undefined)).toBeNull()
  })
})
