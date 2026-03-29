process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
import {
  makeWASocket,
  fetchLatestBaileysVersion,
  DisconnectReason,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  jidDecode,
  Browsers
} from "baileys";
import qrcode from "qrcode-terminal";
import Pino from "pino";
import readline from "readline"; // Tambahkan untuk input nomor
import { msgHandler as initialMsgHandler } from "./handler.js";
import moment from "moment-timezone";
import chokidar from "chokidar";
import { Messages } from "./lib/Messages.js";
import fs from "fs";

let msgHandler = initialMsgHandler;
moment.tz.setDefault("Asia/Jakarta").locale("id");

const logger = Pino({ level: "silent" });
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (text) => new Promise((resolve) => rl.question(text, resolve));

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(`./session`);
  const { version } = await fetchLatestBaileysVersion();
  
  const sock = makeWASocket({
     auth: {
       creds: state.creds,
       keys: makeCacheableSignalKeyStore(state.keys, logger),
     },
     version: version,
     logger: logger,  
     printQRInTerminal: false, // Matikan auto-print QR agar tidak bentrok dengan Pairing
     browser: Browsers.ubuntu('Chrome') // Penting untuk Pairing Code agar terdeteksi sebagai Linux/Chrome
   });

  // LOGIKA PAIRING CODE
  if (!sock.authState.creds.registered) {
    const phoneNumber = await question('Masukkan nomor WhatsApp bot (contoh: 62823xxx): ');
    const code = await sock.requestPairingCode(phoneNumber.trim());
    console.log(`\nKODE PAIRING ANDA: ${code}\n`);
    console.log('Masukkan kode tersebut di WhatsApp: Perangkat Tertaut > Tautkan Perangkat > Tautkan dengan nomor telepon saja.');
  }

  sock.ev.process(async (ev) => {
    if (ev["connection.update"]) {
      const update = ev["connection.update"];
      const { connection, lastDisconnect } = update;
      const status = lastDisconnect?.error?.output?.statusCode;

      if (connection === 'close') {
        const reason = Object.entries(DisconnectReason).find(i => i[1] === status)?.[0] || 'unknown';
        console.log(`session | Closed connection: ${reason} (${status})`);
        
        if (status !== DisconnectReason.loggedOut) {
          connectToWhatsApp();
        } else {
          fs.rmSync(`./session`, { recursive: true, force: true });
          connectToWhatsApp();
        }
      } else if (connection === 'open') {
        console.log(`session Connected: ${sock.user.id.split(':')[0]}`);
      }
    }

    if (ev["creds.update"]) {
      await saveCreds();
    }
    
    const upsert = ev["messages.upsert"];
    if (upsert && upsert.type === "notify") {
      const message = Messages(upsert, sock);
      if (message.key.remoteJid !== "status@broadcast" && !message.key.fromMe) {
        msgHandler(upsert, sock, message);
      }
    }

    if (ev["call"]) {
      const call = ev["call"];
      let { id, chatId, isGroup } = call[0];
      if (!isGroup) {
        await sock.rejectCall(id, chatId);
        await sock.sendMessage(chatId, { text: "Tidak bisa menerima panggilan suara/video." });
      }
    }
  });
}

connectToWhatsApp();

// Hot Reload Logic
const watcher = chokidar.watch('./handler.js', { persistent: true });
watcher.on('change', async (path) => {
  try {
    const newHandlerModule = await import(`./handler.js?cacheBust=${Date.now()}`);
    msgHandler = newHandlerModule.msgHandler;
    console.log("Handler updated!");
  } catch (err) {
    console.error("Update error:", err);
  }
});