const mineflayer = require('mineflayer')
const autoeat = require('mineflayer-auto-eat').plugin

let bot = null
let isRunning = false

function startBot(verifyCallback) {
    if (isRunning) return 'Бот уже на сервере'

    bot = mineflayer.createBot({
        host: 'IP_СЕРВЕРА',
        port: 25565,
        username: 'maleon17',
        version: '1.20.1',
        auth: 'offline'
    })

    bot.loadPlugin(autoeat)

    bot.on('login', () => {
        console.log('✅ Бот зашёл на сервер')
        isRunning = true
    })

    bot.on('spawn', () => {
        // Настройка автоеды
        bot.autoEat.options = {
            priority: 'foodPoints',
            startAt: 14,
            bannedFood: []
        }

        // Анти-АФК: прыжки каждые 2 минуты
        setInterval(() => {
            if (isRunning) {
                bot.setControlState('jump', true)
                setTimeout(() => bot.setControlState('jump', false), 500)
            }
        }, 120000)
    })

    // Ловим сообщение с просьбой ввести /verify
    bot.on('message', (message) => {
        const text = message.toString()
        console.log(`[CHAT] ${text}`)

        if (text.includes('/verify') || text.includes('подтверждение входа')) {
            if (verifyCallback) verifyCallback(text)
        }
    })

    bot.on('kicked', (reason) => {
        console.log('❌ Кикнут:', reason)
        isRunning = false
        bot = null
    })

    bot.on('error', (err) => {
        console.log('Ошибка:', err.message)
        isRunning = false
        bot = null
    })

    bot.on('end', () => {
        console.log('Отключён')
        isRunning = false
        bot = null
    })

    return 'Подключаюсь к серверу...'
}

function stopBot() {
    if (!isRunning || !bot) return 'Бот не на сервере'
    bot.quit()
    isRunning = false
    bot = null
    return 'Бот вышел с сервера'
}

function sendVerify(code) {
    if (!bot || !isRunning) return 'Бот не на сервере'
    bot.chat(`/verify ${code}`)
    return `Отправлено: /verify ${code}`
}

function getStatus() {
    if (!isRunning || !bot) return 'Оффлайн'
    const health = bot.health || '?'
    const food = bot.food || '?'
    return `Онлайн\n❤️ HP: ${health}\n🍖 Голод: ${food}`
}

module.exports = { startBot, stopBot, sendVerify, getStatus }
