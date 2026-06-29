// 嵌入 worker：在 utilityProcess(干净 Node 环境)里跑 transformers.js。
// onnxruntime-node 原生推理在 Electron 主进程连续调用会 SIGTRAP，隔离到子进程后稳定。
// 协议：主进程 postMessage({id, texts, cacheDir, mirror}) → 回 {id, ok, flat, dim, n} 或 {id, ok:false, error}。
import { pipeline, env } from '@xenova/transformers'

let pipePromise: Promise<any> | null = null
function getPipe(cacheDir: string, mirror: string): Promise<any> {
  if (!pipePromise) {
    env.remoteHost = mirror
    env.allowLocalModels = false
    env.cacheDir = cacheDir
    pipePromise = pipeline('feature-extraction', 'Xenova/multilingual-e5-small', { quantized: true })
      .catch((e: unknown) => { pipePromise = null; throw e })
  }
  return pipePromise
}

const port = (process as any).parentPort
port.on('message', async (e: { data: { id: number; texts: string[]; cacheDir: string; mirror: string } }) => {
  const { id, texts, cacheDir, mirror } = e.data
  try {
    const pipe = await getPipe(cacheDir, mirror)
    const out = await pipe(texts, { pooling: 'mean', normalize: true })
    const dim = out.dims[out.dims.length - 1] as number
    const flat = new Float32Array(out.data) // 拷贝，便于 transfer
    port.postMessage({ id, ok: true, flat, dim, n: texts.length }, [flat.buffer])
  } catch (err) {
    port.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) })
  }
})
