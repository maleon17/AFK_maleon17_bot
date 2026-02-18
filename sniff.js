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

function readVarInt(buffer, offset) {
    let value = 0
    let length = 0
    let currentByte
    do {
        currentByte = buffer[offset + length]
        value |= (currentByte & 0x7F) << (length * 7)
        length++
        if (length > 5) return { value: 0, length: 0 }
    } while ((currentByte & 0x80) !== 0)
    return { value, length }
}

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

    if (innerChannel === 'fml:handshake') {
        // Читаем varint длину
        const lenInfo = readVarInt(innerData, 0)
        const dataAfterLen = innerData.slice(lenInfo.length)
        
        // Следующий varint — тип пакета
        const typeInfo = readVarInt(dataAfterLen, 0)
        
        console.log('#' + packet.messageId + ' ' + innerChannel + 
            ' varintLen=' + lenInfo.value + 
            ' type=' + typeInfo.value + 
            ' first20=' + dataAfterLen.slice(0, 20).toString('hex'))
        
        // FML3 типы от сервера:
        // 1 = ModList
        // 2 = RegistryList  
        // 3 = Registry
        // 4 = ConfigData
        
        let response
        const channelBuf = Buffer.from('fml:handshake')
        
        if (typeInfo.value === 1) {
            // ModList -> ModListReply (type 2)
            // varint(len) + varint(type=2) + varint(0 mods) + varint(0 channels) + varint(0 registries)
            const payload = Buffer.from([0x04, 0x02, 0x00, 0x00, 0x00])
            response = Buffer.alloc(1 + channelBuf.length + payload.length)
            response[0] = channelBuf.length
            channelBuf.copy(response, 1)
            payload.copy(response, 1 + channelBuf.length)
            console.log('  -> ModListReply')
        } else if (typeInfo.value === 2) {
            // RegistryList -> Acknowledgement (type 99)
            const payload = Buffer.from([0x01, 0x63])
            response = Buffer.alloc(1 + channelBuf.length + payload.length)
            response[0] = channelBuf.length
            channelBuf.copy(response, 1)
            payload.copy(response, 1 + channelBuf.length)
            console.log('  -> Ack for RegistryList')
        } else if (typeInfo.value === 3) {
            // Registry -> Acknowledgement
            const payload = Buffer.from([0x01, 0x63])
            response = Buffer.alloc(1 + channelBuf.length + payload.length)
            response[0] = channelBuf.length
            channelBuf.copy(response, 1)
            payload.copy(response, 1 + channelBuf.length)
            console.log('  -> Ack for Registry')
        } else if (typeInfo.value === 4) {
            // ConfigData -> Acknowledgement
            const payload = Buffer.from([0x01, 0x63])
            response = Buffer.alloc(1 + channelBuf.length + payload.length)
            response[0] = channelBuf.length
            channelBuf.copy(response, 1)
            payload.copy(response, 1 + channelBuf.length)
            console.log('  -> Ack for ConfigData')
        } else {
            // Неизвестный — ack
            const payload = Buffer.from([0x01, 0x63])
            response = Buffer.alloc(1 + channelBuf.length + payload.length)
            response[0] = channelBuf.length
            channelBuf.copy(response, 1)
            payload.copy(response, 1 + channelBuf.length)
            console.log('  -> Ack for unknown type ' + typeInfo.value)
        }

        client.write('login_plugin_response', {
            messageId: packet.messageId,
            data: response
        })
    } else {
        console.log('#' + packet.messageId + ' ' + innerChannel + ' (len: ' + innerData.length + ')')
        client.write('login_plugin_response', {
            messageId: packet.messageId,
            data: packet.data
        })
        console.log('  -> echo')
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

setTimeout(() => { console.log('TIMEOUT after #' + requestNum); process.exit() }, 30000)
