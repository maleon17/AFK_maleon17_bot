const net = require('net')
const zlib = require('zlib')
const TeleBot = require('telebot')

const HOST = 'game11.gamely.pro'
const PORT = 24001
const USERNAME = 'maleon17'
const TELEGRAM_TOKEN = '8569269930:AAG4WEPomwxNbWrxiIeqZZEkUjv5c6DKA9g'
const ADMIN_ID = 8480261623

const tbot = new TeleBot(TELEGRAM_TOKEN)

let sock = null
let isRunning = false
let compressionThreshold = -1
let health = 20, food = 20
let posX = 0, posY = 0, posZ = 0
let yaw = 0, pitch = 0
let positionInterval = null
let keepAliveWatchdog = null
let chatHistory = []
let lastKeepAlive = Date.now()
let clientSettingsSent = false

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
        if (len > 5) return null
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
    if (off + len.length + len.value > buf.length) return null
    return {
        value: buf.slice(off + len.length, off + len.length + len.value).toString('utf8'),
        totalLength: len.length + len.value
    }
}

function writeString(str) {
    const b = Buffer.from(str, 'utf8')
    return Buffer.concat([writeVarInt(b.length), b])
}

// ===== Построение пакета с учётом сжатия =====
function buildPacket(packetId, ...parts) {
    const body = Buffer.concat([writeVarInt(packetId), ...parts])
    if (compressionThreshold >= 0) {
        if (body.length >= compressionThreshold) {
            const compressed = zlib.deflateSync(body)
            const inner = Buffer.concat([writeVarInt(body.length), compressed])
            return Buffer.concat([writeVarInt(inner.length), inner])
        } else {
            const inner = Buffer.concat([writeVarInt(0), body])
            return Buffer.concat([writeVarInt(inner.length), inner])
        }
    } else {
        return Buffer.concat([writeVarInt(body.length), body])
    }
}

function sendRaw(buf) {
    if (!sock) return
    const preview = buf.slice(0, Math.min(buf.length, 16)).toString('hex')
    console.log(`[TX] ${buf.length}b: ${preview}${buf.length > 16 ? '...' : ''}`)
    sock.write(buf)
}

function sendPlayPacket(packetId, ...parts) {
    if (!sock || !isRunning) return
    sendRaw(buildPacket(packetId, ...parts))
}

// ===== Чат / Команды =====
function sendChatMessage(msg) {
    if (!sock || !isRunning) return false
    const msgBuf = Buffer.from(msg, 'utf8')
    const timestamp = Buffer.alloc(8)
    timestamp.writeBigInt64BE(BigInt(Date.now()), 0)
    sendPlayPacket(0x05, Buffer.concat([
        writeVarInt(msgBuf.length), msgBuf,
        timestamp, Buffer.alloc(8),
        writeVarInt(0), writeVarInt(0),
        Buffer.from([0x00, 0x00, 0x00])
    ]))
    console.log(`[CHAT SENT] ${msg}`)
    return true
}

function sendCommand(cmd) {
    if (!sock || !isRunning) return false
    if (cmd.startsWith('/')) cmd = cmd.substring(1)
    const cmdBuf = Buffer.from(cmd, 'utf8')
    const timestamp = Buffer.alloc(8)
    timestamp.writeBigInt64BE(BigInt(Date.now()), 0)
    sendPlayPacket(0x04, Buffer.concat([
        writeVarInt(cmdBuf.length), cmdBuf,
        timestamp, Buffer.alloc(8),
        writeVarInt(0), writeVarInt(0),
        Buffer.from([0x00, 0x00, 0x00])
    ]))
    console.log(`[CMD SENT] /${cmd}`)
    return true
}

// ===== Позиция =====
function startPositionUpdates() {
    if (positionInterval) clearInterval(positionInterval)
    positionInterval = setInterval(() => {
        if (!sock || !isRunning) { stopPositionUpdates(); return }
        const buf = Buffer.alloc(33)
        buf.writeDoubleBE(posX, 0)
        buf.writeDoubleBE(posY, 8)
        buf.writeDoubleBE(posZ, 16)
        buf.writeFloatBE(yaw, 24)
        buf.writeFloatBE(pitch, 28)
        buf.writeUInt8(1, 32)
        sendPlayPacket(0x15, buf)  // Set Player Position And Rotation
    }, 1000)
    console.log('[POS] Started position updates (every 1s)')
}

