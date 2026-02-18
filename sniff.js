const mc = require('minecraft-protocol')

const client = mc.createClient({
    host: 'donator2.gamely.pro',
    port: 30958,
    username: 'maleon17',
    version: '1.20.1',
    auth: 'offline',
    fakeHost: 'donator2.gamely.pro\0FML3\0'
})

// Утилиты для варинтов и строк
function readVarInt(buffer, offset) {
    let value = 0
    let length = 0
    let currentByte
    do {
        if (offset + length >= buffer.length) return { value: 0, length: 0 }
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
    const buf = Buffer.from(str, 'utf8')
    return Buffer.concat([writeVarInt(buf.length), buf])
}

function readString(buffer, offset) {
    const lenInfo = readVarInt(buffer, offset)
    if (lenInfo.length === 0 || offset + lenInfo.length + lenInfo.value > buffer.length) {
        return { value: '', totalLength: 0 }
    }
    const str = buffer.slice(offset + lenInfo.length, offset + lenInfo.length + lenInfo.value).toString('utf8')
    return { value: str, totalLength: lenInfo.length + lenInfo.value }
}

let requestNum = 0
let lastKeepAlive = Date.now()

// Обработка keep_alive (важно для 1.20.1)
client.on('keep_alive', (packet) => {
    lastKeepAlive = Date.now()
    client.write('keep_alive', { id: packet.id })
    console.log('[KEEPALIVE] Ответ отправлен')
})

// Проверка таймаута keep_alive
setInterval(() => {
    if (Date.now() - lastKeepAlive > 15000) {
        console.log('[WARN] Keep alive timeout, возможно сервер не отвечает')
    }
}, 10000)

// Автореспаун при смерти
client.on('update_health', (packet) => {
    if (packet.health <= 0) {
        console.log('[DEATH] Бот умер, респаун...')
        setTimeout(() => {
            client.write('client_command', { actionId: 0 }) // Респаун
        }, 1000)
    }
})

// Основной обработчик login_plugin_request
client.on('login_plugin_request', (packet) => {
    let innerChannel = ''
    let innerData = Buffer.alloc(0)

    if (packet.data && packet.data.length > 0) {
        try {
            const nameLen = packet.data[0]
            innerChannel = packet.data.slice(1, 1 + nameLen).toString('utf8')
            innerData = packet.data.slice(1 + nameLen)
        } catch (e) {
            console.log('Ошибка парсинга канала handshake:', e.message)
            client.write('login_plugin_response', { messageId: packet.messageId, data: null })
            return
        }
    }

    console.log(`[HANDSHAKE #${packet.messageId}] Channel: "${innerChannel}", DataLen: ${innerData.length}`)

    // FML Handshake
    if (innerChannel === 'fml:handshake') {
        if (innerData.length === 0) {
            console.log('[FML] Пустой пакет, отправляем null')
            client.write('login_plugin_response', { messageId: packet.messageId, data: null })
            return
        }

        const lenInfo = readVarInt(innerData, 0)
        const dataAfterLen = innerData.slice(lenInfo.length)

        if (dataAfterLen.length === 0) {
            console.log('[FML] Нет данных после длины, отправляем null')
            client.write('login_plugin_response', { messageId: packet.messageId, data: null })
            return
        }

        const typeInfo = readVarInt(dataAfterLen, 0)
        const type = typeInfo.value
        console.log(`[FML] Тип пакета: ${type}`)

        // Обрабатываем только тип 5 (ModList) и другие распространённые
        if (type === 5) {
            let offset = typeInfo.length
            const modCount = readVarInt(dataAfterLen, offset)
            offset += modCount.length

            console.log(`[FML] Сервер запрашивает список модов (count=${modCount.value})`)

            const replyParts = [writeVarInt(5), writeVarInt(modCount.value)]

            for (let i = 0; i < modCount.value; i++) {
                const modId = readString(dataAfterLen, offset)
                offset += modId.totalLength
                const displayName = readString(dataAfterLen, offset)
                offset += displayName.totalLength
                const version = readString(dataAfterLen, offset)
                offset += version.totalLength

                console.log(`  Мод: ${modId.value} (${version.value})`)
                replyParts.push(writeString(modId.value))
            }

            // Завершающие данные (обычно 2 варинта)
            replyParts.push(writeVarInt(0))
            replyParts.push(writeVarInt(0))

            const replyPayload = Buffer.concat(replyParts)
            const nameBuf = Buffer.from('fml:handshake')
            const response = Buffer.concat([
                Buffer.from([nameBuf.length]),
                nameBuf,
                writeVarInt(replyPayload.length),
                replyPayload
            ])

            client.write('login_plugin_response', { messageId: packet.messageId, data: response })
            console.log('[FML] Ответ отправлен')
        } else if (type === 2 || type === 3 || type === 4 || type === 6 || type === 7) {
            // Для других типов просто отправляем null или эхо структуры
            console.log(`[FML] Неизвестный тип ${type}, отправляем null`)
            client.write('login_plugin_response', { messageId: packet.messageId, data: null })
        } else {
            client.write('login_plugin_response', { messageId: packet.messageId, data: null })
        }

    // TACZ Handshake
    } else if (innerChannel === 'tacz:handshake' || innerChannel === 'tacztweaks:handshake') {
        console.log(`[TACZ] Эхо-ответ на ${innerChannel}`)
        client.write('login_plugin_response', { messageId: packet.messageId, data: packet.data })

    // Другие каналы (возможно, сервер их не требует, но лучше логировать)
    } else {
        console.log(`[OTHER] Игнорируем канал: ${innerChannel}`)
        client.write('login_plugin_response', { messageId: packet.messageId, data: null })
    }
})

// События клиента
client.on('login', () => {
    console.log('\n✅ SUCCESS! Бот вошёл на сервер')
})

client.on('disconnect', (packet) => {
    try {
        const reason = JSON.parse(packet.reason)
        if (reason.with && reason.with[0]) {
            console.log('\n❌ DISCONNECT:', reason.with[0].substring(0, 500))
        } else if (reason.translate) {
            console.log('\n❌ DISCONNECT:', reason.translate)
        } else {
            console.log('\n❌ DISCONNECT:', JSON.stringify(reason).substring(0, 500))
        }
    } catch(e) {
        console.log('\n❌ DISCONNECT (raw):', packet.reason ? packet.reason.toString().substring(0, 500) : 'No reason')
    }
    process.exit()
})

client.on('kick_disconnect', (packet) => {
    console.log('❌ KICKED:', JSON.stringify(packet).substring(0, 500))
    process.exit()
})

client.on('error', (err) => {
    console.log('🔴 ERROR:', err.message)
})

client.on('end', () => {
    console.log('🔌 Отключён от сервера')
    process.exit()
})

// Таймаут
setTimeout(() => {
    console.log(`⏱️ TIMEOUT after ${requestNum} handshake requests`)
    process.exit()
}, 30000)