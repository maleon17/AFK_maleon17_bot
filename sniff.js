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

let requestCount = 0

client.on('login_plugin_request', (packet) => {
    requestCount++
    console.log(`\n=== REQUEST #${requestCount} (msgId=${packet.messageId}) ===`)
    
    if (!packet.data || packet.data.length === 0) {
        console.log('Empty packet, sending null')
        client.write('login_plugin_response', { 
            messageId: packet.messageId, 
            data: null 
        })
        return
    }
    
    // Парсим канал
    const nameLen = packet.data[0]
    const innerChannel = packet.data.slice(1, 1 + nameLen).toString('utf8')
    const innerData = packet.data.slice(1 + nameLen)
    
    console.log(`Channel: ${innerChannel}`)
    console.log(`Raw inner data (hex): ${innerData.slice(0, 32).toString('hex')}...`)
    console.log(`Inner data length: ${innerData.length}`)

    // === TACZ каналы - пробуем отправить успешный ответ с версией ===
    if (innerChannel === 'tacz:handshake') {
        console.log('[TACZ] Отправляем подтверждение версии')
        
        // Структура ответа: версия протокола TACZ (обычно 2 или 3)
        const versionResponse = Buffer.from([0x02]) // Версия 2
        
        const nameBuf = Buffer.from('tacz:handshake')
        const response = Buffer.concat([
            Buffer.from([nameBuf.length]),
            nameBuf,
            versionResponse
        ])
        
        client.write('login_plugin_response', { 
            messageId: packet.messageId, 
            data: response 
        })
        return
    }
    
    if (innerChannel === 'tacztweaks:handshake') {
        console.log('[TACZTWEAKS] Отправляем подтверждение версии')
        
        // Аналогично, версия протокола
        const versionResponse = Buffer.from([0x01]) // Версия 1
        
        const nameBuf = Buffer.from('tacztweaks:handshake')
        const response = Buffer.concat([
            Buffer.from([nameBuf.length]),
            nameBuf,
            versionResponse
        ])
        
        client.write('login_plugin_response', { 
            messageId: packet.messageId, 
            data: response 
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
                
                console.log(`[FML] Packet type: ${type}`)
                
                if (type === 2 || type === 5) {
                    let offset = typeInfo.length
                    const modCount = readVarInt(dataAfterLen, offset)
                    offset += modCount.length
                    
                    console.log(`[FML] Server mod count: ${modCount.value}`)
                    
                    const serverMods = []
                    for (let i = 0; i < modCount.value; i++) {
                        const modId = readString(dataAfterLen, offset)
                        offset += modId.totalLength
                        const displayName = readString(dataAfterLen, offset)
                        offset += displayName.totalLength
                        const version = readString(dataAfterLen, offset)
                        offset += version.totalLength
                        serverMods.push({ 
                            id: modId.value, 
                            display: displayName.value,
                            version: version.value 
                        })
                    }
                    
                    console.log(`[FML] Sending ModList acknowledgment`)
                    
                    // Формируем ответ - отправляем те же моды обратно
                    const replyParts = [
                        writeVarInt(type),
                        writeVarInt(serverMods.length)
                    ]
                    
                    for (const mod of serverMods) {
                        replyParts.push(writeString(mod.id))
                        replyParts.push(writeString(mod.display)) 
                        replyParts.push(writeString(mod.version))
                    }
                    
                    replyParts.push(writeVarInt(0)) // channels
                    replyParts.push(writeVarInt(0)) // registries
                    
                    const replyPayload = Buffer.concat(replyParts)
                    
                    const nameBuf = Buffer.from('fml:handshake')
                    const response = Buffer.concat([
                        Buffer.from([nameBuf.length]),
                        nameBuf,
                        writeVarInt(replyPayload.length),
                        replyPayload
                    ])
                    
                    client.write('login_plugin_response', { 
                        messageId: packet.messageId, 
                        data: response 
                    })
                } else {
                    console.log(`[FML] Unknown type ${type}, sending null`)
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

    // Все остальные каналы
    console.log(`[OTHER] Sending null for unknown channel`)
    client.write('login_plugin_response', { 
        messageId: packet.messageId, 
        data: null 
    })
})

client.on('login', () => {
    console.log('\n🎉🎉🎉 SUCCESS! LOGGED IN! 🎉🎉🎉\n')
})

client.on('disconnect', (packet) => {
    console.log('\n❌ DISCONNECT:', packet.reason ? packet.reason.substring(0, 200) : 'unknown')
    process.exit()
})

client.on('kick_disconnect', (packet) => {
    console.log('\n❌ KICKED:', JSON.stringify(packet).substring(0, 200))
    process.exit()
})

client.on('error', (err) => {
    console.log('\n❌ ERROR:', err.message)
})

client.on('end', () => { 
    console.log('\n🔌 CONNECTION ENDED')
    process.exit() 
})

// Таймаут 30 сек
setTimeout(() => { 
    console.log(`\n⏱️ TIMEOUT (после ${requestCount} запросов)`)
    process.exit() 
}, 30000)