"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
function workerScripts() {
    function generateBlocks(size) {
        const chunk = 512000;
        const blocksSize = Math.ceil(size / chunk);
        const blocks = [];
        for (let index = 0; index < blocksSize; index++) {
            const start = chunk * index, block = {
                order: index + 1,
                start,
                end: start + chunk,
                hash: ''
            };
            if (blocksSize - 1 === index) {
                block.end = size;
            }
            blocks.push(block);
        }
        return blocks;
    }
    async function hash(buf) {
        const hashBuffer = await crypto.subtle.digest('SHA-256', buf);
        return Array.from(new Uint8Array(hashBuffer))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    }
    self.addEventListener('message', async function onmessage(ev) {
        const file = ev.data;
        const blocks = generateBlocks(file.size);
        const reader = new FileReader();
        function onReadEnd() {
            return new Promise(resolve => {
                function onloadend() {
                    reader.removeEventListener('loadend', onloadend);
                    resolve(reader.result);
                }
                reader.addEventListener('loadend', onloadend);
            });
        }
        for (let [index, block] of blocks.entries()) {
            reader.readAsArrayBuffer(file.slice(block.start, block.end));
            let result = await onReadEnd();
            blocks[index].hash = await hash((result));
        }
        const fileHash = await hash(new TextEncoder().encode(blocks.reduce((a, { hash }) => a + hash, '')));
        //@ts-ignore
        self.postMessage({ hash: fileHash, blocks });
    });
}
exports.default = workerScripts;
//# sourceMappingURL=worker.js.map