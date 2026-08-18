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

/* ── Storage backend ──
   Production uses Vercel KV. When KV isn't configured (local dev), fall back to
   a small JSON file on disk so history still works locally. */
const useKv = !!(kv && process.env.KV_REST_API_URL);
const DATA_FILE = path.join(__dirname, '.checkin-data.json');

function readLocal() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return { questions: [], categoryIndex: 0 };
  }
}

function writeLocal(data) {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); } catch {}
}

/* ── Categories ── */
const CATEGORIES = [
  'Fortid & minner',
  'Mat & sanser',
  'Reise & steder',
  'Penger & prioriteringer',
  'Teknologi & fremtid',
  'Relasjoner & sosiale situasjoner',
  'Arbeid & kreativitet',
  'Natur & dyr',
  'Hverdagsliv & vaner',
  'Hypotetiske valg',
];

const CATEGORY_HINTS = {
  'Fortid & minner': 'barndomsminner, pinlige øyeblikk, stolteste øyeblikk, ting du angrer på, første gang du ..., noe du mistet, noe du fant igjen',
  'Mat & sanser': 'smaker, lukter, matritualene, restaurantopplevelser, maten du skammer deg over å elske, det rareste du har spist',
  'Reise & steder': 'drømmemål, verste reise, overraskende favorittsted, steder du aldri vil tilbake til, steder du glemte å ta bilde av',
  'Penger & prioriteringer': 'hva ville du brukt en uventet million på, hva er verdt å bruke mye på, hva fikser du aldri selv, det kjøpet du aldri angret på',
  'Teknologi & fremtid': 'hva gleder deg ved fremtiden, hva skremmer deg, hvilken teknologi savner du ikke, hva gjør du fremdeles analogt',
  'Relasjoner & sosiale situasjoner': 'hvem har lært deg mest, hvem overrasket deg positivt, hva noen sa som festet seg, den pinligste sosiale situasjonen du overlevde',
  'Arbeid & kreativitet': 'hva er du uventet god på, hva ville du gjort annerledes, hva i jobben forventer folk at du misliker men du elsker, det du lager bare for deg selv',
  'Natur & dyr': 'favorittårstid og hvorfor, hvilket dyr beskriver deg akkurat nå, det rareste du har sett i naturen, naturstedet du alltid vender tilbake til',
  'Hverdagsliv & vaner': 'morgenrutiner, guilty pleasures, rare vaner, hva du gjør annerledes enn de fleste, vanen du ga opp og savner',
  'Hypotetiske valg': 'vanskelige enten/eller-valg, hva hadde du valgt med 24 timer fri og ubegrensede midler, hva hadde du studert på nytt',
};

/* ── KV helpers ── */
async function getCurrentCategory() {
  if (!useKv) {
    const data = readLocal();
    const idx = Number(data.categoryIndex) || 0;
    data.categoryIndex = (idx + 1) % CATEGORIES.length;
    writeLocal(data);
    return CATEGORIES[idx % CATEGORIES.length];
  }
  try {
    const idx = (await kv.get('checkin:category_index')) ?? 0;
    await kv.set('checkin:category_index', (Number(idx) + 1) % CATEGORIES.length);
    return CATEGORIES[Number(idx) % CATEGORIES.length];
  } catch {
    return CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];
  }
}

async function getRecentQuestions() {
  if (!useKv) return readLocal().questions.slice(0, 30);
  try {
    return await kv.lrange('checkin:questions', 0, 29);
  } catch {
    return [];
  }
}

async function saveQuestion(question, category) {
  const entry = {
    question,
    category,
    isoDate: new Date().toISOString().slice(0, 10),
    timestamp: Date.now(),
  };
  if (!useKv) {
    const data = readLocal();
    data.questions.unshift(entry);
    data.questions = data.questions.slice(0, 90);
    writeLocal(data);
    return;
  }
  try {
    await kv.lpush('checkin:questions', entry);
    await kv.ltrim('checkin:questions', 0, 89);
  } catch {}
}

async function getAllQuestions() {
  if (!useKv) return readLocal().questions;
  try {
    return await kv.lrange('checkin:questions', 0, -1);
  } catch {
    return [];
  }
}

/* ── System prompt ── */
function buildSystemPrompt(recentQuestions, category) {
  const dayOfWeek = new Date().toLocaleDateString('nb-NO', { weekday: 'long' });
  const dayHint = dayOfWeek === 'mandag'
    ? '\nDAGENS DAG er mandag – jobb gjerne mot fremover-energi og ny-uke-stemning.'
    : dayOfWeek === 'fredag'
    ? '\nDAGENS DAG er fredag – jobb gjerne mot refleksjon, avslutning og takknemlighet.'
    : '';

  let prompt = `Du er en kreativ assistent som genererer engasjerende sjekk-inn-spørsmål for daglige standup-møter i et profesjonelt team.${dayHint}

Generer ETT spørsmål fra kategorien: **${category}**
Mulige vinkler: ${CATEGORY_HINTS[category]}

Velg en UVENTET vinkel – ikke det første som faller deg inn. Unngå åpenbare og generiske varianter.

Eksempel på DÅRLIGE spørsmål (for generiske – IKKE lag disse):
- "Hvem ville du invitert til middag?"
- "Hva er drømmejobben din?"
- "Hvilken reise husker du best?"

Eksempel på GODE spørsmål (konkrete, overraskende, litt uventede):
- "Hva er det siste du lærte deg som ikke var nyttig i det hele tatt, men som du er glad for å vite?"
- "Hvilken matvare tok det deg lengst tid å like – og hva fikk deg til å snu?"
- "Hva er den rare vanen du har som du aldri har fortalt noen om?"

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

  const categoryRecent = recentQuestions.filter(q => q.category === category);
  if (categoryRecent.length > 0) {
    const list = categoryRecent.slice(0, 10).map(q => `- ${q.question}`).join('\n');
    prompt += `\n\nTidligere spørsmål fra denne kategorien – velg en helt annen vinkel:\n${list}`;
  }

  if (recentQuestions.length > 0) {
    const list = recentQuestions.slice(0, 30).map(q => `- ${q.question}`).join('\n');
    prompt += `\n\nAlle nylige spørsmål – ikke gjenta temaer:\n${list}`;
  }

  return prompt;
}

/* ── Anthropic call ── */
function callAnthropic(systemPrompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'claude-sonnet-5',
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
      const [category, recentQuestions] = await Promise.all([
        getCurrentCategory(),
        getRecentQuestions(),
      ]);
      const systemPrompt = buildSystemPrompt(recentQuestions, category);
      const question = await callAnthropic(systemPrompt);
      await saveQuestion(question, category);
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
  if (!useKv) console.warn(`  ⚠  KV_REST_API_URL ikke satt – bruker lokal fil (${path.basename(DATA_FILE)}) for historikk.\n`);
});
