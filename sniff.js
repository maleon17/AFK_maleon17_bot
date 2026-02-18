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
    console.log('\n=== Request #' + requestCount + ' ===')
    console.log('messageId:', packet.messageId)
    console.log('channel:', packet.channel)
    
    const hex = packet.data ? packet.data.toString('hex') : 'null'
    const utf8 = packet.data ? packet.data.toString('utf8').replace(/[^\x20-\x7E]/g, '.') : 'null'
    
    console.log('data hex:', hex.substring(0, 200))
    console.log('data readable:', utf8.substring(0, 200))
    
    // Первые байты показывают вложенный канал
    if (packet.data && packet.data.length > 0) {
        const nameLen = packet.data[0]
        const innerChannel = packet.data.slice(1, 1 + nameLen).toString('utf8')
        console.log('inner channel:', innerChannel)
        console.log('inner data hex:', packet.data.slice(1 + nameLen).toString('hex').substring(0, 200))
    }

    // Отвечаем на все запросы
    if (packet.channel === 'fml:loginwrapper' && packet.data) {
        const nameLen = packet.data[0]
        const innerChannel = packet.data.slice(1, 1 + nameLen).toString('utf8')
        
        const response = Buffer.alloc(2 + innerChannel.length)
        response[0] = innerChannel.length
        response.write(innerChannel, 1)
        response[1 + innerChannel.length] = 0
        
        console.log('-> Отвечаем на:', innerChannel)
        
        client.write('login_plugin_response', {
            messageId: packet.messageId,
            data: response
        })
    } else {
        client.write('login_plugin_response', {
            messageId: packet.messageId,
            data: null
        })
    }
})

client.on('login', () => {
    console.log('\n*** SUCCESS! Logged in! ***')
})

client.on('disconnect', (packet) => {
    console.log('DISCONNECT:', JSON.stringify(packet).substring(0, 300))
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
