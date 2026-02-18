const mc = require('minecraft-protocol')

const client = mc.createClient({
    host: 'donator2.gamely.pro',
    port: 30958,
    username: 'maleon17',
    version: '1.20.1',
    auth: 'offline',
    fakeHost: 'donator2.gamely.pro\0FML3\0'
})

// Перехватываем ДО стандартного обработчика
client.on('raw.login_plugin_request', (buffer) => {
    console.log('RAW login_plugin_request intercepted')
})

// Убираем стандартные обработчики login_plugin_request
const origListeners = client.listeners('login_plugin_request')
console.log('Default listeners:', origListeners.length)

client.removeAllListeners('login_plugin_request')

client.on('login_plugin_request', (packet) => {
    console.log('Request channel:', packet.channel, 'id:', packet.messageId)
    
    if (packet.data) {
        const nameLen = packet.data[0]
        const innerChannel = packet.data.slice(1, 1 + nameLen).toString('utf8')
        console.log('  inner:', innerChannel)
    }

    // НЕ отвечаем — просто молчим
    console.log('  -> Игнорируем (не отвечаем)')
})

client.on('login', () => {
    console.log('\n*** SUCCESS! Logged in! ***')
})

client.on('disconnect', (packet) => {
    console.log('DISCONNECT:', JSON.stringify(packet).substring(0, 300))
    process.exit()
})

client.on('kick_disconnect', (packet) => {
    console.log('KICKED:', JSON.stringify(packet).substring(0, 300))
    process.exit()
})

client.on('error', (err) => {
    console.log('ERROR:', err.message)
})

client.on('end', () => {
    console.log('DISCONNECTED')
    process.exit()
})

setTimeout(() => {
    console.log('TIMEOUT - сервер ждёт ответа')
    process.exit()
}, 15000)
