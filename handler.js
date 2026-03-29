import {
  downloadMediaMessage,
} from "baileys";
import moment from "moment-timezone";
import anyAscii from "any-ascii";
import Pino from "pino";
import axios from "axios";
import fs from "fs";

import { msgFilter, color } from "./lib/utils.js";
import setting from "./setting.js";

moment.tz.setDefault("Asia/Jakarta").locale("id");

// Database sederhana untuk memori AI (Simpan di memory/JSON)
const aiMemory = {};

let msgHandler = async (upsert, sock, message) => {
  try {
    let { text, chat, sender, isGroup, pushName, mtype, quoted } = message;
    if (sender === "") return;

    const t = message.messageTimestamp;
    const groupMetadata = isGroup ? await sock.groupMetadata(chat) : {};
    const botNumber = sock.user.id.split(":")[0] + "@s.whatsapp.net";
    const ownerNumber = setting.owner + "@s.whatsapp.net";
    
    const isOwner = sender === ownerNumber;
    const isBotGroupAdmins = isGroup ? groupMetadata.participants.find(p => p.id === botNumber)?.admin : false;
    const isGroupAdmins = isGroup ? groupMetadata.participants.find(p => p.id === sender)?.admin : false;

    // Menangani Pesan & Command
    let budy = (typeof text == 'string' ? text : '');
    const prefix = /^[.#!]/.test(budy) ? budy.match(/^[.#!]/gi) : ".";
    const isCmd = budy.startsWith(prefix);
    const command = isCmd ? budy.slice(1).trim().split(/ +/).shift().toLowerCase() : "";
    const args = budy.trim().split(/ +/).slice(1);
    const q = args.join(" ");

    // Logging
    if (isCmd) {
      console.log(color("[EXEC]"), color(moment(t * 1000).format("HH:mm:ss"), "yellow"), color(command), "from", color(pushName));
    }

    // --- FITUR AUTO READ STATUS ---
    if (message.key && message.key.remoteJid === "status@broadcast") {
      await sock.readMessages([message.key]);
      return;
    }

    // --- FITUR AUTO AI (OFFLINE MODE) ---
    // Aktif jika bukan command, bukan grup, dan bukan dari bot sendiri
    if (!isCmd && !isGroup && sender !== botNumber) {
      if (!aiMemory[sender]) aiMemory[sender] = [];
      
      const systemPrompt = "Nama saya Farhan, saya adalah developer bot ini. Balas dengan ramah dan santai.";
      const history = aiMemory[sender].slice(-20).join("\n"); // Ambil 20 chat terakhir
      
      try {
        const { data } = await axios.get(`https://api-faa.my.id/faa/ai-realtime?text=${encodeURIComponent(systemPrompt + "\nHistory:\n" + history + "\nUser: " + budy)}`);
        if (data.result) {
          await message.reply(data.result);
          aiMemory[sender].push(`User: ${budy}`, `AI: ${data.result}`);
        }
      } catch (e) {
        console.error("AI Error:", e);
      }
    }

    // --- LOGIKA COMMAND ---
    switch (command) {
      
      // FITUR DEVELOPER
      case "dev":
        const devText = `*DEVELOPER INFO*\n\n` +
                        ` Nama: Farhan Kertadiwangsa\n` +
                        ` No: 6282336479077\n` +
                        ` Status: 7th Grade Student (SMP)\n\n` +
                        `"Yang butuh jasa bikin bot custom bisa pm ke saya"`;
        // Menggunakan font 'monoSpace' dari Messages.js
        await message.reply(devText, "monoSpace");
        break;

      // FITUR STICKER
      case "s": case "sticker":
        if (mtype === "imageMessage" || (quoted && quoted.mtype === "imageMessage")) {
          const download = quoted ? quoted : message;
          const buffer = await download.download();
          await sock.sendMessage(chat, { sticker: buffer }, { quoted: message });
        } else {
          message.reply("Kirim atau reply foto dengan caption .s");
        }
        break;

      // FITUR RVO (Read View Once)
      case "rvo":
        if (quoted && quoted.message?.viewOnceMessageV2) {
          const vOnce = quoted.message.viewOnceMessageV2;
          const type = Object.keys(vOnce.message)[0];
          const buffer = await downloadMediaMessage(quoted, "buffer", {}, { Pino, reuploadRequest: sock.updateMediaMessage });
          await sock.sendMessage(chat, { [type.includes("image") ? "image" : "video"]: buffer, caption: "Anti View Once" }, { quoted: message });
        } else {
          message.reply("Reply pesan view once!");
        }
        break;

      // FITUR MANAJEMEN GRUP
      case "kick":
        if (!isGroup) return message.reply("Hanya di grup!");
        if (!isGroupAdmins && !isOwner) return message.reply("Anda bukan admin!");
        if (!isBotGroupAdmins) return message.reply("Bot harus jadi admin!");
        let users = message.mentionedJid[0] ? message.mentionedJid[0] : quoted ? quoted.sender : q.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
        await sock.groupParticipantsUpdate(chat, [users], "remove");
        break;

      case "add":
        if (!isGroup) return message.reply("Hanya di grup!");
        if (!isGroupAdmins && !isOwner) return message.reply("Anda bukan admin!");
        if (!isBotGroupAdmins) return message.reply("Bot harus jadi admin!");
        await sock.groupParticipantsUpdate(chat, [q.replace(/[^0-9]/g, '') + '@s.whatsapp.net'], "add");
        break;

      case "hidetag":
        if (!isGroup || (!isGroupAdmins && !isOwner)) return;
        const mems = groupMetadata.participants.map(v => v.id);
        await sock.sendMessage(chat, { text: q ? q : '', mentions: mems });
        break;

      // FITUR BRAT
      case "brat":
        if (!q) return message.reply("Masukkan teks!");
        try {
          const bratUrl = `https://api-faa.my.id/faa/brat?text=${encodeURIComponent(q)}`;
          await sock.sendMessage(chat, { sticker: { url: bratUrl } }, { quoted: message });
        } catch (e) {
          message.reply("Gagal membuat brat.");
        }
        break;

      case "ping":
        await message.reply(`Pong! Speed: ${Date.now() - t * 1000} ms`);
        break;

      default:
        break;
    }
  } catch (err) {
    console.log(color("[ERROR]", "red"), err);
  }
};

export { msgHandler };