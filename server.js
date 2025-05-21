// server.js
const makeWASocket = require("@whiskeysockets/baileys").default;
const { BufferJSON, initAuthCreds, useMultiFileAuthState } = require("@whiskeysockets/baileys");
const express = require("express");
const qrcode = require('qrcode');
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = 8000;
const sessions = {};

let currentQRCode = null;

// Function to start a new WhatsApp session
async function startWhatsAppSession(sessionId) {
    const authDir = path.join(__dirname, "auth", sessionId);
    if (!fs.existsSync(authDir)) fs.mkdirSync(authDir);

    const { state, saveCreds } = await useMultiFileAuthState(authDir);

    const sock = makeWASocket({
        auth: state,
        syncFullHistory: true,
    });

    sessions[sessionId] = sock;

    sock.ev.on("messages.upsert", async (m) => {
        const msg = m.messages[0];
        if (!msg.key.fromMe && msg.message) {
            const from = msg.key.remoteJid;
            const body = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
            console.log(`[${sessionId}] Message from ${from}: ${body}`);

            // Reply to the message
            await sock.sendMessage(from, { text: `Hello from session ${sessionId}!` });

            // Log the message
            const logFile = path.join(__dirname, "logs", `${sessionId}.log`);
            fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${from}: ${body}\n`);
        }
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          // You have the QR code string here
          console.log('QR code received, scan it with WhatsApp:');
          console.log(qr);
          currentQRCode = qr; // Save the QR for API

          // Optionally, you can generate a QR code image in terminal with 'qrcode-terminal'
          const qrcode = require('qrcode-terminal');
          qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
          console.log(`[${sessionId}] Connection closed. Reconnecting...`);
          if (lastDisconnect.error.output?.statusCode !== 401) {
            // If not logged out, reconnect
            startWhatsAppSession(sessionId);
          } else {
            console.log('Logged out. Please delete auth files and restart.');
          }
        } else if (connection === 'open') {
          console.log(`[${sessionId}] WhatsApp connection established.`);
          currentQRCode = null; // Clear QR when connected
        }
      });

    sock.ev.on("creds.update", saveCreds);
}

// Start the default sessions
startWhatsAppSession("session1");

// REST API to add more sessions dynamically
app.get("/add-session/:id", (req, res) => {
    const sessionId = req.params.id;
    if (sessions[sessionId]) {
        res.send(`Session ${sessionId} is already running.`);
    } else {
        startWhatsAppSession(sessionId);
        res.send(`Session ${sessionId} started.`);
    }
});

// Send a message via a specific session
app.get("/send/:id", async (req, res) => {
    const sessionId = req.params.id;
    const to = req.query.to;
    const message = req.query.message;

    if (sessions[sessionId]) {
        try {
            await sessions[sessionId].sendMessage(to, { text: message });
            res.send(`Message sent to ${to} via session ${sessionId}.`);
        } catch (error) {
            console.error(error);
            res.status(500).send(`Failed to send message via session ${sessionId}.`);
        }
    } else {
        res.status(404).send(`Session ${sessionId} not found.`);
    }
});

app.get('/qr', async (req, res) => {
    if (!currentQRCode) {
      return res.status(404).send('No QR code available');
    }
    // Convert the QR string to image data URL on request
    const qrDataURL = await qrcode.toDataURL(currentQRCode);
    res.json({ qrDataURL });
});

// List all active sessions
app.get("/sessions", (req, res) => {
    res.json(Object.keys(sessions));
});

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

// Start the Express server
app.listen(PORT, "0.0.0.0", () => {
    console.log(`WhatsApp Multi-Session API running on http://0.0.0.0:${PORT}`);
});
