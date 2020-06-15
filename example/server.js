const https = require('http');
const WebSocket = require('ws');
const server = https.createServer()
const fs = require('fs-extra');
const { inspect } = require('util');

const wss = new WebSocket.Server({ server })
let id = 1
wss.on('connection', (ws) => {
    let file
    ws.on('message', async (payload) => {
        switch (typeof payload) {
            case 'string':
                const data = JSON.parse(payload)
                if (data.event === 'check-write-record') {
                    console.log(inspect(data, null, Infinity));
                    file = data.data
                    ws.send(JSON.stringify({ event: data.ack, data: { upload_id: id++, blocks: data.data.blocks.map(b => b.hash) } }))
                } else {
                    ws.send(JSON.stringify({ event: data.ack, data: { cloud_id: 2 } }))
                }

                break;
            default:
                const offset = new Uint16Array(payload.slice(0, 2))[0] + 2
                // return
                let meta = JSON.parse(payload.slice(2, offset))
                console.log(meta);
                await fs.appendFile('/home/akumzy/hola/dedupe-upload/' + file.name, payload.slice(offset))
                ws.send(JSON.stringify({ event: meta.ack, data: meta.data.hash }))
                break;
        }
    })
})
server.listen(8888).addListener('connection', (req) => {
    console.log('yoo');
    // console.log(req);
    // req.addListener('connect')
})