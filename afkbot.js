const mineflayer = require('mineflayer')

let bot = null
let isRunning = false
let sendLog = null

function startBot(verifyCallback, logCallback) {
    if (isRunning) return 'Бот уже на сервере'

    sendLog = logCallback

    bot = mineflayer.createBot({
        host: 'donator2.gamely.pro',
        port: 30958,
        username: 'maleon17',
        version: '1.20.1',
        auth: 'offline'
    })

    bot.on('login', () => {
        isRunning = true
        sendLog('✅ Бот зашёл на сервер')
    })

    bot.on('spawn', () => {
        // Проверяем голод каждые 10 секунд
        setInterval(() => {
            if (!isRunning || !bot) return
            if (bot.food <= 14) {
                eat()
            }
        }, 10000)
    })

    bot.on('message', (message) => {
        const text = message.toString()

        if (text.includes('/verify') || text.includes('подтверждение входа')) {
            if (verifyCallback) verifyCallback(text)
        }
    })

    bot.on('health', () => {
        if (bot.food <= 6) {
            sendLog(`⚠️ Голод критический: ${bot.food}/20`)
        }
        if (bot.health <= 5) {
            sendLog(`🚨 HP критическое: ${bot.health}/20`)
        }
    })

    bot.on('death', () => {
        sendLog('💀 Бот умер! Респаун...')
    })

    bot.on('kicked', (reason) => {
        isRunning = false
        bot = null
        sendLog(`❌ Кикнут: ${reason}`)
    })

    bot.on('error', (err) => {
        isRunning = false
        bot = null
        sendLog(`🔴 Ошибка: ${err.message}`)
    })

    bot.on('end', () => {
        isRunning = false
        bot = null
        sendLog('🔌 Отключён от сервера')
    })

    return '⏳ Подключаюсь к серверу...'
}

async function eat() {
    if (!bot || !isRunning) return

    const foods = [
        'cooked_beef', 'cooked_porkchop', 'cooked_chicken',
        'cooked_mutton', 'cooked_salmon', 'cooked_cod',
        'bread', 'golden_carrot', 'golden_apple',
        'apple', 'baked_potato', 'beetroot',
        'carrot', 'melon_slice', 'sweet_berries'
    ]

    for (const foodName of foods) {
        const food = bot.inventory.items().find(item => item.name === foodName)
        if (food) {
            try {
                await bot.equip(food, 'hand')
                await bot.consume()
            } catch (e) {
                // не удалось поесть
            }
            return
        }
    }
}

function stopBot() {
    if (!isRunning || !bot) return 'Бот не на сервере'
    bot.quit()
    isRunning = false
    bot = null
    return '👋 Бот вышел с сервера'
}

function sendVerify(code) {
    if (!bot || !isRunning) return 'Бот не на сервере'
    bot.chat(`/verify ${code}`)
    return `✅ Отправлено: /verify ${code}`
}

function getStatus() {
    if (!isRunning || !bot) return '🔴 Оффлайн'
    const health = bot.health || '?'
    const food = bot.food || '?'
    const pos = bot.entity ? bot.entity.position : null
    let status = `🟢 Онлайн\n❤️ HP: ${health}/20\n🍖 Голод: ${food}/20`
    if (pos) {
        status += `\n📍 X:${Math.round(pos.x)} Y:${Math.round(pos.y)} Z:${Math.round(pos.z)}`
    }
    return status
}

module.exports = { startBot, stopBot, sendVerify, getStatus }
