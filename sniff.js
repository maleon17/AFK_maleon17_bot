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
        if (innerChannel === 'fml:handshake') {
            // Acknowledgement
            client.write('login_plugin_response', {
                messageId: packet.messageId,
                data: Buffer.from([0x63])
            })
        } else {
            // tacz, tacztweaks — не поддерживаем
            client.write('login_plugin_response', {
                messageId: packet.messageId,
                data: null
            })
        }
    }
}, 5000)

client.on('login', () => {
    console.log('\n*** SUCCESS! ***')
})

client.on('disconnect', (packet) => {
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