function stopPositionUpdates() {
    if (positionInterval) {
        clearInterval(positionInterval)
        positionInterval = null
        console.log('[POS] Stopped position updates')
    }
}

// ===== Keep-alive watchdog =====
function startKeepAliveWatchdog() {
    if (keepAliveWatchdog) clearInterval(keepAliveWatchdog)
    lastKeepAlive = Date.now()
    keepAliveWatchdog = setInterval(() => {
        if (!isRunning) return
        const elapsed = Date.now() - lastKeepAlive
        if (elapsed > 30000) {
            log(`⚠️ Нет keep-alive ${Math.round(elapsed / 1000)}с, переподключаюсь...`)
            disconnect()
            setTimeout(connect, 3000)
        }
    }, 5000)
}

function stopKeepAliveWatchdog() {
    if (keepAliveWatchdog) {
        clearInterval(keepAliveWatchdog)
        keepAliveWatchdog = null
    }
}

// ===== Handshake =====
function buildHandshake() {
    const host = HOST + '\0FML3\0'
    const hostBuf = Buffer.from(host, 'utf8')
    const payload = Buffer.concat([
        Buffer.from([0x00]), writeVarInt(763),
        writeVarInt(hostBuf.length), hostBuf,
        Buffer.from([0x78, 0xce]), Buffer.from([0x02])
    ])
    return Buffer.concat([writeVarInt(payload.length), payload])
}

function buildLoginStart() {
    const name = Buffer.from(USERNAME, 'utf8')
    const payload = Buffer.concat([
        Buffer.from([0x00]), writeVarInt(name.length), name, Buffer.from([0x00])
    ])
    return Buffer.concat([writeVarInt(payload.length), payload])
}

// ===== Парсинг =====
let recvBuf = Buffer.alloc(0)
let gamePhase = 'login'

function onData(chunk) {
    recvBuf = Buffer.concat([recvBuf, chunk])
    while (true) {
        if (recvBuf.length === 0) break
        const lenInfo = readVarInt(recvBuf, 0)
        if (!lenInfo) break
        const totalLen = lenInfo.length + lenInfo.value
        if (recvBuf.length < totalLen) break

        let pktData = recvBuf.slice(lenInfo.length, totalLen)
        recvBuf = recvBuf.slice(totalLen)

        if (compressionThreshold >= 0) {
            const dataLen = readVarInt(pktData, 0)
            if (!dataLen) continue
            const payload = pktData.slice(dataLen.length)
            if (dataLen.value > 0) {
                try { pktData = zlib.inflateSync(payload) }
                catch (e) { console.log('[ZLIB ERR]', e.message); continue }
            } else {
                pktData = payload
            }
        }

        if (gamePhase === 'login') handleLoginPacket(pktData)
        else handlePlayPacket(pktData)
    }
}

