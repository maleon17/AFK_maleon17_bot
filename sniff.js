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

// Keep-alive: отвечаем серверу, чтобы не кикало по таймауту
client.on('keep_alive', (packet) => {
    lastKeepAlive = Date.now()
    try {
        client.write('keep_alive', { id: packet.id })
        console.log('[KEEPALIVE] Ответ отправлен, id =', packet.id)
    } catch (e) {
        console.log('[KEEPALIVE] Ошибка отправки:', e.message)
    }
})

// Проверка таймаута keep_alive (логирование)
setInterval(() => {
    if (Date.now() - lastKeepAlive > 15000) {
        console.log('[WARN] Keep alive timeout — сервер долго не шлёт keep_alive')
    }
}, 10000)

// Автореспаун при смерти
client.on('update_health', (packet) => {
    if (packet.health <= 0) {
        console.log('[DEATH] Бот умер (HP <= 0), респаун через 1с...')
        setTimeout(() => {
            try {
                client.write('client_command', { actionId: 0 }) // Респаун
                console.log('[DEATH] Команда респауна отправлена')
            } catch (e) {
                console.log('[DEATH] Ошибка отправки респауна:', e.message)
            }
        }, 1000)
    }
})

// Основной обработчик login_plugin_request
client.on('login_plugin_request', (packet) => {
    console.log(`\n=== login_plugin_request #${packet.messageId} ===`)
    console.log('RAW data (hex):', packet.data ? packet.data.slice(0, 32).toString('hex') : 'null')
    console.log('DATA length:', packet.data ? packet.data.length : 0)
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

        // Обрабатываем type=5 (ModList/Config) — отправляем полную структуру
        if (type === 5) {
            let offset = typeInfo.length
            const modCount = readVarInt(dataAfterLen, offset)
            offset += modCount.length

            console.log(`[FML] Сервер запрашивает список модов (count=${modCount.value})`)

            const mods = []
            for (let i = 0; i < modCount.value; i++) {
                const modId = readString(dataAfterLen, offset)
                offset += modId.totalLength
                const displayName = readString(dataAfterLen, offset)
                offset += displayName.totalLength
                const version = readString(dataAfterLen, offset)
                offset += version.totalLength
                mods.push({
                    modId: modId.value,
                    displayName: displayName.value,
                    version: version.value
                })
            }

            // Читаем оставшиеся данные (обычно 2 VarInt в конце)
            const trailingData = dataAfterLen.slice(offset)
            const trailing1 = readVarInt(trailingData, 0)
            const trailing2 = readVarInt(trailingData, trailing1.length)

            // Формируем ответ, повторяя структуру запроса
            const replyParts = [writeVarInt(5), writeVarInt(mods.length)]
            for (const mod of mods) {
                replyParts.push(writeString(mod.modId))
                replyParts.push(writeString(mod.displayName))
                replyParts.push(writeString(mod.version))
            }
            replyParts.push(writeVarInt(trailing1.value))
            replyParts.push(writeVarInt(trailing2.value))

            const replyPayload = Buffer.concat(replyParts)
            const nameBuf = Buffer.from('fml:handshake')
            const response = Buffer.concat([
                Buffer.from([nameBuf.length]),
                nameBuf,
                writeVarInt(replyPayload.length),
                replyPayload
            ])

            client.write('login_plugin_response', { messageId: packet.messageId, data: response })
            console.log('[FML] Полный ответ с тремя полями для каждого мода отправлен')
        } else {
            // Для других типов fml просто отправляем null
            console.log(`[FML] Необработанный тип ${type}, отправляем null`)
            client.write('login_plugin_response', { messageId: packet.messageId, data: null })
        }

    // TACZ Handshake — эхо
    } else if (innerChannel === 'tacz:handshake' || innerChannel === 'tacztweaks:handshake') {
        console.log(`[TACZ] Эхо-ответ на ${innerChannel}`)
        client.write('login_plugin_response', { messageId: packet.messageId, data: packet.data })

    // Остальные каналы — игнорируем (null)
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