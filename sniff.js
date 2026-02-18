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
    console.log('#' + packet.messageId + ' ' + innerChannel + ' (len: ' + innerData.length + ')')

    if (innerChannel === 'fml:handshake') {
        const lenInfo = readVarInt(innerData, 0)
        const dataAfterLen = innerData.slice(lenInfo.length)
        const typeInfo = readVarInt(dataAfterLen, 0)

        console.log('  fml type=' + typeInfo.value)

        if (typeInfo.value === 5) {
            let offset = typeInfo.length
            const modCount = readVarInt(dataAfterLen, offset)
            offset += modCount.length

            const mods = []
            for (let i = 0; i < modCount.value; i++) {
                const modId = readString(dataAfterLen, offset)
                offset += modId.totalLength
                const displayName = readString(dataAfterLen, offset)
                offset += displayName.totalLength
                const version = readString(dataAfterLen, offset)
                offset += version.totalLength
                mods.push(modId.value)
            }

            console.log('  Mods: ' + mods.length)

            // Внутренний payload: type(1) + modCount + modIds + channels(0) + registries(0)
            const replyParts = [writeVarInt(5), writeVarInt(mods.length)]
            for (const mod of mods) {
                replyParts.push(writeString(mod))
            }
            replyParts.push(writeVarInt(0))
            replyParts.push(writeVarInt(0))
            const replyPayload = Buffer.concat(replyParts)

            // Формат как у сервера: nameLen(1 byte) + name + varint(payloadLen) + payload
            const nameBuf = Buffer.from('fml:handshake')
            const response = Buffer.concat([
                Buffer.from([nameBuf.length]),
                nameBuf,
                writeVarInt(replyPayload.length),
                replyPayload
            ])

            console.log('  -> ModListReply')
            console.log('  server format: ' + packet.data.slice(0, 20).toString('hex'))
            console.log('  our   format: ' + response.slice(0, 20).toString('hex'))

            client.write('login_plugin_response', { messageId: packet.messageId, data: response })

        } else {
            // Ack: nameLen + name + varint(1) + type(2)
            const nameBuf = Buffer.from('fml:handshake')
            const ackPayload = writeVarInt(2)
            const response = Buffer.concat([
                Buffer.from([nameBuf.length]),
                nameBuf,
                writeVarInt(ackPayload.length),
                ackPayload
            ])
            console.log('  -> Ack')
            client.write('login_plugin_response', { messageId: packet.messageId, data: response })
        }
    } else if (innerChannel === 'tacz:handshake' || innerChannel === 'tacztweaks:handshake') {
        console.log('  -> echo')
        client.write('login_plugin_response', { messageId: packet.messageId, data: packet.data })
    }
})

client.on('login', () => {
    console.log('\n*** SUCCESS! ***')
})

client.on('disconnect', (packet) => {
    try {
        const reason = JSON.parse(packet.reason)
        if (reason.with) {
            console.log('\nDISCONNECT:', reason.with[0].substring(0, 500))
        } else if (reason.translate) {
            console.log('\nDISCONNECT:', reason.translate)
        } else {
            console.log('\nDISCONNECT:', JSON.stringify(reason).substring(0, 500))
        }
    } catch(e) {
        console.log('\nDISCONNECT:', JSON.stringify(packet).substring(0, 500))
    }
    process.exit()
})

client.on('kick_disconnect', (packet) => {
    console.log('KICKED:', JSON.stringify(packet).substring(0, 500))
    process.exit()
})

client.on('error', (err) => console.log('ERROR:', err.message))
client.on('end', () => { console.log('DISCONNECTED'); process.exit() })

setTimeout(() => { console.log('TIMEOUT after #' + requestNum); process.exit() }, 30000)
