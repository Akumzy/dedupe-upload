interface ICompleteResponse {
    version?: number;
    cloud_id?: string;
    error?: string;
}
declare type Events = 'paused' | 'resumed' | 'canceled' | 'pause' | 'resume' | 'cancel' | 'progress' | 'socket-error';
export default class Client {
    #private;
    private url;
    ws: WebSocket;
    constructor(url: string);
    send: (event: string, data: any, ack?: Function | undefined) => Promise<void>;
    dispatchEvent: (event: Events, payload: any) => this;
    addEventListener: (event: Events, cb: Function) => this;
    removeEventListener: (event: Events, cb: Function) => this;
    upload: (file: File, options?: {
        folder_id?: string;
        folder_path?: string;
        id: string;
    }) => Promise<ICompleteResponse>;
}
export {};
