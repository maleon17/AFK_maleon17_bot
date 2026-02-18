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

client.on('login_plugin_request', (packet) => {
    let innerChannel = ''
    let innerHex = ''
    
    if (packet.data) {
        const nameLen = packet.data[0]
        innerChannel = packet.data.slice(1, 1 + nameLen).toString('utf8')
        innerHex = packet.data.slice(1 + nameLen).toString('hex').substring(0, 60)
    }

    requests.push({
        id: packet.messageId,
        inner: innerChannel,
        hex: innerHex
    })

    console.log('#' + packet.messageId + ' ' + innerChannel + ' -> ' + innerHex)
})

setTimeout(() => {
    console.log('\n=== Всего запросов: ' + requests.length + ' ===')
    console.log('\nУникальные каналы:')
    
    const channels = {}
    for (const r of requests) {
        if (!channels[r.inner]) {
            channels[r.inner] = { count: 0, firstHex: r.hex, firstId: r.id }
        }
        channels[r.inner].count++
    }
    
    for (const [name, info] of Object.entries(channels)) {
        console.log('  ' + name + ': ' + info.count + ' запросов, first id: ' + info.firstId)
        console.log('    hex: ' + info.firstHex)
    }

    console.log('\nТеперь пробуем отвечать пустым на все...')

    for (const r of requests) {
        const nameLen = Buffer.byteLength(r.inner)
        const response = Buffer.alloc(nameLen + 2)
        response[0] = nameLen
        response.write(r.inner, 1)
        response[1 + nameLen] = 0

        client.write('login_plugin_response', {
            messageId: r.id,
            data: response
        })
    }
}, 5000)

client.on('login', () => {
    console.log('\n*** SUCCESS! Logged in! ***')
})

client.on('disconnect', (packet) => {
    console.log('DISCONNECT:', JSON.stringify(packet).substring(0, 300))
    process.exit()
})

client.on('kick_disconnect', (packet) => {
    console.log('KICKED:', JSON.stringify(packet).substring(0, 300))
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
