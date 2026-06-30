// 本地语义嵌入服务（multilingual-e5-small，384 维，量化）。
// 推理在 utilityProcess 子进程跑：onnxruntime-node 在 Electron 主进程连续推理会 SIGTRAP，
// 隔离到子进程后稳定，且崩溃不影响主窗口。模型经 hf-mirror 下到 userData/models（HF 直连国内不通）。
import { utilityProcess, type UtilityProcess } from 'electron'

export const EMBED_MODEL = 'Xenova/multilingual-e5-small'
export const EMBED_DIM = 384
const MIRROR = 'https://hf-mirror.com'

export interface Embedder {
  embedQuery(text: string): Promise<Float32Array>
  embedPassages(texts: string[]): Promise<Float32Array[]>
  warmup(): Promise<void>
}

const asQuery = (t: string) => `query: ${t}`
const asPassage = (t: string) => `passage: ${t}`

type Pending = { resolve: (v: Float32Array[]) => void; reject: (e: Error) => void }

// onnxruntime-node 在 Electron 的 Node 运行时连续推理约十几次后会 SIGTRAP（纯 Node 无此问题）。
// 在触发前主动回收 worker（重启，模型已缓存重载仅 ~1s），从根上避开崩溃；崩溃恢复作为兜底。
const RECYCLE_AFTER_TEXTS = 256
// 单次请求超时兜底：worker 静默卡死（首次下载半开 TCP / onnxruntime 原生 hang 而不 crash）时
// 不会触发 exit，pending Promise 永不 settle → kb:ask/回填会永久挂起。超时则杀掉卡死 worker 并拒绝。
// 取较大值以容纳首次模型下载（~1-2 分钟）。
const REQUEST_TIMEOUT_MS = 180_000

export function createEmbedder(opts: { cacheDir: string; workerPath: string; mirrorHost?: string }): Embedder {
  let child: UtilityProcess | null = null
  let nextId = 1
  let embedsSinceSpawn = 0
  const pending = new Map<number, Pending>()

  function recycle() {
    if (child) { try { child.kill() } catch { /* ignore */ } child = null }
    embedsSinceSpawn = 0
  }

  function ensureChild(): UtilityProcess {
    if (child) return child
    const c = utilityProcess.fork(opts.workerPath, [], { serviceName: 'paperlens-embedder' })
    c.on('message', (msg: { id: number; ok: boolean; flat?: Float32Array; dim?: number; n?: number; error?: string }) => {
      const p = pending.get(msg.id)
      if (!p) return
      pending.delete(msg.id)
      if (msg.ok && msg.flat && msg.dim) {
        const { flat, dim, n = 0 } = msg
        const out: Float32Array[] = []
        for (let i = 0; i < n; i++) out.push(flat.subarray(i * dim, (i + 1) * dim))
        p.resolve(out)
      } else {
        p.reject(new Error(msg.error || 'embed failed'))
      }
    })
    c.on('exit', () => {
      child = null
      for (const p of pending.values()) p.reject(new Error('embedder worker exited'))
      pending.clear()
    })
    child = c
    return c
  }

  function request(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return Promise.resolve([])
    if (embedsSinceSpawn >= RECYCLE_AFTER_TEXTS) recycle() // 触发崩溃前主动重启
    return new Promise<Float32Array[]>((resolve, reject) => {
      const id = nextId++
      const timer = setTimeout(() => {
        if (pending.delete(id)) { recycle(); reject(new Error('embed request timeout')) } // 杀掉卡死 worker，下次自动重建
      }, REQUEST_TIMEOUT_MS)
      pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v) },
        reject: (e) => { clearTimeout(timer); reject(e) },
      })
      embedsSinceSpawn += texts.length
      ensureChild().postMessage({ id, texts, cacheDir: opts.cacheDir, mirror: opts.mirrorHost || MIRROR })
    })
  }

  return {
    async embedQuery(text) { return (await request([asQuery(text)]))[0] },
    async embedPassages(texts) { return request(texts.map(asPassage)) },
    async warmup() { await request([asQuery('warmup')]) },
  }
}
