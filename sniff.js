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
    
    // Показываем первые 10 байт данных
    const preview = innerData.slice(0, 10).toString('hex')
    console.log('#' + packet.messageId + ' ' + innerChannel + ' (len: ' + innerData.length + ') data: ' + preview)

    if (innerChannel === 'tacz:handshake' || innerChannel === 'tacztweaks:handshake') {
        client.write('login_plugin_response', {
            messageId: packet.messageId,
            data: packet.data
        })
        console.log('  -> echo')
    } else if (innerChannel === 'fml:handshake') {
        // Первый байт = тип пакета в FML3
        const packetType = innerData[0]
        console.log('  -> fml type: 0x' + packetType.toString(16))
        
        // В FML3:
        // 0x01 = ModListReply  
        // 0x02 = ServerRegistry
        // 0x03 = RegistryData
        // 0x04 = ConfigData
        // 0x05 = Acknowledgement от сервера
        
        // Ответ клиента:
        // На ModList (0x01/0x02) -> отправить ModListReply
        // На RegistryData (0x03) -> отправить Acknowledgement (0x63 = 99)
        // На ConfigData (0x04) -> отправить Acknowledgement
        
        let response
        const channelBuf = Buffer.from('fml:handshake')

        if (packetType <= 0x02) {
            // ModList — отвечаем пустым ModListReply
            response = Buffer.alloc(1 + channelBuf.length + 3)
            response[0] = channelBuf.length
            channelBuf.copy(response, 1)
            response[1 + channelBuf.length] = 0x02  // ModListReply
            response[2 + channelBuf.length] = 0x00  // 0 mods
            response[3 + channelBuf.length] = 0x00  // 0 channels
        } else {
            // Registry/Config — acknowledgement
            response = Buffer.alloc(1 + channelBuf.length + 1)
            response[0] = channelBuf.length
            channelBuf.copy(response, 1)
            response[1 + channelBuf.length] = 0x63
        }

        client.write('login_plugin_response', {
            messageId: packet.messageId,
            data: response
        })
        console.log('  -> responded')
    }
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
    console.log('KICKED:', JSON.stringify(packet).substring(0, 300))
    process.exit()
})

client.on('error', (err) => console.log('ERROR:', err.message))
client.on('end', () => { console.log('DISCONNECTED'); process.exit() })

setTimeout(() => { console.log('TIMEOUT after #' + requestNum); process.exit() }, 20000)
