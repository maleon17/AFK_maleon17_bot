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

function writeVarInt(value) {
    const bytes = []
    do {
        let b = value & 0x7F
        value >>>= 7
        if (value !== 0) b |= 0x80
        bytes.push(b)
    } while (value !== 0)
    return Buffer.from(bytes)
}

function writeString(str) {
    const buf = Buffer.from(str)
    return Buffer.concat([writeVarInt(buf.length), buf])
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
        const lenInfo = readVarInt(innerData, 0)
        const dataAfterLen = innerData.slice(lenInfo.length)
        const typeInfo = readVarInt(dataAfterLen, 0)
        
        console.log('#' + packet.messageId + ' fml:handshake type=' + typeInfo.value + ' len=' + lenInfo.value)

        let innerPayload
        const channelBuf = Buffer.from('fml:handshake')

        if (typeInfo.value === 5) {
            // ModList -> ответ type=2 (ModListReply)
            console.log('  -> ModListReply')
            
            // Формат: type(2) + varint(0 mods) + varint(0 channels) + varint(0 registries)
            const replyData = Buffer.concat([
                writeVarInt(2),    // type = ModListReply
                writeVarInt(0),    // 0 mods
                writeVarInt(0),    // 0 channels  
                writeVarInt(0)     // 0 registries
            ])
            
            innerPayload = Buffer.concat([writeVarInt(replyData.length), replyData])
            
        } else {
            // Acknowledgement для всех остальных
            console.log('  -> Ack (type ' + typeInfo.value + ')')
            
            const replyData = Buffer.concat([writeVarInt(99)]) // 99 = 0x63 = ack
            innerPayload = Buffer.concat([writeVarInt(replyData.length), replyData])
        }

        const response = Buffer.concat([
            Buffer.from([channelBuf.length]),
            channelBuf,
            innerPayload
        ])

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
