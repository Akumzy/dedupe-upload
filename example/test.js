import Client from '../lib/esm/index.js'

// async function login () {
//     try {
//         let res = await fetch('http://127.0.0.1:2017/login', {
//             method: 'POST',
//             headers: {
//                 'Content-Type': 'application/json'
//             },
//             body: JSON.stringify(),
//             credentials: 'include'
//         })
//         console.log(await (res).json())
//     } catch (error) {
//         console.log(error)
//     }
// }
const client = new Client(`ws://127.0.0.1:4444/ws`)
window.onload = main
function main () {

    // login()
    let id
    let cancelButton = document.querySelector('#cancel')
    let pauseButton = document.querySelector('#pause')
    let progress = document.querySelector('#progress')
    let prop = document.querySelector('#pro')


    cancelButton?.addEventListener('click', () => {
        client.dispatchEvent('cancel', id)

    })
    pauseButton?.addEventListener('click', () => {
        client.dispatchEvent(pauseButton.value == 'Pause' ? 'pause' : 'resume', id)
    })

    client.addEventListener('paused', (id) => {
        console.log('Paused file with an id of %s', id);
        pauseButton.value = 'Resume'
    })
    client.addEventListener('resumed', (id) => {
        console.log('Resumed file with an id of %s', id);
        pauseButton.value = 'Pause'
    })
    client.addEventListener('canceled', (id) => {
        alert('Canceled ' + id)
    })
    client.addEventListener('progress', (pro) => {
        let percentage = ((pro.current / pro.size) * 100)
        prop.innerText = percentage + '%'
        progress.value = percentage
    })

    const input = document.querySelector('#file')
    if (input) {
        input.addEventListener('change', onChange, false)
    }

    async function onChange (ev) {
        const input = ev.target
        const file = input.files[0]
        try {
            id = Date.now() + ''
            const res = await client.upload(file, { folder_path: 'akumaisaacakuma', id })
            console.log(res)
        } catch (error) {
            console.log(error)
        }


    }

}

