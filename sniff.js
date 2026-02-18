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

function readString(buffer, offset) {
    const lenInfo = readVarInt(buffer, offset)
    const str = buffer.slice(offset + lenInfo.length, offset + lenInfo.length + lenInfo.value).toString('utf8')
    return { value: str, totalLength: lenInfo.length + lenInfo.value }
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
        
        console.log('#' + packet.messageId + ' fml:handshake type=' + typeInfo.value)

        if (typeInfo.value === 5) {
            // Парсим ModList
            let offset = typeInfo.length
            
            // Количество модов
            const modCount = readVarInt(dataAfterLen, offset)
            offset += modCount.length
            console.log('  Mod count: ' + modCount.value)
            
            const mods = []
            for (let i = 0; i < modCount.value; i++) {
                // modId
                const modId = readString(dataAfterLen, offset)
                offset += modId.totalLength
                // displayName
                const displayName = readString(dataAfterLen, offset)
                offset += displayName.totalLength
                // version
                const version = readString(dataAfterLen, offset)
                offset += version.totalLength
                
                mods.push(modId.value)
                if (i < 60) {
                    console.log('  ' + modId.value + ' (' + version.value + ')')
                }
            }

            console.log('\n  -> ModListReply with ' + mods.length + ' mods')

            // Ответ: type=2 + кол-во модов + modId строки + 0 channels + 0 registries
            const channelBuf = Buffer.from('fml:handshake')
            const parts = [writeVarInt(2), writeVarInt(mods.length)]
            for (const mod of mods) {
                parts.push(writeString(mod))
            }
            parts.push(writeVarInt(0))
            parts.push(writeVarInt(0))

            const replyData = Buffer.concat(parts)
            const innerPayload = Buffer.concat([writeVarInt(replyData.length), replyData])
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
            console.log('  -> Ack')
            const channelBuf = Buffer.from('fml:handshake')
            const replyData = writeVarInt(99)
            const innerPayload = Buffer.concat([writeVarInt(replyData.length), replyData])
            const response = Buffer.concat([
                Buffer.from([channelBuf.length]),
                channelBuf,
                innerPayload
            ])
            client.write('login_plugin_response', {
                messageId: packet.messageId,
                data: response
            })
        }
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