// ===== LOGIN =====
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
        log('✅ Бот зашёл на сервер!\n\n⏳ Жду код верификации...')
        startKeepAliveWatchdog()

        // ===== ИСПРАВЛЕНИЕ: Login Ack отправляется ЧЕРЕЗ buildPacket (с правильным сжатием) =====
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
                writeVarInt(0x02), writeVarInt(msgId.value),
                Buffer.from([0x01]),
                Buffer.from('0e7461637a3a68616e647368616b650101', 'hex')
            ])
            sock.write(Buffer.concat([writeVarInt(resp.length), resp]))
        } else if (msgId.value === 3) {
            const modListHex = 'fa18025d0673617475726e116578706c6f73696f6e6f7665726861756c086765636b6f6c6962097461637a6164646f6e0c636f6e6e656374697669747909696e73616e656c69620d786165726f776f726c646d6170096d6f6465726e6669780d73757065726277617266617265066d656c6f64790c636c6f74685f636f6e666967086b6f6e6b7265746509656d6265646469756d08727562696469756d06636f727073650e6461666661735f617273656e616c046d6373700e6661726d65727364656c696768740977726264726f6e6573076373676f626f780a6c696768747370656564066f63756c757310786165726f6d696e696d617066616972196c6567656e64617279737572766976616c6f7665726861756c06637572696f730a637573746f6d6e70637309776f726c64656469740c6172636869746563747572790e6169696d70726f76656d656e747308637570626f6172640a7472616e736974696f6e0a6974656d7068797369630a656e68616e636564616913646f6f6d736461795f6465636f726174696f6e0c706c61796572726576697665086d61787374756666046b697769057268696e6f066b7562656a7308666173746c6f6164066a73636f6e660c7061727469636c657261696e047461637a0e776172626f726e72656e657765640a7461637a747765616b73077472656e6465720a61736876656869636c650f7061737361626c65666f6c69616765116c696768746d616e7363757272656e6379076261646d6f627309626c75657072696e74037676700d6d656d6f72796c65616b66697805666f7267650e636170747572656f667a6f6e6573096d696e6563726166740674616b6b69740b726174696f6e63726166741e636170735f6177696d5f746163746963616c5f676561725f7265776f726b0a776f6f6c5f62616e647311766f69646c6573736672616d65776f726b0f64697374616e74686f72697a6f6e7309766f696365636861740d766f696365636861745f6170690c6d6978696e737175617265640c6372656174697665636f726511737572766976616c5f696e7374696e63740c77616c6b696574616c6b69650b706572736f6e616c6974790a6c72746163746963616c0e6b6f746c696e666f72666f72676508666c79776865656c06706f6e646572066372656174650a6372656174656465636f0c6672616d6564626c6f636b730a6c657869636f6e6669670b656e646c657373616d6d6f0f736f6c646965727364656c6967687407706172636f6f6c0f6368616d6265725f636c61726974790e7375707072657373696f6e6d6f640d656e7469747963756c6c696e670d6672616374757265706f696e74137461637a7867756e6c69676874736164646f6e0966616e63796d656e750f696d6d6564696174656c79666173740b66657272697465636f7265197965745f616e6f746865725f636f6e6669675f6c69625f76330f656d6265646469756d5f65787472610762617269746f650b73696d706c65726164696f0a636c69636b327069636b4c0d776f726c64656469743a63756901310b706f6e6465723a6d61696e013110766f696365636861743a73656372657419414c4c4f5756414e494c4c4120f09f9293f09f9293f09f92931864697374616e745f686f72697a6f6e733a6d65737361676501310f706172636f6f6c3a6d65737361676507332e342e332e3019696e73616e656c69623a6e6574776f726b5f6368616e6e656c013216766f696365636861743a6372656174655f67726f757019414c4c4f5756414e494c4c4120f09f9293f09f9293f09f9293146d696e6563726166743a756e726567697374657204464d4c3311786165726f6d696e696d61703a6d61696e03312e3010766f696365636861743a73746174657319414c4c4f5756414e494c4c4120f09f9293f09f9293f09f92931b7461637a7867756e6c69676874736164646f6e3a6e6574776f726b03312e3013776172626f726e72656e657765643a6d61696e01310e7461637a3a68616e647368616b6505312e302e3416766f696365636861743a7570646174655f737461746519414c4c4f5756414e494c4c4120f09f9293f09f9293f09f9293137461637a6164646f6e3a73796e635f6461746103312e3023766f69646c6573736672616d65776f726b3a766f69646c6573736672616d65776f726b013113766f696365636861743a6164645f67726f757019414c4c4f5756414e494c4c4120f09f9293f09f9293f09f92930f6974656d7068797369633a6d61696e013112666f7267653a746965725f736f7274696e6703312e3023737572766976616c5f696e7374696e63743a737572766976616c5f696e7374696e637401311373696d706c65726164696f3a6368616e6e656c013011706c617965727265766976653a6d61696e013108666d6c3a706c617904464d4c33116372656174697665636f72653a6d61696e0131126c72746163746963616c3a6e6574776f726b05302e332e300f766f696365636861743a737461746519414c4c4f5756414e494c4c4120f09f9293f09f9293f09f929319766f696365636861743a72656d6f76655f63617465676f727919414c4c4f5756414e494c4c4120f09f9293f09f9293f09f9293196d6f6465726e6669783a696e6772656469656e745f73796e6301310f61736876656869636c653a6d61696e03312e3016766f696365636861743a6164645f63617465676f727919414c4c4f5756414e494c4c4120f09f9293f09f9293f09f929312776f726c64656469743a696e7465726e616c0131077676703a76767001310d626c75657072696e743a6e65740342503112786165726f776f726c646d61703a6d61696e03312e3016766f696365636861743a72656d6f76655f737461746519414c4c4f5756414e494c4c4120f09f9293f09f9293f09f9293166578706c6f73696f6e6f7665726861756c3a6d61696e0131126d696e6563726166743a726567697374657204464d4c331f736f6c646965727364656c696768743a736f6c646965727364656c6967687401310b6372656174653a6d61696e01331b737570657262776172666172653a7375706572627761726661726501310d6765636b6f6c69623a6d61696e01310e77726264726f6e65733a6d61696e0131147461637a747765616b733a68616e647368616b6504322e3133096b6977693a6d61696e01310e636f727073653a64656661756c7405312e302e30146172636869746563747572793a6e6574776f726b013115766f696365636861743a6c656176655f67726f757019414c4c4f5756414e494c4c4120f09f9293f09f9293f09f9293096d6373703a6d61696e013115776f6f6c5f62616e64733a776f6f6c5f62616e64730131126672616374757265706f696e743a6d61696e01310f706572736f6e616c6974793a6e6574013113636170747572656f667a6f6e65733a6d61696e0131137375707072657373696f6e6d6f643a6d61696e013113766f696365636861743a7365745f67726f757019414c4c4f5756414e494c4c4120f09f9293f09f9293f09f92930e66616e63796d656e753a706c6179013116766f696365636861743a6a6f696e65645f67726f757019414c4c4f5756414e494c4c4120f09f9293f09f9293f09f92930e6d6f6465726e6669783a6d61696e01310b637572696f733a6d61696e0131117061727469636c657261696e3a6d61696e0131196c696768746d616e7363757272656e63793a6e6574776f726b01311e6c6567656e64617279737572766976616c6f7665726861756c3a6d61696e0131127461637a747765616b733a6368616e6e656c04322e31330f636c69636b327069636b3a6d61696e013110666d6c3a6c6f67696e7772617070657204464d4c33116672616d6564626c6f636b733a6d61696e013327646f6f6d736461795f6465636f726174696f6e3a646f6f6d736461795f6465636f726174696f6e01310d74616b6b69743a74616b6b6974013117726174696f6e63726166743a726174696f6e6372616674013112637573746f6d6e7063733a7061636b65747305434e50435318766f696365636861743a726571756573745f73656372657419414c4c4f5756414e494c4c4120f09f9293f09f9293f09f92933d636170735f6177696d5f746163746963616c5f676561725f7265776f726b3a636170735f6177696d5f746163746963616c5f676561725f7265776f726b01310d666d6c3a68616e647368616b6504464d4c330f6373676f626f783a6e6574776f726b03312e3016766f696365636861743a72656d6f76655f67726f757019414c4c4f5756414e494c4c4120f09f9293f09f9293f09f92930b666f7267653a73706c697403312e310c7461637a3a6e6574776f726b05312e302e3400'
            const modList = Buffer.from(modListHex, 'hex')
            const resp = Buffer.concat([
                writeVarInt(0x02), writeVarInt(msgId.value),
                Buffer.from([0x01]),
                Buffer.from('0d666d6c3a68616e647368616b65', 'hex'),
                modList
            ])
            sock.write(Buffer.concat([writeVarInt(resp.length), resp]))
        } else {
            const resp = Buffer.concat([
                writeVarInt(0x02), writeVarInt(msgId.value),
                Buffer.from([0x01]),
                Buffer.from('0d666d6c3a68616e647368616b65', 'hex'),
                Buffer.from([0x01, 0x63])
            ])
            sock.write(Buffer.concat([writeVarInt(resp.length), resp]))
        }
    }
}

