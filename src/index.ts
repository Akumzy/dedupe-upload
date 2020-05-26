import workerScript from './worker.js'
interface IFile {
  hash: string
  blocks: IBlock[]
}
interface IBlock {
  order: number
  start: number
  end: number
  hash: string
}

interface IPayload {
  exists: boolean
  blocks: string[]
  upload_id: string
  record?: { cloud_id: string; version: number }
  access_denied?: boolean
  message?: string
}

interface ICompleteResponse {
  version?: number
  cloud_id?: string
  error?: string
  [key: string]: any
}

const AckKey = '__ack__-'
const EVENT_CHECK_RECORD = 'check-write-record'
const EVENT_UPLOAD = 'upload'
const EVENT_UPLOAD_COMPLETE = 'upload-completed'
type Events = 'paused' | 'resumed' | 'canceled' | 'pause' | 'resume' | 'cancel' | 'progress' | 'socket-error'
interface ProgressPayload {
  size: number
  current: number
  id: string
}

export default class Client {
  ws!: WebSocket
  #server_listener: Map<string, Function> = new Map()
  #listener: Map<string, Function[]> = new Map()
  // 20s default
  #connection_wait = 1000 * 20
  // This holds id of active uploads
  #uploads = new Set<string>()
  #worker = ''
  constructor(private url: string) {
    let code = workerScript.toString()
    code = code.substring(code.indexOf('{') + 1, code.lastIndexOf('}'))
    this.#worker = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))
  }
  #connect = () => {
    if (this.ws) {
      if (this.ws.CLOSED || this.ws.CLOSING) {
        this.ws = new WebSocket(this.url)
        // Call this to handler in coming events
        this.#handlers()
      }
      return this.ws
    } else {
      this.ws = new WebSocket(this.url)
      // Call this to handler in coming events
      this.#handlers()
    }
    return this.ws
  }
  #reconnect = async () => {
    try {
      await this.#io()
    } catch (error) {
      this.#reconnect()
    }
  }
  #handlers = () => {
    let ths = this
    this.ws.onclose = function () {
      if (ths.#uploads.size) {
        ths.#uploads.forEach((id) => ths.dispatchEvent('pause', id))
        ths.#reconnect()
      }
    }
    ths.ws.onerror = function (ev) {
      ths.dispatchEvent('socket-error', ev)
    }
    ths.ws.onopen = function () {
      if (ths.#uploads.size) {
        ths.#uploads.forEach((id) => ths.dispatchEvent('resume', id))
      }
    }
    this.ws.onmessage = function (ev) {
      if (typeof ev.data === 'string') {
        let payload = JSON.parse(ev.data) as { event: string; data: any }
        if (payload?.event) {
          let handler = ths.#server_listener.get(payload.event)
          if (typeof handler === 'function') handler(payload.data)
        }
      }
    }
  }

  #io: (timeout?: number) => Promise<WebSocket> = () => {
    return new Promise((resolve, reject) => {
      let timer = setTimeout(() => {
        clearTimeout(timer)
        reject('Waiting for connection timeout')
      }, this.#connection_wait)
      if (!this.ws) {
        this.#connect().addEventListener('open', () => {
          clearTimeout(timer)
          resolve(this.ws)
        })
      } else if ([this.ws.CLOSING, this.ws.CLOSED].includes(this.ws.readyState)) {
        this.#connect().addEventListener('open', () => {
          clearTimeout(timer)
          resolve(this.ws)
        })
      } else if (this.ws.readyState === this.ws.CONNECTING) {
        this.ws.addEventListener('open', () => {
          clearTimeout(timer)
          resolve(this.ws)
        })
      } else {
        resolve(this.ws)
      }
    })
  }

  #readBlock = (p: { file: File; start: number; end: number }) => {
    return new Promise((resolve, reject) => {
      let blob = p.file.slice(p.start, p.end)
      let reader = new FileReader()
      reader.onloadend = function (ev) {
        let base64 = ev.target?.result as string
        base64 = base64.replace('data:application/octet-stream;base64,', '')
        resolve(base64)
      }
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
  }
  send = async (event: string, data: any, ack?: Function) => {
    const io = await this.#io()
    if (typeof ack === 'function') {
      let id = `${AckKey}${performance.now()}`
      this.#server_listener.set(id, ack)
      return io.send(JSON.stringify({ event, data, ack: id }))
    }
    return io.send(JSON.stringify({ event, data }))
  }
  dispatchEvent = (event: Events, payload: any) => {
    let handlers = this.#listener.get(event)
    if (Array.isArray(handlers)) {
      handlers.forEach((h) => h(payload))
    }
    return this
  }
  addEventListener = (event: Events, cb: Function) => {
    let handlers = this.#listener.get(event)
    handlers = Array.isArray(handlers) ? [...handlers, cb] : [cb]
    this.#listener.set(event, handlers)
    return this
  }
  removeEventListener = (event: Events, cb: Function) => {
    let handlers = this.#listener.get(event)
    if (Array.isArray(handlers)) {
      handlers = handlers.filter((h) => h !== cb)
      this.#listener.set(event, handlers)
    }
    return this
  }
  /**
   * `dedupe` (de-duplication) create file blocks and file hash
   */
  #dedupe = (file: File) => {
    return new Promise<IFile>((resolve, reject) => {
      let worker = new Worker(this.#worker)
      worker.onmessage = function onmessage({ data }) {
        resolve(data)
        worker.terminate()
      }
      worker.onerror = function onmessage(error) {
        reject(error)
      }
      worker.postMessage(file)
    })
  }
  upload = async (file: File, options: { folder_id?: string; folder_path?: string; id: string } = { id: 'upload' }) => {
    if (typeof options.folder_id !== 'string' && typeof options.folder_path !== 'string') {
      throw new Error('folder_id or folder_path was not provided')
    }
    let fileObject = await this.#dedupe(file)

    const ths = this
    let payload = {
      blocks: fileObject.blocks.map(({ hash }) => ({ hash })),
      hash: fileObject.hash,
      name: file.name,
      size: file.size,
      folder_id: options.folder_id,
      folder_path: options.folder_path,
      mod_time: new Date(file.lastModified),
      is_web: true,
    }

    return new Promise<ICompleteResponse>((resolve, reject) => {
      this.send(EVENT_CHECK_RECORD, payload, async function (p: IPayload) {
        // Cast to object for easier access
        const blocks = fileObject.blocks.reduce((a, c) => {
          a[c.hash] = c
          return a
        }, {} as { [hash: string]: IBlock })
        const file_hash = fileObject.hash
        //@ts-ignore
        fileObject = null // free up memory
        // @ts-ignore
        payload = null // free up memory

        let is_paused = false
        let is_canceled = false
        const onPause = (file_id: string) => {
          if (options.id === file_id) {
            is_paused = true
          }
        }
        const onResume = (file_id: string) => {
          if (options.id === file_id) {
            is_paused = false
          }
        }
        const onCancel = (file_id: string) => {
          if (options.id === file_id) {
            is_canceled = true
            is_paused = false
          }
        }
        ths.addEventListener('pause', onPause)
        ths.addEventListener('resume', onResume)
        ths.addEventListener('cancel', onCancel)
        const removeEvents = () => {
          ths.removeEventListener('pause', onPause)
          ths.removeEventListener('resume', onResume)
          ths.removeEventListener('cancel', onCancel)
          ths.#uploads.delete(options.id)
        }
        try {
          if (p.exists) {
            ths.dispatchEvent('progress', { size: file.size, current: file.size, id: options.id })
            return resolve(p.record)
          } else if (p.access_denied) {
            return reject(p.message)
          } else {
            ths.#uploads.add(options.id)
            for (const hash of p.blocks) {
              if (is_paused) {
                ths.dispatchEvent('paused', options.id)
                await waitUntil(() => is_paused)
                ths.dispatchEvent('resumed', options.id)
              }
              if (is_canceled) {
                ths.dispatchEvent('canceled', options.id)
                return reject('Upload was canceled')
              }
              const { start, end } = blocks[hash]

              const content = await ths.#readBlock({ file, start, end })
              let res = await new Promise((resolve) => {
                ths.send(EVENT_UPLOAD, { upload_id: p.upload_id, hash, file_hash, content }, (h: string) => {
                  resolve(h === hash)
                })
              })
              ths.dispatchEvent('progress', { size: file.size, current: end, id: options.id })
              if (!res) {
                return reject('Block hash mismatch')
              }
            }

            ths.send(EVENT_UPLOAD_COMPLETE, p.upload_id, (h: ICompleteResponse) => {
              if (h.error) {
                reject(h.error)
              } else resolve(h)
            })
          }
        } finally {
          removeEvents()
        }
      })
    })
  }
}

function waitUntil(cb: () => boolean) {
  return new Promise((resolve) => {
    let timer = setInterval(() => {
      if (!cb()) {
        resolve()
        clearInterval(timer)
      }
    }, 500)
  })
}
