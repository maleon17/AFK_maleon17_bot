const mc = require('minecraft-protocol')
const { forgeHandshake } = require('minecraft-protocol-forge')

let client = null
let isRunning = false
let sendLog = null
let healthValue = 20
let foodValue = 20
let posX = 0, posY = 0, posZ = 0

function startBot(verifyCallback, logCallback) {
    if (isRunning) return 'Бот уже на сервере'

    sendLog = logCallback

    client = mc.createClient({
        host: 'donator2.gamely.pro',
        port: 30958,
        username: 'maleon17',
        version: '1.20.1',
        auth: 'offline'
    })

    forgeHandshake(client, {
        forgeMods: [
            { modid: 'minecraft', version: '1.20.1' },
            { modid: 'forge', version: '47.2.0' },
            { modid: 'captureofzones', version: '0.1.7-a' },
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
            { modid: 'click2pick', version: '1.0.0' }
        ],
        channels: []
    })

    client.on('login', () => {
        isRunning = true
        sendLog('✅ Бот зашёл на сервер')
    })

    // Слушаем чат
    client.on('system_chat', (packet) => {
        const text = JSON.stringify(packet.content)
        console.log('[CHAT]', text)

        if (text.includes('verify') || text.includes('подтверждение')) {
            if (verifyCallback) verifyCallback(text)
        }
    })

    client.on('player_chat', (packet) => {
        const text = packet.plainMessage || ''
        console.log('[CHAT]', text)
    })

    // Здоровье и голод
    client.on('update_health', (packet) => {
        healthValue = packet.health
        foodValue = packet.food

        if (foodValue <= 6) {
            sendLog(`⚠️ Голод критический: ${foodValue}/20`)
        }
        if (healthValue <= 5) {
            sendLog(`🚨 HP критическое: ${healthValue}/20`)
        }
        if (healthValue <= 0) {
            sendLog('💀 Бот умер! Респаун...')
            // Автореспаун
            client.write('client_command', { actionId: 0 })
        }
    })

    // Позиция
    client.on('position', (packet) => {
        posX = packet.x
        posY = packet.y
        posZ = packet.z

        // Подтверждаем позицию серверу
        client.write('teleport_confirm', {
            teleportId: packet.teleportId
        })
    })

    // Авто-еда каждые 10 секунд
    setInterval(() => {
        if (!isRunning || !client) return
        if (foodValue <= 14) {
            tryEat()
        }
    }, 10000)

    // Keep alive — не нужен, minecraft-protocol делает сам

    client.on('kick_disconnect', (packet) => {
        isRunning = false
        client = null
        sendLog(`❌ Кикнут: ${JSON.stringify(packet.reason)}`)
    })

    client.on('disconnect', (packet) => {
        isRunning = false
        client = null
        sendLog(`❌ Отключён: ${JSON.stringify(packet.reason)}`)
    })

    client.on('error', (err) => {
        isRunning = false
        client = null
        sendLog(`🔴 Ошибка: ${err.message}`)
    })

    client.on('end', () => {
        isRunning = false
        client = null
        sendLog('🔌 Отключён от сервера')
    })

    return '⏳ Подключаюсь к серверу...'
}

function tryEat() {
    if (!client || !isRunning) return

    try {
        // Используем предмет в правой руке
        client.write('use_item', {
            hand: 0
        })
    } catch (e) {
        // игнорируем
    }
}

function stopBot() {
    if (!isRunning || !client) return 'Бот не на сервере'
    client.end()
    isRunning = false
    client = null
    return '👋 Бот вышел с сервера'
}

function sendVerify(code) {
    if (!client || !isRunning) return 'Бот не на сервере'
    client.write('chat_command', {
        command: `verify ${code}`,
        timestamp: BigInt(Date.now()),
        salt: BigInt(0),
        argumentSignatures: [],
        signedPreview: false,
        messageCount: 0,
        acknowledged: Buffer.alloc(3)
    })
    return `✅ Отправлено: /verify ${code}`
}

function getStatus() {
    if (!isRunning || !client) return '🔴 Оффлайн'
    let status = `🟢 Онлайн\n❤️ HP: ${healthValue}/20\n🍖 Голод: ${foodValue}/20`
    status += `\n📍 X:${Math.round(posX)} Y:${Math.round(posY)} Z:${Math.round(posZ)}`
    return status
}

module.exports = { startBot, stopBot, sendVerify, getStatus }
