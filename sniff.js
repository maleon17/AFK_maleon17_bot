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

// Отправка ответа через fml:loginwrapper
function sendWrapperResponse(packet, innerChannel, innerPayload) {
    const channelBuf = Buffer.from(innerChannel, 'utf8')
    // Формат: [Длина канала][Канал][Данные]
    const responseData = Buffer.concat([
        Buffer.from([channelBuf.length]),
        channelBuf,
        innerPayload
    ])
    
    client.write('login_plugin_response', {
        messageId: packet.messageId,
        success: true,
        data: responseData
    })
    console.log(`[SENT] ${innerChannel} response (${responseData.length} bytes)`)
}

// Отправка null-ответа (success=false)
function sendNullResponse(packet) {
    client.write('login_plugin_response', {
        messageId: packet.messageId,
        success: false
    })
    console.log(`[SENT] Null response`)
}

client.on('login_plugin_request', (packet) => {
    console.log(`\n[REQUEST #${packet.messageId}] Channel: ${packet.channel}`)
    
    // packet.data уже содержит данные после названия канала
    // Для fml:loginwrapper в packet.data будет: [Длина][ВнутреннийКанал][Данные]
    
    let innerChannel = ''
    let innerData = Buffer.alloc(0)
    
    if (packet.data && packet.data.length > 0) {
        const nameLen = packet.data[0]
        if (nameLen < packet.data.length) {
            innerChannel = packet.data.slice(1, 1 + nameLen).toString('utf8')
            innerData = packet.data.slice(1 + nameLen)
            console.log(`[WRAPPER] Inner channel: ${innerChannel}, DataLen: ${innerData.length}`)
        }
    }

    // === 1. TACZ HANDSHAKE ===
    if (innerChannel === 'tacz:handshake') {
        // Из логов прокси: 01 01
        sendWrapperResponse(packet, 'tacz:handshake', Buffer.from([0x01, 0x01]))
        return
    }
    
    // === 2. TACZTWEAKS HANDSHAKE ===
    if (innerChannel === 'tacztweaks:handshake') {
        // Из логов: просто 01 (или 01 01?)
        sendWrapperResponse(packet, 'tacztweaks:handshake', Buffer.from([0x01]))
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
            console.log('[FML] ModList request, generating response...')
            
            // Парсим список модов сервера (ID, DisplayName, Version)
            const modCountInfo = readVarInt(innerData, offset)
            const modCount = modCountInfo.value
            offset += modCountInfo.length
            
            const serverMods = []
            for (let i = 0; i < modCount && offset < innerData.length; i++) {
                const modId = readString(innerData, offset)
                offset += modId.totalLength
                const displayName = readString(innerData, offset) // Пропускаем
                offset += displayName.totalLength
                const version = readString(innerData, offset)
                offset += version.totalLength
                
                serverMods.push({ id: modId.value, version: version.value })
            }
            
            // Формируем ответ клиента: [Type 5] [Count] [ID][Version]... [0] [0]
            const parts = [
                writeVarInt(5),
                writeVarInt(serverMods.length)
            ]
            
            for (const mod of serverMods) {
                parts.push(writeString(mod.id))
                parts.push(writeString(mod.version))
            }
            
            // Два нуля в конце (пустые списки каналов/реестров)
            parts.push(writeVarInt(0))
            parts.push(writeVarInt(0))
            
            const payload = Buffer.concat(parts)
            sendWrapperResponse(packet, 'fml:handshake', payload)
            return
        }
        
        // Для остальных типов FML отправляем "успех" с минимальными данными
        // Из логов прокси: 01 63 (или просто подтверждение)
        sendWrapperResponse(packet, 'fml:handshake', Buffer.from([0x63]))
        return
    }

    // Всё остальное
    sendNullResponse(packet)
})

client.on('login', () => {
    console.log('\n✅✅✅ УСПЕХ! ЗАШЛИ НА СЕРВЕР! ✅✅✅\n')
})

client.on('disconnect', (packet) => {
    console.log('\n❌ DISCONNECT:', packet.reason?.toString().substring(0, 300) || 'Unknown')
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
