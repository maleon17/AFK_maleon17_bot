const TeleBot = require('telebot')
const { startBot, stopBot, sendVerify, getStatus } = require('./afkbot')

const TELEGRAM_TOKEN = 'ТОКЕН_НОВОГО_БОТА'
const ADMIN_ID = 8480261623  // твой Telegram ID

const tbot = new TeleBot(TELEGRAM_TOKEN)

// Проверка админа
function isAdmin(msg) {
    return msg.from.id === ADMIN_ID
}

tbot.on('/join', (msg) => {
    if (!isAdmin(msg)) return

    const result = startBot((text) => {
        // Когда сервер просит верификацию
        tbot.sendMessage(ADMIN_ID,
            `🔐 Нужна верификация!\n\n${text}\n\nОтправь код: /code XXXXXX`
        )
    })

    return msg.reply.text(result)
})

tbot.on('/leave', (msg) => {
    if (!isAdmin(msg)) return
    const result = stopBot()
    return msg.reply.text(result)
})

tbot.on('/code', (msg) => {
    if (!isAdmin(msg)) return
    const code = msg.text.split(' ')[1]
    if (!code) return msg.reply.text('Использование: /code XXXXXX')
    const result = sendVerify(code.toUpperCase())
    return msg.reply.text(result)
})

tbot.on('/status', (msg) => {
    if (!isAdmin(msg)) return
    const result = getStatus()
    return msg.reply.text(`📡 Статус бота:\n${result}`)
})

console.log('🤖 Telegram бот запущен')
tbot.start()
