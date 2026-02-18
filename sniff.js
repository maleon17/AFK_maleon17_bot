const mc = require('minecraft-protocol')

const client = mc.createClient({
    host: 'donator2.gamely.pro',
    port: 30958,
    username: 'maleon17',
    version: '1.20.1',
    auth: 'offline',
    fakeHost: 'donator2.gamely.pro\0FML3\0'
})

client.removeAllListeners('login_plugin_request')

let requests = []
let collecting = true

client.on('login_plugin_request', (packet) => {
    let innerChannel = ''
    
    if (packet.data) {
        const nameLen = packet.data[0]
        innerChannel = packet.data.slice(1, 1 + nameLen).toString('utf8')
    }

    console.log('#' + packet.messageId + ' ' + innerChannel)

    if (collecting) {
        requests.push(packet)
    }
})

// Ждём все запросы, потом пробуем разные ответы
setTimeout(() => {
    collecting = false
    console.log('\nВсего: ' + requests.length + ' запросов')
    console.log('Пробуем ответить acknowledgement на каждый...\n')

    for (const packet of requests) {
        let innerChannel = ''
        if (packet.data) {
            const nameLen = packet.data[0]
            innerChannel = packet.data.slice(1, 1 + nameLen).toString('utf8')
        }

        let response

        if (innerChannel === 'fml:handshake') {
            // FML3 acknowledgement: channel name + byte 0x63 (99 = acknowledgement)
            const nameLen = Buffer.byteLength('fml:handshake')
            response = Buffer.alloc(nameLen + 2)
            response[0] = nameLen
            response.write('fml:handshake', 1)
            response[1 + nameLen] = 0x63
        } else if (innerChannel === 'tacz:handshake') {
            const nameLen = Buffer.byteLength('tacz:handshake')
            response = Buffer.alloc(nameLen + 2)
            response[0] = nameLen
            response.write('tacz:handshake', 1)
            response[1 + nameLen] = 0x01
        } else if (innerChannel === 'tacztweaks:handshake') {
            const nameLen = Buffer.byteLength('tacztweaks:handshake')
            response = Buffer.alloc(nameLen + 2)
            response[0] = nameLen
            response.write('tacztweaks:handshake', 1)
            response[1 + nameLen] = 0x01
        }

        client.write('login_plugin_response', {
            messageId: packet.messageId,
            data: response
        })
    }
}, 5000)

client.on('login', () => {
    console.log('\n*** SUCCESS! Logged in! ***')
})

client.on('disconnect', (packet) => {
    console.log('DISCONNECT:', JSON.stringify(packet).substring(0, 500))
    process.exit()
})

client.on('kick_disconnect', (packet) => {
    console.log('KICKED:', JSON.stringify(packet).substring(0, 500))
    process.exit()
})

client.on('error', (err) => {
    console.log('ERROR:', err.message)
})

client.on('end', () => {
    console.log('DISCONNECTED')
    process.exit()
})

setTimeout(() => {
    console.log('TIMEOUT')
    process.exit()
}, 20000)
