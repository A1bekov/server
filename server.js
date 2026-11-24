// Сервер отправки кодов: почта (Gmail) и SMS. Запуск: npm install && node --env-file=.env server.js
import http from 'node:http';
import nodemailer from 'nodemailer';

const { PORT = 3000, ALLOWED_ORIGIN, GMAIL_USER, GMAIL_APP_PASSWORD, TWILIO_SID, TWILIO_TOKEN, SMS_FROM } = process.env;
const BRAND = 'A1bekovMusic';

const mailer = nodemailer.createTransport({ service: 'gmail', auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD } });

// простой лимит: не больше 10 запросов с IP и 3 на адресата за 10 минут
const hits = new Map();
function limited(key, max) {
  const now = Date.now(), arr = (hits.get(key) || []).filter(t => now - t < 600000);
  arr.push(now); hits.set(key, arr);
  return arr.length > max;
}

async function sendMail(to, code) {
  await mailer.sendMail({
    from: `"${BRAND}" <${GMAIL_USER}>`,
    to,
    subject: `${BRAND} — код подтверждения`,
    text: `Ваш код: ${code}\nДействует 5 минут. Никому его не сообщайте.\n\n${BRAND}`,
    html: `<div style="font-family:Arial,sans-serif"><h2>${BRAND}</h2><p>Ваш код подтверждения:</p><p style="font-size:28px;letter-spacing:6px"><b>${code}</b></p><p>Действует 5 минут. Никому его не сообщайте.</p></div>`
  });
}

async function sendSms(to, code) {
  const body = new URLSearchParams({ To: to, From: SMS_FROM, Body: `${BRAND}: код ${code}. Действует 5 минут. Никому его не сообщайте.` });
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  if (!r.ok) throw new Error('sms ' + r.status);
}

const server = http.createServer(async (req, res) => {
  const cors = { 'Access-Control-Allow-Origin': ALLOWED_ORIGIN || '', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
  const out = (st, o) => { res.writeHead(st, { ...cors, 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (req.method === 'OPTIONS') return out(204, {});
  if (req.method !== 'POST' || req.url !== '/send-code') return out(404, { ok: false });
  if (ALLOWED_ORIGIN && req.headers.origin !== ALLOWED_ORIGIN) return out(403, { ok: false });

  let raw = ''; for await (const c of req) { raw += c; if (raw.length > 2000) return out(413, { ok: false }); }
  let d; try { d = JSON.parse(raw); } catch { return out(400, { ok: false }); }
  const { channel, to, code } = d || {};
  if (!/^\d{6}$/.test(String(code))) return out(400, { ok: false });
  if (limited('ip:' + req.socket.remoteAddress, 10) || limited('to:' + to, 3)) return out(429, { ok: false });

  try {
    if (channel === 'mail' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) await sendMail(to, code);
    else if (channel === 'sms' && /^\+?\d{10,15}$/.test(String(to).replace(/[\s()-]/g, ''))) await sendSms('+' + String(to).replace(/\D/g, ''), code);
    else return out(400, { ok: false });
    out(200, { ok: true });
  } catch (e) { console.error('send failed:', e.message); out(502, { ok: false }); }
});
server.listen(PORT, () => console.log('Code sender on :' + PORT));
