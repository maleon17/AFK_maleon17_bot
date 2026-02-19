const mc = require('minecraft-protocol')

const client = mc.createClient({
    host: 'donator2.gamely.pro',
    port: 30958,
    username: 'maleon17',
    version: '1.20.1',
    auth: 'offline',
    fakeHost: 'donator2.gamely.pro\0FML3\0'
})

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

function readString(buffer, offset) {
    const lenInfo = readVarInt(buffer, offset)
    if (lenInfo.length === 0) return { value: '', totalLength: 0 }
    const str = buffer.slice(offset + lenInfo.length, offset + lenInfo.length + lenInfo.value).toString('utf8')
    return { value: str, totalLength: lenInfo.length + lenInfo.value }
}

function writeString(str) {
    const buf = Buffer.from(str, 'utf8')
    return Buffer.concat([writeVarInt(buf.length), buf])
}

client.on('login_plugin_request', (packet) => {
    let innerChannel = ''
    let innerData = Buffer.alloc(0)

    if (packet.data && packet.data.length > 0) {
        const nameLen = packet.data[0]
        innerChannel = packet.data.slice(1, 1 + nameLen).toString('utf8')
        innerData = packet.data.slice(1 + nameLen)
    }

    console.log(`\n[REQUEST #${packet.messageId}] Channel: ${innerChannel}`)

    // Из лога прокси:
    // Весь пакет: 02 00 01 0e [tacz:handshake] 01 01
    // 02 = packet id (добавляет библиотека)
    // 00 = messageId (добавляет библиотека)
    // 01 = success flag (добавляет библиотека если data != null)
    // 0e [tacz:handshake] = ЧАСТЬ PAYLOAD
    // 01 01 = остаток payload
    //
    // Значит data = [0e][tacz:handshake][01][01]
    // То есть в data идет: [длина канала][канал][payload]

    function reply(payload) {
        // data = [channelLen (1 байт)][channel][payload]
        const channelBuf = Buffer.from(innerChannel, 'utf8')
        const data = Buffer.concat([
            Buffer.from([channelBuf.length]),
            channelBuf,
            payload
        ])
        client.write('login_plugin_response', {
            messageId: packet.messageId,
            data: data
        })
        console.log(`[SENT] ${innerChannel} -> hex: ${data.toString('hex')}`)
    }

    function replyNull() {
        client.write('login_plugin_response', {
            messageId: packet.messageId,
            data: null
        })
        console.log(`[SENT] null`)
    }

    // === TACZ ===
    // Из прокси лога: payload после канала = 01 01
    if (innerChannel === 'tacz:handshake') {
        reply(Buffer.from([0x01, 0x01]))
        return
    }

    // === TACZTWEAKS ===
    // Из прокси лога нет отдельного ответа для tacztweaks, 
    // но судя по структуре попробуем 01
    if (innerChannel === 'tacztweaks:handshake') {
        reply(Buffer.from([0x01]))
        return
    }

    // === FML HANDSHAKE ===
    if (innerChannel === 'fml:handshake' && innerData.length > 0) {
        let offset = 0

        // Пропускаем длину пакета
        const packetLenInfo = readVarInt(innerData, offset)
        offset += packetLenInfo.length

        // Тип пакета
        const typeInfo = readVarInt(innerData, offset)
        const type = typeInfo.value
        offset += typeInfo.length

        console.log(`[FML] Type: ${type}`)

        if (type === 5) {
            // ModList
            const modCountInfo = readVarInt(innerData, offset)
            const modCount = modCountInfo.value
            offset += modCountInfo.length

            console.log(`[FML] Mods: ${modCount}`)

            const mods = []
            for (let i = 0; i < modCount && offset < innerData.length; i++) {
                const modId = readString(innerData, offset)
                offset += modId.totalLength
                const displayName = readString(innerData, offset)
                offset += displayName.totalLength
                const version = readString(innerData, offset)
                offset += version.totalLength
                mods.push({ id: modId.value, version: version.value })
            }

            // Формируем payload ответа
            // Из лога прокси большой ответ начинается с f218025c...
            // f2 18 = VarInt (длина?) ... 02 = тип? 5c = count (92)?
            // Нет, давай разберем:
            // f218 = VarInt = (0x12 << 7) | (0x72) = ... = 3058? Нет.
            // f2 = 1111 0010, старший бит 1 -> продолжение
            // 18 = 0001 1000, старший бит 0 -> конец
            // value = (0x72) | (0x18 << 7) = 114 | 3072 = 3186? Нет.
            // f2 & 0x7F = 0x72 = 114
            // 18 & 0x7F = 0x18 = 24
            // value = 114 | (24 << 7) = 114 | 3072 = 3186
            // Это длина остатка пакета (3186 байт)?
            // После f218: 02 = тип 2? Нет, type должен быть 5...
            // 02 5c = тип 2, количество 92?
            // Похоже клиент шлет тип 2 в ответ на тип 5!
            // А 5c = 92 = количество модов (88 сервера + 4 своих?)
            //
            // Итого структура ответного payload:
            // [VarInt: длина остатка] [VarInt: тип=2] [VarInt: count] [modid][version]...

            const innerParts = [
                writeVarInt(2),           // тип ответа = 2 (не 5!)
                writeVarInt(mods.length)
            ]
            for (const mod of mods) {
                innerParts.push(writeString(mod.id))
                innerParts.push(writeString(mod.version))
            }
            const innerBuf = Buffer.concat(innerParts)

            // Оборачиваем в [VarInt: длина][данные]
            const payload = Buffer.concat([
                writeVarInt(innerBuf.length),
                innerBuf
            ])

            reply(payload)
            return
        }

        // Остальные типы FML (регистры и т.д.)
        // Из лога прокси: Response = 01 63
        // Значит payload = 63
        // Но у нас reply() добавит канал, поэтому payload просто:
        // Стоп. Давай пересмотрим.
        // Весь пакет (из прокси): 02 04 01 0d [fml:handshake] 01 63
        // data (что мы передаем): 0d [fml:handshake] 01 63
        // payload (после канала): 01 63
        // Значит для остальных типов FML payload = 01 63
        reply(Buffer.from([0x01, 0x63]))
        return
    }

    // Всё остальное
    replyNull()
})

client.on('login', () => {
    console.log('\n✅✅✅ УСПЕХ! ✅✅✅')
})

client.on('disconnect', (packet) => {
    console.log('\n❌ DISCONNECT:', packet.reason?.toString().substring(0, 300))
    process.exit()
})

client.on('error', (err) => {
    console.log('\n❌ ERROR:', err.message)
    process.exit()
})

client.on('end', () => {
    console.log('\n🔌 DISCONNECTED')
    process.exit()
})

setTimeout(() => {
    console.log('\n⏱️ TIMEOUT')
    process.exit()
}, 30000)
