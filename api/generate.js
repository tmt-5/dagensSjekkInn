const https = require('https');
const { kv } = require('@vercel/kv');

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
  try {
    const idx = (await kv.get('checkin:category_index')) ?? 0;
    await kv.set('checkin:category_index', (Number(idx) + 1) % CATEGORIES.length);
    return CATEGORIES[Number(idx) % CATEGORIES.length];
  } catch {
    return CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];
  }
}

async function getRecentQuestions() {
  try {
    return await kv.lrange('checkin:questions', 0, 29);
  } catch {
    return [];
  }
}

async function saveQuestion(question, category) {
  try {
    await kv.lpush('checkin:questions', {
      question,
      category,
      isoDate: new Date().toISOString().slice(0, 10),
      timestamp: Date.now(),
    });
    await kv.ltrim('checkin:questions', 0, 89);
  } catch {}
}

async function getReactions() {
  try {
    const [up, down] = await Promise.all([
      kv.hgetall('checkin:reactions:up'),
      kv.hgetall('checkin:reactions:down'),
    ]);
    return { up: up || {}, down: down || {} };
  } catch {
    return { up: {}, down: {} };
  }
}

/* ── System prompt ── */
function buildSystemPrompt(recentQuestions, category, reactions) {
  const { up, down } = reactions || { up: {}, down: {} };
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

  const liked = recentQuestions
    .filter(q => (Number(up[q.question]) || 0) >= 1)
    .sort((a, b) => (Number(up[b.question]) || 0) - (Number(up[a.question]) || 0))
    .slice(0, 5);

  const disliked = recentQuestions
    .filter(q => (Number(down[q.question]) || 0) >= 1)
    .sort((a, b) => (Number(down[b.question]) || 0) - (Number(down[a.question]) || 0))
    .slice(0, 5);

  if (liked.length > 0) {
    const list = liked.map(q => `- ${q.question}`).join('\n');
    prompt += `\n\nSpørsmål teamet likte godt – lag lignende (men ikke repeter):\n${list}`;
  }

  if (disliked.length > 0) {
    const list = disliked.map(q => `- ${q.question}`).join('\n');
    prompt += `\n\nSpørsmål teamet ikke likte – unngå disse typene:\n${list}`;
  }

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

/* ── Handler ── */
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!API_KEY) {
    res.status(500).json({ error: 'ANTHROPIC_API_KEY er ikke konfigurert på serveren.' });
    return;
  }

  const [category, recentQuestions, reactions] = await Promise.all([
    getCurrentCategory(),
    getRecentQuestions(),
    getReactions(),
  ]);
  const systemPrompt = buildSystemPrompt(recentQuestions, category, reactions);

  const body = JSON.stringify({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 150,
    system: systemPrompt,
    messages: [{ role: 'user', content: 'Generer ett spørsmål.' }]
  });

  try {
    const question = await callWithRetry(API_KEY, body);
    await saveQuestion(question, category);
    res.status(200).json({ question });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Noe gikk galt.' });
  }
};

async function callWithRetry(apiKey, body, attempts = 2) {
  for (let i = 0; i < attempts; i++) {
    try {
      return await callAnthropic(apiKey, body);
    } catch (err) {
      const isOverloaded = err.code === 'overloaded';
      const isLastAttempt = i === attempts - 1;
      if (isOverloaded && !isLastAttempt) {
        await new Promise(r => setTimeout(r, 1500));
        continue;
      }
      throw err;
    }
  }
}

function friendlyError(apiError) {
  switch (apiError.type) {
    case 'overloaded_error':
      return 'API-en er overbelastet akkurat nå – prøver igjen...';
    case 'authentication_error':
      return 'Ugyldig API-nøkkel. Sjekk ANTHROPIC_API_KEY i Vercel.';
    case 'rate_limit_error':
      return 'For mange forespørsler. Vent litt og prøv igjen.';
    default:
      return apiError.message || 'Noe gikk galt med API-kallet.';
  }
}

function callAnthropic(apiKey, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            const err = new Error(friendlyError(parsed.error));
            err.code = parsed.error.type;
            reject(err);
            return;
          }
          resolve(parsed.content[0].text.trim());
        } catch (e) {
          reject(new Error('Kunne ikke tolke API-svaret.'));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
