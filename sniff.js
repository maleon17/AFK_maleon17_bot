const mc = require('minecraft-protocol')

const client = mc.createClient({
    host: 'donator2.gamely.pro',
    port: 30958,
    username: 'maleon17',
    version: '1.20.1',
    auth: 'offline',
    fakeHost: 'donator2.gamely.pro\0FML3\0'
})

client.on('login_plugin_request', (packet) => {
    console.log('GOT REQUEST - server is responding!')
    process.exit()
})

client.on('error', (err) => console.log('ERROR:', err.message))
client.on('end', () => { console.log('DISCONNECTED'); process.exit() })

client.on('disconnect', (packet) => {
    console.log('DISCONNECT:', JSON.stringify(packet).substring(0, 200))
    process.exit()
})

setTimeout(() => { console.log('TIMEOUT - server not responding'); process.exit() }, 15000)
