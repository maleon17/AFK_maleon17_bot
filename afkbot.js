const net = require('net')
const TeleBot = require('telebot')

const HOST = 'donator2.gamely.pro'
const PORT = 30958
const USERNAME = 'maleon17'
const TELEGRAM_TOKEN = '8569269930:AAG4WEPomwxNbWrxiIeqZZEkUjv5c6DKA9g'
const ADMIN_ID = 8480261623

const tbot = new TeleBot(TELEGRAM_TOKEN)

let sock = null
let isRunning = false
let compressionThreshold = -1
let health = 20, food = 20
let posX = 0, posY = 0, posZ = 0
let onGround = false

function log(text) {
    console.log(text)
    tbot.sendMessage(ADMIN_ID, text).catch(() => {})
}

// ===== VarInt =====
function readVarInt(buf, off) {
    let val = 0, len = 0, b
    do {
        if (off + len >= buf.length) return null
        b = buf[off + len]
        val |= (b & 0x7F) << (len * 7)
        len++
    } while (b & 0x80)
    return { value: val, length: len }
}

function writeVarInt(val) {
    const bytes = []
    do {
        let b = val & 0x7F
        val >>>= 7
        if (val) b |= 0x80
        bytes.push(b)
    } while (val)
    return Buffer.from(bytes)
}

function readString(buf, off) {
    const len = readVarInt(buf, off)
    if (!len) return null
    return {
        value: buf.slice(off + len.length, off + len.length + len.value).toString('utf8'),
        totalLength: len.length + len.value
    }
}

function writeString(str) {
    const b = Buffer.from(str, 'utf8')
    return Buffer.concat([writeVarInt(b.length), b])
}

function buildPacket(idBuf, ...parts) {
    const payload = Buffer.concat([idBuf, ...parts])
    if (compressionThreshold >= 0) {
        const inner = Buffer.concat([writeVarInt(0), payload])
        return Buffer.concat([writeVarInt(inner.length), inner])
    }
    return Buffer.concat([writeVarInt(payload.length), payload])
}

function sendPacket(id, ...parts) {
    if (!sock) return
    sock.write(buildPacket(writeVarInt(id), ...parts))
}

// ===== Функция для отправки пакетов в фазе PLAY =====
function sendPlayPacket(packetId, ...parts) {
    if (!sock || !isRunning) return
    const body = Buffer.concat([writeVarInt(packetId), ...parts])
    const inner = Buffer.concat([writeVarInt(0), body])
    sock.write(Buffer.concat([writeVarInt(inner.length), inner]))
}

// ===== Handshake =====
function buildHandshake() {
    const host = HOST + '\0FML3\0'
    const hostBuf = Buffer.from(host, 'utf8')
    const payload = Buffer.concat([
        Buffer.from([0x00]),
        writeVarInt(763),
        writeVarInt(hostBuf.length), hostBuf,
        Buffer.from([0x78, 0xce]),
        Buffer.from([0x02])
    ])
    return Buffer.concat([writeVarInt(payload.length), payload])
}

function buildLoginStart() {
    const name = Buffer.from(USERNAME, 'utf8')
    const payload = Buffer.concat([
        Buffer.from([0x00]),
        writeVarInt(name.length), name,
        Buffer.from([0x00])
    ])
    return Buffer.concat([writeVarInt(payload.length), payload])
}

// ===== Парсинг пакетов =====
let recvBuf = Buffer.alloc(0)
let gamePhase = 'login'

function onData(chunk) {
    recvBuf = Buffer.concat([recvBuf, chunk])

    while (true) {
        if (recvBuf.length === 0) break

        let off = 0
        const lenInfo = readVarInt(recvBuf, off)
        if (!lenInfo) break
        off += lenInfo.length

        if (recvBuf.length < off + lenInfo.value) break

        let pktData = recvBuf.slice(off, off + lenInfo.value)
        recvBuf = recvBuf.slice(off + lenInfo.value)

        if (compressionThreshold >= 0) {
            const dataLen = readVarInt(pktData, 0)
            if (!dataLen) continue
            pktData = pktData.slice(dataLen.length)
        }

        if (gamePhase === 'login') {
            handleLoginPacket(pktData)
        } else {
            handlePlayPacket(pktData)
        }
    }
}

// ===== LOGIN PHASE =====
function handleLoginPacket(pkt) {
    const idInfo = readVarInt(pkt, 0)
    if (!idInfo) return
    const id = idInfo.value
    let o = idInfo.length

    if (id === 0x03) {
        const threshold = readVarInt(pkt, o)
        compressionThreshold = threshold.value
        console.log(`[LOGIN] Set Compression: ${compressionThreshold}`)
        return
    }

    if (id === 0x02) {
        console.log('[LOGIN] Login Success!')
        gamePhase = 'play'
        isRunning = true
        log('✅ Бот зашёл на сервер! Ожидаю 2FA код...')

        const ackPayload = Buffer.from([0x03])
        sock.write(Buffer.concat([writeVarInt(1), ackPayload]))
        return
    }

    if (id === 0x00) {
        const reason = readString(pkt, o)
        log(`❌ Кик при логине: ${reason ? reason.value : 'unknown'}`)
        sock.destroy()
        return
    }

    if (id === 0x04) {
        const msgId = readVarInt(pkt, o); o += msgId.length
        const ch = readString(pkt, o); if (!ch) return; o += ch.totalLength
        const innerData = pkt.slice(o)

        const innerChLen = innerData[0]
        const innerCh = innerData.slice(1, 1 + innerChLen).toString('utf8')

        console.log(`[PLUGIN] #${msgId.value} ${innerCh}`)

        if (msgId.value === 0) {
            const resp = Buffer.concat([
                writeVarInt(0x02),
                
