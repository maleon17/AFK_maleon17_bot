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

    console.log(`\n[REQUEST #${packet.messageId}] Channel: ${innerChannel}`)

    // Функция для отправки ответа с флагом успеха
    function sendSuccess(payload) {
        // Структура: [Success: 0x01] [ChannelLen] [Channel] [Payload]
        const channelBuf = Buffer.from(innerChannel, 'utf8')
        const response = Buffer.concat([
            Buffer.from([0x01]),          // Success = true
            Buffer.from([channelBuf.length]), // Длина имени канала
            channelBuf,                   // Имя канала
            payload                       // Полезная нагрузка
        ])
        
        client.write('login_plugin_response', { 
            messageId: packet.messageId, 
            data: response 
        })
        console.log(`[SENT] Success response for ${innerChannel}`)
    }

    function sendNull() {
        // Структура: [Success: 0x00] (нет данных дальше)
        const response = Buffer.from([0x00])
        client.write('login_plugin_response', { 
            messageId: packet.messageId, 
            data: response 
        })
        console.log(`[SENT] Null response for ${innerChannel}`)
    }

    // === 1. TACZ HANDSHAKE ===
    if (innerChannel === 'tacz:handshake') {
        // Лог прокси показал ответ: 01 0e ... 01 01
        // То есть: Success(01) + Len(0e) + "tacz:handshake" + Payload(01 01)
        // Наш innerData содержит запрос, а нам нужно ответить версией.
        // В логе прокси ответ был: 01 01 (два байта)
        sendSuccess(Buffer.from([0x01, 0x01])) 
        return
    }
    
    // === 2. TACZTWEAKS HANDSHAKE ===
    if (innerChannel === 'tacztweaks:handshake') {
        // Аналогично, скорее всего нужен простой байт
        sendSuccess(Buffer.from([0x01])) 
        return
    }

    // === 3. FML HANDSHAKE ===
    if (innerChannel === 'fml:handshake' && innerData.length > 0) {
        let offset = 0
        
        // Пропускаем длину пакета (первый VarInt внутри innerData)
        const packetLenInfo = readVarInt(innerData, offset)
        offset += packetLenInfo.length
        
        // Читаем тип
        const typeInfo = readVarInt(innerData, offset)
        const type = typeInfo.value
        offset += typeInfo.length
        
        console.log(`[FML] Packet Type: ${type}`)
        
        if (type === 5) {
            // ЭТО САМОЕ ВАЖНОЕ: ModList
            // Сервер шлет список своих модов.
            // Клиент должен ответить списком СВОИХ модов.
            // Но в логе прокси мы видели, что клиент отвечает ОГРОМНЫМ пакетом (3205 байт),
            // который содержит не просто список ID, а кучу данных о регистрациях.
            
            // ПОДОЖДИ. Глянь на лог прокси еще раз.
            // Запрос #3 (Type 5, список модов сервера).
            // Ответ клиента: 3205 байт.
            // Это НЕ просто эхо списка модов. Это полная синхронизация регистров?
            // Нет, стоп. В FML3 (1.13+) процесс такой:
            // 1. Server sends ModList (type 5).
            // 2. Client replies with ITS OWN ModList (type 5).
            
            // Почему ответ такой большой? Потому что клиент шлет ВСЕ свои моды (а их много)
            // в формате: [Count] [ModID] [Version] ...
            // А запрос сервера был в формате: [Count] [ModID] [DisplayName] [Version] ...
            
            // Значит, нам нужно спарсить запрос сервера, взять оттуда список модов,
            // и отправить обратно ТОЛЬКО ID и VERSION, без DisplayName.
            // И добавить в конце какие-то флаги?
            
            // Давай посмотрим на конец большого пакета в hex:
            // ... 0c7461637a3a6e6574776f726b05312e302e3400
            // Заканчивается на 00.
            
            // Алгоритм формирования ответа на Type 5:
            // 1. Пишем Type (5)
            // 2. Пишем Count модов
            // 3. Для каждого мода пишем: [ID] [Version] (БЕЗ DisplayName!)
            // 4. В конце? Возможно пустой список каналов или регистров?
            
            // ДАВАЙ ПОПРОБУЕМ сформировать ответ вручную, как в предыдущей попытке,
            // но теперь обернуть его в sendSuccess().
            
            const modCountInfo = readVarInt(innerData, offset)
            const modCount = modCountInfo.value
            offset += modCountInfo.length
            
            console.log(`[FML] Parsing ${modCount} mods from server...`)
            
            const serverMods = []
            for (let i = 0; i < modCount && offset < innerData.length; i++) {
                const modId = readString(innerData, offset)
                offset += modId.totalLength
                const displayName = readString(innerData, offset) // Пропускаем DisplayName
                offset += displayName.totalLength
                const version = readString(innerData, offset)
                offset += version.totalLength
                
                serverMods.push({ id: modId.value, version: version.value })
            }
            
            // Формируем ответ
            const parts = [
                writeVarInt(5), // Тип
                writeVarInt(serverMods.length) // Количество
            ]
            
            for (const mod of serverMods) {
                parts.push(writeString(mod.id))
                parts.push(writeString(mod.version))
            }
            
            // В конце лога прокси видим 00. Возможно это количество доп. данных (каналов)?
            // Попробуем добавить два нуля (пустые списки), как часто бывает в FML
            parts.push(writeVarInt(0)) // Channels?
            parts.push(writeVarInt(0)) // Registries?
            
            const payload = Buffer.concat(parts)
            sendSuccess(payload)
            return
        }
        
        // Для остальных типов FML (регистрации и т.д.)
        // В логе прокси на них отвечали маленьким пакетом: 01 63
        // 01 = Success, 63 = ? Скорее всего просто байт подтверждения.
        // Попробуем отправить 0x63 или 0x01.
        // В логе: Request #4 -> Response 01 63.
        // Request #5 -> Response 01 63.
        // Похоже на универсальный ответ "OK".
        sendSuccess(Buffer.from([0x63]))
        return
    }

    // Остальное
    sendNull()
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
