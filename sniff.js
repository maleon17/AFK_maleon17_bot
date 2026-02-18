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
    if (lenInfo.length === 0) return { value: '', totalLength: 0 }
    const str = buffer.slice(offset + lenInfo.length, offset + lenInfo.length + lenInfo.value).toString('utf8')
    return { value: str, totalLength: lenInfo.length + lenInfo.value }
}

client.on('login_plugin_request', (packet) => {
    console.log(`\n=== login_plugin_request #${packet.messageId} ===`)
    console.log('RAW data (hex):', packet.data ? packet.data.slice(0, 64).toString('hex') : 'null')
    console.log('DATA length:', packet.data ? packet.data.length : 0)
    
    let innerChannel = ''
    let innerData = Buffer.alloc(0)

    if (packet.data && packet.data.length > 0) {
        const nameLen = packet.data[0]
        innerChannel = packet.data.slice(1, 1 + nameLen).toString('utf8')
        innerData = packet.data.slice(1 + nameLen)
    }

    console.log(`[HANDSHAKE] Channel: "${innerChannel}", DataLen: ${innerData.length}`)

    // === TACZ каналы - отправляем NULL вместо эха ===
    if (innerChannel === 'tacz:handshake' || innerChannel === 'tacztweaks:handshake') {
        console.log('[TACZ] Отправляем NULL ответ')
        client.write('login_plugin_response', { 
            messageId: packet.messageId, 
            data: null 
        })
        return
    }

    // === FML Handshake ===
    if (innerChannel === 'fml:handshake') {
        if (innerData.length > 0) {
            const lenInfo = readVarInt(innerData, 0)
            const dataAfterLen = innerData.slice(lenInfo.length)
            
            if (dataAfterLen.length > 0) {
                const typeInfo = readVarInt(dataAfterLen, 0)
                const type = typeInfo.value
                
                console.log(`[FML] Тип пакета: ${type}`)
                
                // Тип 2 - это ModList от сервера, клиент должен ответить своим ModList (тип 2)
                // Тип 5 - запрос версии/подтверждения
                if (type === 2 || type === 5) {
                    console.log(`[FML] Сервер запрашивает список модов (type=${type})`)
                    
                    // Читаем количество модов из запроса сервера
                    let offset = typeInfo.length
                    const modCount = readVarInt(dataAfterLen, offset)
                    offset += modCount.length
                    
                    console.log(`[FML] Количество модов на сервере: ${modCount.value}`)
                    
                    // Читаем и логируем моды
                    const serverMods = []
                    for (let i = 0; i < modCount.value; i++) {
                        const modId = readString(dataAfterLen, offset)
                        offset += modId.totalLength
                        const displayName = readString(dataAfterLen, offset)
                        offset += displayName.totalLength
                        const version = readString(dataAfterLen, offset)
                        offset += version.totalLength
                        serverMods.push({ id: modId.value, version: version.value })
                        console.log(`  Мод: ${modId.value} (${version.value})`)
                    }
                    
                    // Формируем ответ - отправляем ТОЛЬКО ID модов (без displayName и version)
                    // Это ключевое отличие!
                    const replyParts = [
                        writeVarInt(type), // Тот же тип
                        writeVarInt(serverMods.length) // Количество
                    ]
                    
                    for (const mod of serverMods) {
                        replyParts.push(writeString(mod.id)) // Только ID, без версии и displayName
                    }
                    
                    // В конце два пустых варинта (checksums)
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
                    
                    console.log(`[FML] Ответ отправлен (payload: ${replyPayload.length} байт)`)
                    
                    client.write('login_plugin_response', { 
                        messageId: packet.messageId, 
                        data: response 
                    })
                } else {
                    console.log(`[FML] Неизвестный тип ${type}, отправляем null`)
                    client.write('login_plugin_response', { 
                        messageId: packet.messageId, 
                        data: null 
                    })
                }
            } else {
                client.write('login_plugin_response', { 
                    messageId: packet.messageId, 
                    data: null 
                })
            }
        } else {
            client.write('login_plugin_response', { 
                messageId: packet.messageId, 
                data: null 
            })
        }
        return
    }

    // === Все остальные каналы - null ===
    console.log(`[OTHER] Игнорируем канал: ${innerChannel}`)
    client.write('login_plugin_response', { 
        messageId: packet.messageId, 
        data: null 
    })
})

client.on('login', () => {
    console.log('\n*** SUCCESS! БОТ ЗАШЁЛ НА СЕРВЕР! ***\n')
})

client.on('disconnect', (packet) => {
    try {
        const reason = JSON.parse(packet.reason)
        if (reason.with) {
            console.log('\n❌ DISCONNECT:', reason.with[0]?.substring?.(0, 500) || JSON.stringify(reason))
        } else if (reason.translate) {
            console.log('\n❌ DISCONNECT:', reason.translate)
        } else {
            console.log('\n❌ DISCONNECT:', JSON.stringify(reason).substring(0, 500))
        }
    } catch(e) {
        console.log('\n❌ DISCONNECT:', JSON.stringify(packet).substring(0, 500))
    }
    process.exit()
})

client.on('kick_disconnect', (packet) => {
    console.log('\n❌ KICKED:', JSON.stringify(packet).substring(0, 500))
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