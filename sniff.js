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
    if (collecting) requests.push({ packet, innerChannel })
})

setTimeout(() => {
    collecting = false
    console.log('\nВсего: ' + requests.length + ' запросов')
    console.log('Отвечаем...\n')

    for (const { packet, innerChannel } of requests) {
        let response

        if (innerChannel === 'fml:handshake') {
            // FML3: ответ обёрнут в loginwrapper
            // Формат: varint(len(channelName)) + channelName + acknowledgement(0x63)
            const channelBuf = Buffer.from('fml:handshake')
            response = Buffer.alloc(1 + channelBuf.length + 1)
            response[0] = channelBuf.length
            channelBuf.copy(response, 1)
            response[1 + channelBuf.length] = 0x63 // acknowledgement byte

            // Но может сервер ожидает varint формат
            // Попробуем другой формат: просто acknowledgement
        } else {
            // tacz и tacztweaks — пустой ответ
            const channelBuf = Buffer.from(innerChannel)
            response = Buffer.alloc(1 + channelBuf.length + 1)
            response[0] = channelBuf.length
            channelBuf.copy(response, 1)
            response[1 + channelBuf.length] = 0x01
        }

        client.write('login_plugin_response', {
            messageId: packet.messageId,
            data: response
        })
    }
}, 5000)

client.on('login', () => {
    console.log('\n*** SUCCESS! ***')
})

client.on('disconnect', (packet) => {
    // Парсим причину подробнее
    try {
        const reason = JSON.parse(packet.reason)
        if (reason.with) {
            console.log('DISCONNECT:', reason.with[0].substring(0, 300))
        } else {
            console.log('DISCONNECT:', JSON.stringify(reason).substring(0, 300))
        }
    } catch(e) {
        console.log('DISCONNECT:', JSON.stringify(packet).substring(0, 300))
    }
    process.exit()
})

client.on('kick_disconnect', (packet) => {
    console.log('KICKED:', JSON.stringify(packet).substring(0, 300))
    process.exit()
})

client.on('error', (err) => console.log('ERROR:', err.message))
client.on('end', () => { console.log('DISCONNECTED'); process.exit() })

setTimeout(() => { console.log('TIMEOUT'); process.exit() }, 20000)
