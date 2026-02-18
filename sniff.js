const mc = require('minecraft-protocol')

const client = mc.createClient({
    host: 'donator2.gamely.pro',
    port: 30958,
    username: 'maleon17',
    version: '1.20.1',
    auth: 'offline',
    fakeHost: 'donator2.gamely.pro\0FML3\0'
})

let requestCount = 0

client.on('login_plugin_request', (packet) => {
    requestCount++
    console.log('Request #' + requestCount + ' channel:', packet.channel)
    console.log('messageId:', packet.messageId)

    if (packet.channel === 'fml:loginwrapper') {
        // Определяем какой это запрос по данным
        const dataStr = packet.data ? packet.data.toString('utf8') : ''

        if (dataStr.includes('tacz:handshake')) {
            console.log('-> Отвечаем на tacz:handshake')
            // Пустой успешный ответ
            const response = Buffer.from([
                14, // длина строки "tacz:handshake"
                ...Buffer.from('tacz:handshake'),
                0   // пустой ответ
            ])
            client.write('login_plugin_response', {
                messageId: packet.messageId,
                data: response
            })
        } else if (dataStr.includes('tacztweak')) {
            console.log('-> Отвечаем на tacztweaks:handshake')
            const response = Buffer.from([
                20, // длина строки "tacztweaks:handshake"
                ...Buffer.from('tacztweaks:handshake'),
                0   // пустой ответ
            ])
            client.write('login_plugin_response', {
                messageId: packet.messageId,
                data: response
            })
        } else {
            console.log('-> Неизвестный запрос, отвечаем пустым')
            client.write('login_plugin_response', {
                messageId: packet.messageId,
                data: Buffer.alloc(0)
            })
        }
    } else {
        // Не fml:loginwrapper — отвечаем null
        client.write('login_plugin_response', {
            messageId: packet.messageId,
            data: null
        })
    }
})

client.on('login', () => {
    console.log('SUCCESS! Logged in!')
})

client.on('packet', (data, meta) => {
    if (meta.state === 'login' && meta.name !== 'login_plugin_request') {
        console.log('[' + meta.state + '] ' + meta.name)
    }
})

client.on('error', (err) => {
    console.log('ERROR:', err.message)
})

client.on('end', () => {
    console.log('DISCONNECTED')
    process.exit()
})

client.on('kick_disconnect', (packet) => {
    console.log('KICKED:', JSON.stringify(packet).substring(0, 200))
    process.exit()
})

setTimeout(() => {
    console.log('TIMEOUT - no more packets')
    process.exit()
}, 15000)
