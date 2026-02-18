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

let requestNum = 0

client.on('login_plugin_request', (packet) => {
    let innerChannel = ''
    let innerData = Buffer.alloc(0)
    
    if (packet.data) {
        const nameLen = packet.data[0]
        innerChannel = packet.data.slice(1, 1 + nameLen).toString('utf8')
        innerData = packet.data.slice(1 + nameLen)
    }
    
    requestNum++
    console.log('#' + packet.messageId + ' ' + innerChannel + ' (data len: ' + innerData.length + ', first byte: 0x' + (innerData.length > 0 ? innerData[0].toString(16) : '??') + ')')

    // Отвечаем сразу на каждый запрос
    // Попробуем эхо — вернуть те же данные что получили
    client.write('login_plugin_response', {
        messageId: packet.messageId,
        data: packet.data
    })
    
    console.log('  -> echo response sent')
})

client.on('login', () => {
    console.log('\n*** SUCCESS! ***')
})

client.on('disconnect', (packet) => {
    try {
        const reason = JSON.parse(packet.reason)
        if (reason.with) {
            console.log('DISCONNECT after #' + requestNum + ':', reason.with[0].substring(0, 300))
        } else {
            console.log('DISCONNECT after #' + requestNum + ':', JSON.stringify(reason).substring(0, 300))
        }
    } catch(e) {
        console.log('DISCONNECT:', JSON.stringify(packet).substring(0, 300))
    }
    process.exit()
})

client.on('kick_disconnect', (packet) => {
    console.log('KICKED after #' + requestNum + ':', JSON.stringify(packet).substring(0, 300))
    process.exit()
})

client.on('error', (err) => console.log('ERROR:', err.message))
client.on('end', () => { console.log('DISCONNECTED'); process.exit() })

setTimeout(() => { console.log('TIMEOUT after #' + requestNum); process.exit() }, 20000)
