const mc = require('minecraft-protocol')

const client = mc.createClient({
    host: 'donator2.gamely.pro',
    port: 30958,
    username: 'maleon17',
    version: '1.20.1',
    auth: 'offline',
    fakeHost: 'donator2.gamely.pro\0FML3\0'
})

// === Вспомогательные функции (оставляем как есть) ===
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

client.on('login_plugin_request', (packet) => {
    let innerChannel = ''
    let innerData = Buffer.alloc(0)

    if (packet.data && packet.data.length > 0) {
        const nameLen = packet.data[0]
        innerChannel = packet.data.slice(1, 1 + nameLen).toString('utf8')
        innerData = packet.data.slice(1 + nameLen)
    }

    // console.log(`[HANDSHAKE] Channel: ${innerChannel}`) // Раскомментируй для отладки

    // === 1. TACZ & TACZTWEAKS ===
    if (innerChannel === 'tacz:handshake') {
        // Отправляем просто байт 0x02 (версия протокола)
        const res = Buffer.concat([
            Buffer.from([0x02]) 
        ])
        const full = Buffer.concat([
            Buffer.from([innerChannel.length]),
            Buffer.from(innerChannel),
            res
        ])
        client.write('login_plugin_response', { messageId: packet.messageId, data: full })
        return
    }
    
    if (innerChannel === 'tacztweaks:handshake') {
        // Отправляем просто байт 0x01
        const res = Buffer.concat([Buffer.from([0x01])])
        const full = Buffer.concat([
            Buffer.from([innerChannel.length]),
            Buffer.from(innerChannel),
            res
        ])
        client.write('login_plugin_response', { messageId: packet.messageId, data: full })
        return
    }

    // === 2. FML HANDSHAKE (САМОЕ ВАЖНОЕ) ===
    if (innerChannel === 'fml:handshake' && innerData.length > 0) {
        // Читаем тип пакета
        const typeInfo = readVarInt(innerData, 0)
        const type = typeInfo.value
        
        // Тип 5 = ModList. Это то, что нам нужно.
        if (type === 5) {
            console.log(`[FML] Получен ModList (Type 5). Просто эхом отправляем обратно...`)
            
            // МАГИЯ: Просто отправляем обратно ТЕ ЖЕ САМЫЕ БАЙТЫ, которые прислал сервер.
            // Не парсим, не собираем. Просто копипаст.
            const response = Buffer.concat([
                Buffer.from([innerChannel.length]),
                Buffer.from(innerChannel),
                innerData // <--- ВОТ ОНО
            ])
            
            client.write('login_plugin_response', { 
                messageId: packet.messageId, 
                data: response 
            })
            return
        }
    }

    // === 3. ВСЁ ОСТАЛЬНОЕ ===
    // Если канал неизвестный - отправляем null (пустой ответ)
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