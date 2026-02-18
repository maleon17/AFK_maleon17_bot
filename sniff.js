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

function makeWrappedResponse(channelName, payload) {
    const channelBuf = Buffer.from(channelName)
    const innerPayload = Buffer.concat([writeVarInt(payload.length), payload])
    return Buffer.concat([
        Buffer.from([channelBuf.length]),
        channelBuf,
        innerPayload
    ])
}

let requestNum = 0
let serverMods = []

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

        console.log('#' + packet.messageId + ' fml type=' + typeInfo.value + ' len=' + lenInfo.value)

        if (typeInfo.value === 5) {
            // ModList — парсим
            let offset = typeInfo.length
            const modCount = readVarInt(dataAfterLen, offset)
            offset += modCount.length

            serverMods = []
            for (let i = 0; i < modCount.value; i++) {
                const modId = readString(dataAfterLen, offset)
                offset += modId.totalLength
                const displayName = readString(dataAfterLen, offset)
                offset += displayName.totalLength
                const version = readString(dataAfterLen, offset)
                offset += version.totalLength
                serverMods.push(modId.value)
            }

            // Читаем channels после модов
            let channelCount = { value: 0, length: 1 }
            let registryCount = { value: 0, length: 1 }
            try {
                channelCount = readVarInt(dataAfterLen, offset)
                offset += channelCount.length
                console.log('  Channels: ' + channelCount.value)

                // Пропускаем channel данные
                for (let i = 0; i < channelCount.value; i++) {
                    const ch = readString(dataAfterLen, offset)
                    offset += ch.totalLength
                    const ver = readString(dataAfterLen, offset)
                    offset += ver.totalLength
                    const req = dataAfterLen[offset]
                    offset += 1
                    if (i < 5) console.log('    ch: ' + ch.value)
                }

                registryCount = readVarInt(dataAfterLen, offset)
                offset += registryCount.length
                console.log('  Registries: ' + registryCount.value)
            } catch(e) {
                console.log('  Parse error: ' + e.message)
            }

            console.log('  Mods: ' + serverMods.length)
            console.log('  -> ModListReply')

            // Ответ: type=2 + mods + 0 channels + 0 registries
            const parts = [writeVarInt(2), writeVarInt(serverMods.length)]
            for (const mod of serverMods) {
                parts.push(writeString(mod))
            }
            parts.push(writeVarInt(0)) // channels
            parts.push(writeVarInt(0)) // registries

            const payload = Buffer.concat(parts)
            const response = makeWrappedResponse('fml:handshake', payload)

            client.write('login_plugin_response', {
                messageId: packet.messageId,
                data: response
            })

        } else {
            console.log('  -> Ack')
            const payload = writeVarInt(99)
            const response = makeWrappedResponse('fml:handshake', payload)

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
            console.log('DISCONNECT after #' + requestNum + ':', reason.with[0].substring(0, 500))
        } else {
            console.log('DISCONNECT after #' + requestNum + ':', JSON.stringify(reason).substring(0, 500))
        }
    } catch(e) {
        console.log('DISCONNECT:', JSON.stringify(packet).substring(0, 500))
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
