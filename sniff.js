const mc = require('minecraft-protocol')

const client = mc.createClient({
    host: 'donator2.gamely.pro',
    port: 30958,
    username: 'maleon17',
    version: '1.20.1',
    auth: 'offline',
    fakeHost: 'donator2.gamely.pro\0FML3\0'
})

// === Вспомогательные функции ===
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

    console.log(`\n[REQUEST #${packet.messageId}] Channel: ${innerChannel}, DataLen: ${innerData.length}`)

    // === 1. TACZ HANDSHAKE ===
    if (innerChannel === 'tacz:handshake') {
        console.log('[TACZ] Отвечаем версией протокола (0x02)')
        client.write('login_plugin_response', { 
            messageId: packet.messageId, 
            data: Buffer.from([0x02])
        })
        return
    }
    
    // === 2. TACZTWEAKS HANDSHAKE ===
    if (innerChannel === 'tacztweaks:handshake') {
        console.log('[TACZTWEAKS] Отвечаем версией протокола (0x01)')
        client.write('login_plugin_response', { 
            messageId: packet.messageId, 
            data: Buffer.from([0x01])
        })
        return
    }

    // === 3. FML HANDSHAKE ===
    if (innerChannel === 'fml:handshake' && innerData.length > 0) {
        let offset = 0
        
        // Пропускаем длину пакета
        const packetLenInfo = readVarInt(innerData, offset)
        offset += packetLenInfo.length
        
        // Читаем тип
        const typeInfo = readVarInt(innerData, offset)
        const type = typeInfo.value
        offset += typeInfo.length
        
        console.log(`[FML] Packet Type: ${type}`)
        
        if (type === 5) {
            console.log('[FML] Parsing server mod list...')
            
            // Читаем количество модов
            const modCountInfo = readVarInt(innerData, offset)
            const modCount = modCountInfo.value
            offset += modCountInfo.length
            
            console.log(`[FML] Server has ${modCount} mods`)
            
            // Парсим моды сервера
            const serverMods = []
            for (let i = 0; i < modCount && offset < innerData.length; i++) {
                const modId = readString(innerData, offset)
                offset += modId.totalLength
                
                const displayName = readString(innerData, offset)
                offset += displayName.totalLength
                
                const version = readString(innerData, offset)
                offset += version.totalLength
                
                serverMods.push({
                    id: modId.value,
                    version: version.value
                })
            }
            
            console.log(`[FML] Parsed ${serverMods.length} mods, first: ${serverMods[0]?.id}`)
            
            // Формируем ответ клиента: [тип 5] [кол-во модов] [моды: id, version]...
            // ВАЖНО: в ответе клиента НЕТ displayName!
            const responseParts = [
                writeVarInt(5),           // тип пакета
                writeVarInt(modCount)     // количество модов
            ]
            
            for (const mod of serverMods) {
                responseParts.push(writeString(mod.id))
                responseParts.push(writeString(mod.version))
            }
            
            const responsePayload = Buffer.concat(responseParts)
            
            console.log(`[FML] Sending client mod list (${responsePayload.length} bytes)`)
            
            client.write('login_plugin_response', { 
                messageId: packet.messageId, 
                data: responsePayload
            })
            return
        }
        
        // Другие типы FML
        console.log(`[FML] Type ${type}, sending null`)
        client.write('login_plugin_response', { 
            messageId: packet.messageId, 
            data: null 
        })
        return
    }

    // === 4. ВСЁ ОСТАЛЬНОЕ ===
    console.log('[OTHER] Неизвестный канал, отвечаем null')
    client.write('login_plugin_response', { 
        messageId: packet.messageId, 
        data: null 
    })
})

client.on('login', () => {
    console.log('\n✅✅✅ УСПЕХ! ЗАШЛИ НА СЕРВЕР! ✅✅✅\n')
})

client.on('disconnect', (packet) => {
    console.log('\n❌ DISCONNECT:', packet.reason?.toString().substring(0, 300) || 'Unknown')
    process.exit()
})

client.on('kick_disconnect', (packet) => {
    console.log('\n❌ KICKED:', JSON.stringify(packet).substring(0, 300))
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