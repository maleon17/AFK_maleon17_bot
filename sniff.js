const mc = require('minecraft-protocol')

const client = mc.createClient({
    host: 'donator2.gamely.pro',
    port: 30958,
    username: 'maleon17',
    version: '1.20.1',
    auth: 'offline',
    hideErrors: false
})

// Логируем ВСЕ входящие пакеты
client.on('packet', (data, meta) => {
    if (meta.state === 'login') {
        console.log(`[${meta.state}] ${meta.name}:`, JSON.stringify(data).substring(0, 500))
    }
})

client.on('login_plugin_request', (packet) => {
    console.log('\n=== LOGIN PLUGIN REQUEST ===')
    console.log('messageId:', packet.messageId)
    console.log('channel:', packet.channel)
    console.log('data hex:', packet.data ? packet.data.toString('hex') : 'null')
    console.log('data utf8:', packet.data ? packet.data.toString('utf8') : 'null')
    console.log('===========================\n')
})

client.on('error', (err) => {
    console.log('ERROR:', err.message)
})

client.on('end', () => {
    console.log('DISCONNECTED')
    process.exit()
})

client.on('kick_disconnect', (packet) => {
    console.log('KICKED:', JSON.stringify(packet))
    process.exit()
})

setTimeout(() => {
    console.log('TIMEOUT')
    process.exit()
}, 10000)
