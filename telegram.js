const TeleBot = require('telebot')
const { startBot, stopBot, sendVerify, getStatus } = require('./afkbot')

const TELEGRAM_TOKEN = '8569269930:AAG4WEPomwxNbWrxiIeqZZEkUjv5c6DKA9g'
const ADMIN_ID = 8480261623

const tbot = new TeleBot(TELEGRAM_TOKEN)

function isAdmin(msg) {
    return msg.from.id === ADMIN_ID
}

function log(text) {
    tbot.sendMessage(ADMIN_ID, text).catch(() => {})
}

tbot.on('/join', (msg) => {
    if (!isAdmin(msg)) return

    const result = startBot(
        // Верификация
        (text) => {
            log(`🔐 Нужна верификация!\n\n${text}\n\nОтправь код: /code XXXXXX`)
        },
        // Логи
        (text) => {
            log(text)
        }
    )

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
    return msg.reply.text(`📡 Статус:\n${result}`)
})

log('🤖 AFK бот запущен')
tbot.start()
