const mc = require('minecraft-protocol')

const client = mc.createClient({
    host: 'donator2.gamely.pro',
    port: 30958,
    username: 'maleon17',
    version: '1.20.1',
    auth: 'offline',
    fakeHost: 'donator2.gamely.pro\0FML3\0'
})

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
    const buf = Buffer.from(str, 'utf8')
    return Buffer.concat([writeVarInt(buf.length), buf])
}

function readVarInt(buffer, offset) {
    let value = 0, length = 0, currentByte
    do {
        if (offset + length >= buffer.length) return { value: 0, length: 0 }
        currentByte = buffer[offset + length]
        value |= (currentByte & 0x7F) << (length * 7)
        length++
    } while ((currentByte & 0x80) !== 0 && length < 5)
    return { value, length }
}

function readString(buffer, offset) {
    const lenInfo = readVarInt(buffer, offset)
    const str = buffer.slice(offset + lenInfo.length, offset + lenInfo.length + lenInfo.value).toString('utf8')
    return { value: str, totalLength: lenInfo.length + lenInfo.value }
}

client.on('login_plugin_request', (packet) => {
    // 1. Читаем внешний канал
    const channelInfo = readString(packet.data, 0)
    const isWrapper = channelInfo.value === 'fml:loginwrapper'
    let innerChannel = channelInfo.value
    let innerData = packet.data.slice(channelInfo.totalLength)

    // 2. Если обертка, ныряем глубже
    if (isWrapper) {
        const wrapLenInfo = readVarInt(innerData, 0)
        const wrappedData = innerData.slice(wrapLenInfo.length, wrapLenInfo.length + wrapLenInfo.value)
        const innerChannelInfo = readString(wrappedData, 0)
        innerChannel = innerChannelInfo.value
        innerData = wrappedData.slice(innerChannelInfo.totalLength)
    }

    console.log(`[REQUEST] Channel: ${innerChannel} (Wrapped: ${isWrapper})`)

    // Функция для сборки ответа
    function sendReply(payload) {
        // Собираем внутренний пакет: [String channel][Payload]
        const innerPacket = Buffer.concat([
            writeString(innerChannel),
            payload
        ])

        // Если была обертка, упаковываем обратно в fml:loginwrapper
        let finalData
        if (isWrapper) {
            finalData = Buffer.concat([
                writeString('fml:loginwrapper'),
                writeVarInt(innerPacket.length),
                innerPacket
            ])
        } else {
            finalData = innerPacket
        }

        client.write('login_plugin_response', {
            messageId: packet.messageId,
            data: finalData
        })
    }

    // --- ЛОГИКА ОТВЕТОВ (на основе логов друга) ---

    if (innerChannel === 'tacz:handshake') {
        sendReply(Buffer.from([0x01, 0x01])) 
    } 
    else if (innerChannel === 'tacztweaks:handshake') {
        sendReply(Buffer.from([0x01]))
    }
    else if (innerChannel === 'fml:handshake') {
        const typeInfo = readVarInt(innerData, 0)
        if (typeInfo.value === 5) {
            // Разбираем список сервера
            let offset = typeInfo.length
            const modCountInfo = readVarInt(innerData, offset)
            offset += modCountInfo.length

            const mods = []
            for (let i = 0; i < modCountInfo.value; i++) {
                const id = readString(innerData, offset); offset += id.totalLength
                const disp = readString(innerData, offset); offset += disp.totalLength
                const ver = readString(innerData, offset); offset += ver.totalLength
                mods.push({ id: id.value, ver: ver.value })
            }

            // Формируем ответ: тип 2, список [id][ver] и 00 в конце
            const parts = [writeVarInt(2), writeVarInt(mods.length)]
            for (const m of mods) {
                parts.push(writeString(m.id), writeString(m.ver))
            }
            parts.push(Buffer.from([0x00]))
            
            console.log(`[FML] Sending mod list reply (Type 2, Mods: ${mods.length})`)
            sendReply(Buffer.concat(parts))
        } else {
            // На все остальные типы (4, 6, 7... 44) клиент отвечает 01 63
            sendReply(Buffer.from([0x01, 0x63]))
        }
    } else {
        client.write('login_plugin_response', { messageId: packet.messageId, data: null })
    }
})

client.on('login', () => console.log('\n✅✅✅ ВЫ В ИГРЕ! ✅✅✅'))
client.on('disconnect', (p) => console.log('Kick:', p.reason))
client.on('error', (e) => console.log('Error:', e))