// ===== PLAY =====
function handlePlayPacket(pkt) {
    const idInfo = readVarInt(pkt, 0);
    const id = idInfo.value;
    let o = idInfo.length;

    if (id === 0x23) { // Настоящий Keep Alive для 1.20.1
        const keepAliveId = pkt.slice(o, o + 8); // Читаем 8 байт (Long)
        // Отправляем ответ с ID 0x12 (Keep Alive Response)
        sendPlayPacket(0x12, keepAliveId);
        console.log('[PLAY] Keep-alive pong (fixed)');
        lastKeepAlive = Date.now();
        return;
    }

    if (id === 0x24) {
        // Это ЧАНКИ. Просто игнорируем или обрабатываем, но НЕ отвечаем на них
        return;
    }

    // Join Game
    if (id === 0x28 || id === 0x29 || id === 0x6b) {
        if (clientSettingsSent) { console.log('[JOIN] Duplicate, skip'); return }
        clientSettingsSent = true
        console.log('[LOGIN PLAY] Received - sending client settings')
        sendPlayPacket(0x08, Buffer.concat([
            writeString('ru_ru'),
                                           Buffer.from([0x08]),
                                           writeVarInt(0), Buffer.from([0x01]), Buffer.from([0x7F]),
                                           writeVarInt(1), Buffer.from([0x00]), Buffer.from([0x01])
        ]))
        console.log('[LOGIN PLAY] Sent client settings')
        return
    }

    // Keep Alive (для 1.20.1 ID = 0x24)
    if (id === 0x24) {
        const kaId = pkt.slice(o, o + 8) // Берем ровно 8 байт
        if (kaId.length < 8) return // Защита от коротких пакетов
            sendPlayPacket(0x12, kaId)
            lastKeepAlive = Date.now()
            console.log('[PLAY] Keep-alive pong')
            return
    }

    // Plugin Message
    if (id === 0x17) {
        const channel = readString(pkt, o)
        if (!channel) return
        const ch = channel.value
        console.log(`[PLUGIN MSG] ${ch}`)
        if (ch === 'minecraft:brand') {
            sendPlayPacket(0x0D, Buffer.concat([writeString('minecraft:brand'), writeString('forge')]))
            console.log('[PLUGIN MSG] Sent brand response')
        } else if (ch === 'minecraft:register') {
            sendPlayPacket(0x0D, Buffer.concat([writeString('minecraft:register'), Buffer.from('minecraft:brand', 'utf8')]))
            console.log('[PLUGIN MSG] Sent register response')
        }
        return
    }

    // Disconnect
    if (id === 0x1A) {
        const reason = readString(pkt, o)
        log(`❌ Кик: ${reason ? reason.value : 'unknown'}`)
        sock.destroy()
        return
    }

    // Chat
    if (id === 0x60 || id === 0x64 || id === 0x5F || id === 0x67) {
        const msg = readString(pkt, o)
        if (!msg) return
        const msgText = msg.value
        console.log('[CHAT]', msgText)
        chatHistory.push(msgText)
        if (chatHistory.length > 20) chatHistory.shift()

        const verifyMatch = msgText.match(/\/verify\s+([A-Z0-9]+)/i)
        if (verifyMatch) {
            const code = verifyMatch[1].toUpperCase()
            log(`🔐 Код верификации: ${code}\nОтправляю...`)
            setTimeout(() => {
                sendCommand(`verify ${code}`)
                log(`✅ /verify ${code} отправлена!`)
            }, 1000)
        }
        if (/success|успешно|verified/i.test(msgText)) log(`✅ Верификация успешна!\n${msgText}`)
        if (/invalid|неверный|wrong/i.test(msgText)) log(`❌ Неверный код!\n${msgText}`)
        return
    }

    // Health (0x57 для 1.20.1)
    if (id === 0x57 || id === 0x1F || id === 0x49) {
        if (pkt.length - o < 4) return; // Минимум для HP
        health = pkt.readFloatBE(o); o += 4;

        const fi = readVarInt(pkt, o);
        if (fi) {
            food = fi.value;
            o += fi.length;
        }

        console.log(`[HEALTH] HP:${health} Food:${food}`);
        if (health <= 0) {
            log('💀 Умер! Респаун...');
            sendPlayPacket(0x09, writeVarInt(0));
        }
        return;
    }

    // Synchronize Player Position (0x3E для 1.20.1)
    if (id === 0x3E || id === 0x3C || id === 0x38 || id === 0x39) {
        // Проверка: 3 Double (24) + 2 Float (8) + 1 Byte (1) = 33 байта + VarInt
        if (pkt.length - o < 34) {
            console.log(`[POS] Packet too short: ${pkt.length - o} bytes`);
            return;
        }

        try {
            posX = pkt.readDoubleBE(o); o += 8;
            posY = pkt.readDoubleBE(o); o += 8;
            posZ = pkt.readDoubleBE(o); o += 8;
            yaw = pkt.readFloatBE(o); o += 4;
            pitch = pkt.readFloatBE(o); o += 4;
            const flags = pkt.readUInt8(o); o += 1;

            const tidInfo = readVarInt(pkt, o);
            if (!tidInfo) return;
            const tid = tidInfo.value;

            console.log(`[POS] Teleport Confirm: ${Math.round(posX)} ${Math.round(posY)} ${Math.round(posZ)} (ID: ${tid})`);

            // Отвечаем пакету подтверждения (Teleport Confirm ID = 0x00 в Play)
            sendPlayPacket(0x00, writeVarInt(tid));

            startPositionUpdates();
        } catch (err) {
            console.log(`[POS] Error parsing: ${err.message}`);
        }
        return;
    }

    // Spawn Position
    if (id === 0x50 || id === 0x4D || id === 0x4C) {
        console.log('[SPAWN] Default spawn position received')
        return
    }

    // Game Event
    if (id === 0x1c || id === 0x1E || id === 0x20) {
        console.log(`[GAME_EVENT] ${pkt.readUInt8(o)}`)
        return
    }

    // Player Info
    if (id === 0x3A || id === 0x36 || id === 0x3B) {
        console.log('[PLAYER_INFO] received')
        return
    }
}

