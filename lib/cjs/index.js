"use strict";
var __classPrivateFieldSet = (this && this.__classPrivateFieldSet) || function (receiver, privateMap, value) {
    if (!privateMap.has(receiver)) {
        throw new TypeError("attempted to set private field on non-instance");
    }
    privateMap.set(receiver, value);
    return value;
};
var __classPrivateFieldGet = (this && this.__classPrivateFieldGet) || function (receiver, privateMap) {
    if (!privateMap.has(receiver)) {
        throw new TypeError("attempted to get private field on non-instance");
    }
    return privateMap.get(receiver);
};
var _server_listener, _listener, _connection_wait, _uploads, _worker, _connect, _reconnect, _handlers, _io, _readBlock, _dedupe;
Object.defineProperty(exports, "__esModule", { value: true });
const worker_js_1 = require("./worker.js");
const AckKey = '__ack__-';
const EVENT_CHECK_RECORD = 'check-write-record';
const EVENT_UPLOAD = 'upload';
const EVENT_UPLOAD_COMPLETE = 'upload-completed';
class Client {
    constructor(url) {
        this.url = url;
        _server_listener.set(this, new Map());
        _listener.set(this, new Map()
        // 20s default
        );
        // 20s default
        _connection_wait.set(this, 1000 * 20
        // This holds id of active uploads
        );
        // This holds id of active uploads
        _uploads.set(this, new Set());
        _worker.set(this, '');
        _connect.set(this, () => {
            if (this.ws) {
                if (this.ws.CLOSED || this.ws.CLOSING) {
                    this.ws = new WebSocket(this.url);
                    // Call this to handler in coming events
                    __classPrivateFieldGet(this, _handlers).call(this);
                }
                return this.ws;
            }
            else {
                this.ws = new WebSocket(this.url);
                // Call this to handler in coming events
                __classPrivateFieldGet(this, _handlers).call(this);
            }
            return this.ws;
        });
        _reconnect.set(this, async () => {
            try {
                await __classPrivateFieldGet(this, _io).call(this);
            }
            catch (error) {
                __classPrivateFieldGet(this, _reconnect).call(this);
            }
        });
        _handlers.set(this, () => {
            let ths = this;
            this.ws.onclose = function () {
                if (__classPrivateFieldGet(ths, _uploads).size) {
                    __classPrivateFieldGet(ths, _uploads).forEach((id) => ths.dispatchEvent('pause', id));
                    __classPrivateFieldGet(ths, _reconnect).call(ths);
                }
            };
            ths.ws.onerror = function (ev) {
                ths.dispatchEvent('socket-error', ev);
            };
            ths.ws.onopen = function () {
                if (__classPrivateFieldGet(ths, _uploads).size) {
                    __classPrivateFieldGet(ths, _uploads).forEach((id) => ths.dispatchEvent('resume', id));
                }
            };
            this.ws.onmessage = function (ev) {
                if (typeof ev.data === 'string') {
                    let payload = JSON.parse(ev.data);
                    if (payload === null || payload === void 0 ? void 0 : payload.event) {
                        let handler = __classPrivateFieldGet(ths, _server_listener).get(payload.event);
                        if (typeof handler === 'function')
                            handler(payload.data);
                    }
                }
            };
        });
        _io.set(this, () => {
            return new Promise((resolve, reject) => {
                let timer = setTimeout(() => {
                    clearTimeout(timer);
                    reject('Waiting for connection timeout');
                }, __classPrivateFieldGet(this, _connection_wait));
                if (!this.ws) {
                    __classPrivateFieldGet(this, _connect).call(this).addEventListener('open', () => {
                        clearTimeout(timer);
                        resolve(this.ws);
                    });
                }
                else if ([this.ws.CLOSING, this.ws.CLOSED].includes(this.ws.readyState)) {
                    __classPrivateFieldGet(this, _connect).call(this).addEventListener('open', () => {
                        clearTimeout(timer);
                        resolve(this.ws);
                    });
                }
                else if (this.ws.readyState === this.ws.CONNECTING) {
                    this.ws.addEventListener('open', () => {
                        clearTimeout(timer);
                        resolve(this.ws);
                    });
                }
                else {
                    resolve(this.ws);
                }
            });
        });
        _readBlock.set(this, (p) => {
            return new Promise((resolve, reject) => {
                let blob = p.file.slice(p.start, p.end);
                let reader = new FileReader();
                reader.onloadend = function (ev) {
                    var _a;
                    let base64 = (_a = ev.target) === null || _a === void 0 ? void 0 : _a.result;
                    base64 = base64.replace('data:application/octet-stream;base64,', '');
                    resolve(base64);
                };
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
        });
        this.send = async (event, data, ack) => {
            const io = await __classPrivateFieldGet(this, _io).call(this);
            if (typeof ack === 'function') {
                let id = `${AckKey}${performance.now()}`;
                __classPrivateFieldGet(this, _server_listener).set(id, ack);
                return io.send(JSON.stringify({ event, data, ack: id }));
            }
            return io.send(JSON.stringify({ event, data }));
        };
        this.dispatchEvent = (event, payload) => {
            let handlers = __classPrivateFieldGet(this, _listener).get(event);
            if (Array.isArray(handlers)) {
                handlers.forEach((h) => h(payload));
            }
            return this;
        };
        this.addEventListener = (event, cb) => {
            let handlers = __classPrivateFieldGet(this, _listener).get(event);
            handlers = Array.isArray(handlers) ? [...handlers, cb] : [cb];
            __classPrivateFieldGet(this, _listener).set(event, handlers);
            return this;
        };
        this.removeEventListener = (event, cb) => {
            let handlers = __classPrivateFieldGet(this, _listener).get(event);
            if (Array.isArray(handlers)) {
                handlers = handlers.filter((h) => h !== cb);
                __classPrivateFieldGet(this, _listener).set(event, handlers);
            }
            return this;
        };
        /**
         * `dedupe` (de-duplication) create file blocks and file hash
         */
        _dedupe.set(this, (file) => {
            return new Promise((resolve, reject) => {
                let worker = new Worker(__classPrivateFieldGet(this, _worker));
                worker.onmessage = function onmessage({ data }) {
                    resolve(data);
                    worker.terminate();
                };
                worker.onerror = function onmessage(error) {
                    reject(error);
                };
                worker.postMessage(file);
            });
        });
        this.upload = async (file, options = { id: 'upload' }) => {
            if (typeof options.folder_id !== 'string' && typeof options.folder_path !== 'string') {
                throw new Error('folder_id or folder_path was not provided');
            }
            let fileObject = await __classPrivateFieldGet(this, _dedupe).call(this, file);
            const ths = this;
            let payload = {
                blocks: fileObject.blocks.map(({ hash }) => ({ hash })),
                hash: fileObject.hash,
                name: file.name,
                size: file.size,
                folder_id: options.folder_id,
                folder_path: options.folder_path,
                mod_time: new Date(file.lastModified),
                is_web: true,
            };
            return new Promise((resolve, reject) => {
                this.send(EVENT_CHECK_RECORD, payload, async function (p) {
                    // Cast to object for easier access
                    const blocks = fileObject.blocks.reduce((a, c) => {
                        a[c.hash] = c;
                        return a;
                    }, {});
                    const file_hash = fileObject.hash;
                    //@ts-ignore
                    fileObject = null; // free up memory
                    // @ts-ignore
                    payload = null; // free up memory
                    let is_paused = false;
                    let is_canceled = false;
                    const onPause = (file_id) => {
                        if (options.id === file_id) {
                            is_paused = true;
                        }
                    };
                    const onResume = (file_id) => {
                        if (options.id === file_id) {
                            is_paused = false;
                        }
                    };
                    const onCancel = (file_id) => {
                        if (options.id === file_id) {
                            is_canceled = true;
                            is_paused = false;
                        }
                    };
                    ths.addEventListener('pause', onPause);
                    ths.addEventListener('resume', onResume);
                    ths.addEventListener('cancel', onCancel);
                    const removeEvents = () => {
                        ths.removeEventListener('pause', onPause);
                        ths.removeEventListener('resume', onResume);
                        ths.removeEventListener('cancel', onCancel);
                        __classPrivateFieldGet(ths, _uploads).delete(options.id);
                    };
                    try {
                        if (p.exists) {
                            ths.dispatchEvent('progress', { size: file.size, current: file.size, id: options.id });
                            return resolve(p.record);
                        }
                        else if (p.access_denied) {
                            return reject(p.message);
                        }
                        else {
                            __classPrivateFieldGet(ths, _uploads).add(options.id);
                            for (const hash of p.blocks) {
                                if (is_paused) {
                                    ths.dispatchEvent('paused', options.id);
                                    await waitUntil(() => is_paused);
                                    ths.dispatchEvent('resumed', options.id);
                                }
                                if (is_canceled) {
                                    ths.dispatchEvent('canceled', options.id);
                                    return reject('Upload was canceled');
                                }
                                const { start, end } = blocks[hash];
                                const content = await __classPrivateFieldGet(ths, _readBlock).call(ths, { file, start, end });
                                let res = await new Promise((resolve) => {
                                    ths.send(EVENT_UPLOAD, { upload_id: p.upload_id, hash, file_hash, content }, (h) => {
                                        resolve(h === hash);
                                    });
                                });
                                ths.dispatchEvent('progress', { size: file.size, current: end, id: options.id });
                                if (!res) {
                                    return reject('Block hash mismatch');
                                }
                            }
                            ths.send(EVENT_UPLOAD_COMPLETE, p.upload_id, (h) => {
                                if (h.error) {
                                    reject(h.error);
                                }
                                else
                                    resolve(h);
                            });
                        }
                    }
                    finally {
                        removeEvents();
                    }
                });
            });
        };
        let code = worker_js_1.default.toString();
        code = code.substring(code.indexOf('{') + 1, code.lastIndexOf('}'));
        __classPrivateFieldSet(this, _worker, URL.createObjectURL(new Blob([code], { type: 'text/javascript' })));
    }
}
exports.default = Client;
_server_listener = new WeakMap(), _listener = new WeakMap(), _connection_wait = new WeakMap(), _uploads = new WeakMap(), _worker = new WeakMap(), _connect = new WeakMap(), _reconnect = new WeakMap(), _handlers = new WeakMap(), _io = new WeakMap(), _readBlock = new WeakMap(), _dedupe = new WeakMap();
function waitUntil(cb) {
    return new Promise((resolve) => {
        let timer = setInterval(() => {
            if (!cb()) {
                resolve();
                clearInterval(timer);
            }
        }, 500);
    });
}
//# sourceMappingURL=index.js.map