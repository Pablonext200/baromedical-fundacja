const REGISTRATION_PHONE = '48510660100';

function sanitize(s, max = 200) {
  return String(s || '').replace(/[<>]/g, '').slice(0, max).trim();
}

function normalizePhone(s) {
  const digits = String(s || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('48') && digits.length === 11) return '+' + digits;
  if (digits.length === 9) return '+48' + digits;
  return '+' + digits;
}

async function readJSON(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 8000) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });

  let body;
  try { body = await readJSON(req); } catch { return res.status(400).json({ ok: false, error: 'Invalid JSON' }); }

  const imie = sanitize(body.imie, 80);
  const nazwisko = sanitize(body.nazwisko, 80);
  const telefon = normalizePhone(body.telefon);
  const email = sanitize(body.email, 120);
  const uwagi = sanitize(body.uwagi, 500);
  const termin = sanitize(body.termin, 120);

  if (!imie || !nazwisko || !telefon) {
    return res.status(400).json({ ok: false, error: 'Brakuje wymaganych danych: imię, nazwisko, telefon.' });
  }

  const ts = new Date().toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' });
  const lines = [
    'Nowa prosba o konsultacje HBOT',
    'Fundacja Baromedical / asystentka Tlenia',
    '',
    `Imie: ${imie} ${nazwisko}`,
    `Telefon: ${telefon}`,
  ];
  if (email) lines.push(`Email: ${email}`);
  if (termin) lines.push(`Termin: ${termin}`);
  if (uwagi) lines.push(`Uwagi: ${uwagi}`);
  lines.push('', `Zgloszono: ${ts}`);
  const message = lines.join('\n');

  let waSent = false;
  let waError = null;

  if (process.env.CALLMEBOT_API_KEY) {
    try {
      const url = `https://api.callmebot.com/whatsapp.php?phone=${REGISTRATION_PHONE}&text=${encodeURIComponent(message)}&apikey=${encodeURIComponent(process.env.CALLMEBOT_API_KEY)}`;
      const r = await fetch(url);
      const txt = await r.text();
      waSent = r.ok && /Message queued|Message Sent|message sent/i.test(txt);
      if (!waSent) waError = txt.slice(0, 200);
    } catch (e) {
      waError = String(e).slice(0, 200);
    }
  }

  const waLink = `https://wa.me/${REGISTRATION_PHONE}?text=${encodeURIComponent(message)}`;

  console.log('[BOOKING]', JSON.stringify({ imie, nazwisko, telefon, email, termin, uwagi, waSent, waError, ts }));

  return res.status(200).json({
    ok: true,
    waSent,
    waLink,
    summary: { imie, nazwisko, telefon, email, termin, uwagi },
    ts,
  });
};
