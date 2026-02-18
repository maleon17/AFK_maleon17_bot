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
let fmlRequests = []

client.on('login_plugin_request', (packet) => {
    requestCount++
    console.log('Request #' + requestCount + ': ' + packet.channel + ' (id: ' + packet.messageId + ')')

    if (packet.data) {
        const nameLen = packet.data[0]
        const innerChannel = packet.data.slice(1, 1 + nameLen).toString('utf8')
        console.log('  inner:', innerChannel)
    }

    fmlRequests.push(packet)
})

// Ждём все запросы, потом отвечаем
setTimeout(() => {
    console.log('\nПолучено запросов: ' + fmlRequests.length)
    console.log('Отвечаем null на все...\n')

    for (const packet of fmlRequests) {
        client.write('login_plugin_response', {
            messageId: packet.messageId,
            data: null
        })
    }
}, 2000)

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
}, 15000)