// ===== Подключение =====
function connect() {
    recvBuf = Buffer.alloc(0)
    gamePhase = 'login'
    compressionThreshold = -1
    isRunning = false
    chatHistory = []
    lastKeepAlive = Date.now()
    clientSettingsSent = false
    stopPositionUpdates()
    stopKeepAliveWatchdog()

    sock = net.createConnection(PORT, HOST, () => {
        console.log('[+] Connected!')
        sock.write(buildHandshake())
        sock.write(buildLoginStart())
    })
    sock.on('data', onData)
    sock.on('error', (e) => {
        log(`🔴 Ошибка: ${e.message}`)
        isRunning = false
        stopPositionUpdates()
        stopKeepAliveWatchdog()
    })
    sock.on('close', () => {
        log(`🔌 Отключён от сервера`)
        isRunning = false
        sock = null
        stopPositionUpdates()
        stopKeepAliveWatchdog()
    })
    sock.on('end', () => console.log('[SOCK] Server ended connection'))
    sock.setKeepAlive(true, 10000)
}

function disconnect() {
    if (sock) { sock.destroy(); sock = null }
    isRunning = false
    stopPositionUpdates()
    stopKeepAliveWatchdog()
}

function getStatus() {
    if (!isRunning) return '🔴 Оффлайн'
    const age = Math.round((Date.now() - lastKeepAlive) / 1000)
    return `🟢 Онлайн\n❤️ HP: ${health}/20\n🍖 Голод: ${food}/20\n📍 X:${Math.round(posX)} Y:${Math.round(posY)} Z:${Math.round(posZ)}\n⏱ Keep-alive: ${age}с назад`
}

