const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.ANTHROPIC_API_KEY;

/* ── Vercel KV (optional for local dev) ── */
let kv = null;
try {
  kv = require('@vercel/kv').kv;
} catch {}

async function getRecentQuestions() {
  if (!kv || !process.env.KV_REST_API_URL) return [];
  try {
    return await kv.lrange('checkin:questions', 0, 19);
  } catch {
    return [];
  }
}

async function saveQuestion(question) {
  if (!kv || !process.env.KV_REST_API_URL) return;
  try {
    await kv.lpush('checkin:questions', {
      question,
      isoDate: new Date().toISOString().slice(0, 10),
      timestamp: Date.now(),
    });
    await kv.ltrim('checkin:questions', 0, 89);
  } catch {}
}

async function getAllQuestions() {
  if (!kv || !process.env.KV_REST_API_URL) return [];
  try {
    return await kv.lrange('checkin:questions', 0, -1);
  } catch {
    return [];
  }
}

/* ── System prompt ── */
const BASE_SYSTEM_PROMPT = `Du er en kreativ assistent som genererer engasjerende sjekk-inn-spørsmål for daglige standup-møter i et profesjonelt team.

Generer ETT spørsmål. Roter mellom disse kategoriene i rekkefølge, og velg én tilfeldig underkategori:

KATEGORIER (velg én, veksle bredt):
- Fortid & minner: barndomsminner, pinlige øyeblikk, stolteste øyeblikk, ting du angrer på
- Mat & sanser: smaker, lukter, ritualer, restaurantopplevelser
- Reise & steder: drømmemål, verste reise, overraskende favorittsted
- Penger & prioriteringer: hva ville du brukt en uventet million på, hva er verdt å bruke mye på
- Teknologi & fremtid: hva gleder/skremmer deg ved fremtiden, hvilken teknologi savner du ikke
- Relasjoner & sosiale situasjoner: hvem ville du invitert til middag, hvem har lært deg mest
- Arbeid & kreativitet: drømmejobb, hva ville du gjort annerledes, hva er du uventet god på
- Natur & dyr: favorittårstid og hvorfor, hvilket dyr beskriver deg i dag
- Hverdagsliv & vaner: morgenrutiner, guilty pleasures, rare vaner
- Hypotetiske valg: vanskelige enten/eller-valg uten superkrefter

STRENGE FORBUD – aldri generer spørsmål om:
- Superkrefter eller magiske evner
- Hvilken kjendis du vil møte
- Øde øy med tre ting
- Tidsmaskinen (fortid/fremtid-reise)
- Zombie-apokalypse

Spørsmålet skal være:
- Kort (maks 1-2 setninger)
- Konkret og samtalevekkende – ikke abstrakt
- Passende for et profesjonelt miljø
- Ha et klart svar folk faktisk kan gi raskt

Svar KUN med selve spørsmålet – ingen forklaring, ingen prefiks, ingen hermetegn.`;

function buildSystemPrompt(recentQuestions) {
  if (!recentQuestions || recentQuestions.length === 0) return BASE_SYSTEM_PROMPT;
  const list = recentQuestions.slice(0, 20).map(q => `- ${q.question}`).join('\n');
  return `${BASE_SYSTEM_PROMPT}\n\nTidligere stilte spørsmål – unngå å gjenta disse temaene eller stille lignende spørsmål:\n${list}`;
}

/* ── Anthropic call ── */
function callAnthropic(systemPrompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 150,
      system: systemPrompt,
      messages: [{ role: 'user', content: 'Generer ett spørsmål.' }]
    });

    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const apiReq = https.request(options, (apiRes) => {
      let data = '';
      apiRes.on('data', chunk => { data += chunk; });
      apiRes.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            const err = new Error(parsed.error.message || 'API-feil');
            err.code = parsed.error.type;
            reject(err);
            return;
          }
          resolve(parsed.content[0].text.trim());
        } catch {
          reject(new Error('Kunne ikke tolke API-svaret.'));
        }
      });
    });

    apiReq.on('error', reject);
    apiReq.write(body);
    apiReq.end();
  });
}

/* ── HTTP server ── */
const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    const filePath = path.join(__dirname, 'index.html');
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
    return;
  }

  if (req.method === 'GET' && req.url === '/history') {
    const questions = await getAllQuestions();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ questions }));
    return;
  }

  if (req.method === 'POST' && req.url === '/generate') {
    if (!API_KEY) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'ANTHROPIC_API_KEY er ikke satt på serveren.' }));
      return;
    }

    try {
      const recentQuestions = await getRecentQuestions();
      const systemPrompt = buildSystemPrompt(recentQuestions);
      const question = await callAnthropic(systemPrompt);
      await saveQuestion(question);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ question }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message || 'Noe gikk galt.' }));
    }
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`\n  ▶ Dagens Sjekk-inn kjører på http://localhost:${PORT}\n`);
  if (!API_KEY) console.warn('  ⚠  ADVARSEL: ANTHROPIC_API_KEY er ikke satt!\n');
  if (!process.env.KV_REST_API_URL) console.warn('  ⚠  KV_REST_API_URL ikke satt – historikk deaktivert lokalt.\n');
});
