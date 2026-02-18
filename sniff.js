const mc = require('minecraft-protocol')

const client = mc.createClient({
    host: 'donator2.gamely.pro',
    port: 30958,
    username: 'maleon17',
    version: '1.20.1',
    auth: 'offline',
    // Важно для Forge
    fakeHost: 'donator2.gamely.pro\0FML3\0'
})

// === Функции чтения/записи VarInt и String ===
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

// === Основной обработчик handshake ===
client.on('login_plugin_request', (packet) => {
    console.log(`\n=== PLUGIN REQUEST #${packet.messageId} ===`)
    
    if (!packet.data || packet.data.length === 0) {
        console.log('❌ Пустые данные')
        return client.write('login_plugin_response', { messageId: packet.messageId, data: null })
    }

    // Парсим channel как String: [VarInt length][UTF-8 bytes]
    const lenInfo = readVarInt(packet.data, 0)
    if (lenInfo.length === 0) {
        console.log('❌ Ошибка чтения длины канала')
        return client.write('login_plugin_response', { messageId: packet.messageId, data: null })
    }
    const channelBytes = packet.data.slice(lenInfo.length, lenInfo.length + lenInfo.value)
    const innerChannel = channelBytes.toString('utf8')
    const innerData = packet.data.slice(lenInfo.length + lenInfo.value)

    console.log('Channel:', innerChannel)
    console.log('Raw data (hex):', innerData.slice(0, 32).toString('hex'))
    console.log('Data length:', innerData.length)

    // === Обработка разных каналов ===
    if (innerChannel === 'tacz:handshake' || innerChannel === 'tacztweaks:handshake') {
        console.log(`➡️  Эхо-ответ для ${innerChannel}`)
        // Отправляем обратно те же данные
        client.write('login_plugin_response', {
            messageId: packet.messageId,
            data: packet.data // Полностью эхо
        })

    // === FML Handshake ===
    } else if (innerChannel === 'fml:handshake') {
        if (innerData.length === 0) {
            console.log('❌ FML: Пустые данные')
            return client.write('login_plugin_response', { messageId: packet.messageId, data: null })
        }

        const lenInfo = readVarInt(innerData, 0)
        const payload = innerData.slice(lenInfo.length)
        const typeInfo = readVarInt(payload, 0)
        const type = typeInfo.value

        console.log('FML Type:', type)

        if (type === 2) {
            // Phase 2: Server sends mod list, client must respond with its own
            console.log('➡️  FML Type 2: Отвечаю списком модов')
            
            const mods = [
                { modid: 'minecraft', version: '1.20.1' },
                { modid: 'forge', version: '47.4.10' },
                { modid: 'takkit', version: '1.3.1' },
                { modid: 'rationcraft', version: '1.3.7' },
                { modid: 'caps_awim_tactical_gear_rework', version: '2.5.0202.26' },
                { modid: 'wool_bands', version: '1.0.0' },
                { modid: 'voidlessframework', version: '1.3.4' },
                { modid: 'voicechat', version: '1.20.1-2.6.11' },
                { modid: 'prefix_teb', version: '1.0-SNAPSHOT' },
                { modid: 'mixinsquared', version: '0.3.3' },
                { modid: 'creativecore', version: '2.12.32' },
                { modid: 'survival_instinct', version: '1.0.2' },
                { modid: 'kit_for_teb', version: '1.0.0' },
                { modid: 'walkietalkie', version: '1.3.0' },
                { modid: 'personality', version: '4.1.0' },
                { modid: 'lrtactical', version: '0.3.0' },
                { modid: 'kotlinforforge', version: '4.12.0' },
                { modid: 'flywheel', version: '1.0.5' },
                { modid: 'ponder', version: '1.0.91' },
                { modid: 'create', version: '6.0.8' },
                { modid: 'createdeco', version: '2.0.3-1.20.1-forge' },
                { modid: 'framedblocks', version: '9.4.3' },
                { modid: 'lexiconfig', version: '1.4.18-1' },
                { modid: 'endlessammo', version: '1.2.0' },
                { modid: 'mobsunscreen', version: '3.1.1' },
                { modid: 'soldiersdelight', version: '1.2' },
                { modid: 'parcool', version: '3.4.3.2' },
                { modid: 'chamber_clarity', version: '4.0.0-1.20.1' },
                { modid: 'suppressionmod', version: '1.1.1' },
                { modid: 'fracturepoint', version: '2.3.11-beta' },
                { modid: 'taczxgunlightsaddon', version: '1.0.7' },
                { modid: 'ferritecore', version: '6.0.1' },
                { modid: 'yet_another_config_lib_v3', version: '3.6.6+1.20.1-forge' },
                { modid: 'simpleradio', version: '3.4.6' },
                { modid: 'skinrestorer', version: '2.5.0+1.20-forge' },
                { modid: 'click2pick', version: '1.0.0' },
                { modid: 'captureofzones', version: '0.1.7-a' }
            ]

            // Собираем payload: [type=2] [mod count] [modid][version][modid][version]...
            const parts = [writeVarInt(2), writeVarInt(mods.length)]
            for (const mod of mods) {
                parts.push(writeString(mod.modid))
                parts.push(writeString(mod.version))
            }
            const payloadBuffer = Buffer.concat(parts)

            // Упаковываем в канал fml:handshake
            const channelBuf = writeString('fml:handshake')
            const data = Buffer.concat([channelBuf, writeVarInt(payloadBuffer.length), payloadBuffer])

            client.write('login_plugin_response', {
                messageId: packet.messageId,
                data: data
            })

        } else {
            console.log('➡️  FML: Неизвестный тип, отвечаю null')
            client.write('login_plugin_response', { messageId: packet.messageId, data: null })
        }

    } else {
        console.log(`➡️  Неизвестный канал: ${innerChannel}, отвечаю null`)
        client.write('login_plugin_response', { messageId: packet.messageId, data: null })
    }
})

// === Обработка успешного входа ===
client.on('login', () => {
    console.log('\n🎉 *** УСПЕШНО ЗАЛОГИНИЛСЯ! ***')
    process.exit(0)
})

// === Обработка ошибок ===
client.on('disconnect', (packet) => {
    try {
        const reason = JSON.parse(packet.reason)
        console.log('\n❌ DISCONNECT:', reason.translate || reason.text || JSON.stringify(reason))
    } catch (e) {
        console.log('\n❌ DISCONNECT:', packet.reason)
    }
    process.exit(1)
})

client.on('kick_disconnect', (packet) => {
    console.log('💀 KICKED:', packet.reason)
    process.exit(1)
})

client.on('error', (err) => {
    console.log('🔴 ERROR:', err.message)
    process.exit(1)
})