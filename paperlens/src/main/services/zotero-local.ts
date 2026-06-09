export interface ZoteroLocalDeps {
  dataDir: string
  exists: (p: string) => boolean
  readFile: (p: string) => Uint8Array
  readdir: (p: string) => string[]
  join: (...parts: string[]) => string
}

export function createZoteroLocal(deps: ZoteroLocalDeps) {
  function storageDir(attachmentKey: string): string {
    return deps.join(deps.dataDir, 'storage', attachmentKey)
  }

  // Reads <dataDir>/storage/<attachmentKey>/<filename>; if the exact filename is
  // absent, falls back to the first .pdf in that folder. Returns null if the
  // folder or any pdf is missing.
  function readPdf(attachmentKey: string, filename?: string | null): Uint8Array | null {
    const dir = storageDir(attachmentKey)
    if (!deps.exists(dir)) return null
    if (filename) {
      const exact = deps.join(dir, filename)
      if (deps.exists(exact)) return deps.readFile(exact)
    }
    const pdf = deps.readdir(dir).find(f => f.toLowerCase().endsWith('.pdf'))
    return pdf ? deps.readFile(deps.join(dir, pdf)) : null
  }

  return { storageDir, readPdf }
}
