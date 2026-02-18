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
        // Только payload, без названия канала!
        const responseData = Buffer.from([0x02])
        
        client.write('login_plugin_response', { 
            messageId: packet.messageId, 
            data: responseData 
        })
        return
    }
    
    // === 2. TACZTWEAKS HANDSHAKE ===
    if (innerChannel === 'tacztweaks:handshake') {
        console.log('[TACZTWEAKS] Отвечаем версией протокола (0x01)')
        const responseData = Buffer.from([0x01])
        
        client.write('login_plugin_response', { 
            messageId: packet.messageId, 
            data: responseData 
        })
        return
    }

    // === 3. FML HANDSHAKE ===
    if (innerChannel === 'fml:handshake' && innerData.length > 0) {
        const typeInfo = readVarInt(innerData, 0)
        const type = typeInfo.value
        
        console.log(`[FML] Packet Type: ${type}`)
        
        // Тип 5 = ModList
        if (type === 5) {
            console.log('[FML] ModList запрос. Отвечаем ЭХОМ (только payload)')
            
            // ВАЖНО: Отправляем обратно только innerData, без приклеивания канала
            client.write('login_plugin_response', { 
                messageId: packet.messageId, 
                data: innerData 
            })
            return
        }
        
        // На другие типы FML отвечаем null
        console.log('[FML] Неизвестный тип, отвечаем null')
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
    if (err.code === 'EPIPE') {
        console.log('\n❌ ERROR: EPIPE (Сервер разорвал соединение)')
    } else {
        console.log('\n❌ ERROR:', err.message)
    }
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