// ===== Telegram =====
tbot.on('/join', (msg) => {
    if (msg.from.id !== ADMIN_ID) return
    if (isRunning) return msg.reply.text('Бот уже на сервере')
    connect()
    return msg.reply.text('⏳ Подключаюсь...')
})
tbot.on('/leave', (msg) => {
    if (msg.from.id !== ADMIN_ID) return
    disconnect()
    return msg.reply.text('👋 Отключён')
})
tbot.on('/code', (msg) => {
    if (msg.from.id !== ADMIN_ID) return
    const code = msg.text.split(' ')[1]
    if (!code) return msg.reply.text('Использование: /code XXXXXX')
    sendCommand(`verify ${code.toUpperCase()}`)
    return msg.reply.text(`✅ /verify ${code.toUpperCase()} отправлена`)
})
tbot.on('/status', (msg) => {
    if (msg.from.id !== ADMIN_ID) return
    return msg.reply.text(getStatus())
})
tbot.on('/chat', (msg) => {
    if (msg.from.id !== ADMIN_ID) return
    if (chatHistory.length === 0) return msg.reply.text('📭 Чат пуст')
    return msg.reply.text(`💬 Последние:\n\n${chatHistory.map((m, i) => `${i + 1}. ${m}`).join('\n\n')}`)
})
tbot.on('/say', (msg) => {
    if (msg.from.id !== ADMIN_ID) return
    const text = msg.text.replace('/say', '').trim()
    if (!text) return msg.reply.text('Использование: /say <текст>')
    sendChatMessage(text)
    return msg.reply.text(`✅ Отправлено: ${text}`)
})
tbot.on('/cmd', (msg) => {
    if (msg.from.id !== ADMIN_ID) return
    const cmd = msg.text.replace('/cmd', '').trim()
    if (!cmd) return msg.reply.text('Использование: /cmd <команда>')
    sendCommand(cmd)
    return msg.reply.text(`✅ /${cmd}`)
})

log('🤖 Бот запущен. /join чтобы зайти на сервер.')
tbot.start()
