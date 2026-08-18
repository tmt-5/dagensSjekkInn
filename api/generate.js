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
  'Fortid & minner': 'barndomsminner, pinlige øyeblikk, stolte øyeblikk, noe du angrer på, en "første gang", noe du mistet, noe du fant igjen',
  'Mat & sanser': 'smaker, lukter, matritualer, restaurantopplevelser, guilty pleasure-mat, det rareste du har spist',
  'Reise & steder': 'favorittsted, verste reise, et sted du har bodd, en reise du husker godt, hvordan du liker å reise (pakke lett/tungt, planlegge/improvisere)',
  'Penger & prioriteringer': 'hva er verdt å bruke mye penger på, hva fikser du aldri selv, et kjøp du er glad for, noe du sparer på i hverdagen',
  'Teknologi & fremtid': 'hva gleder deg ved fremtiden, hva gjør deg litt nervøs med teknologi, teknologi du har sluttet å bruke, noe du fortsatt gjør analogt eller på papir',
  'Relasjoner & sosiale situasjoner': 'hvem har lært deg mye, noe noen sa som har festet seg, pinlige sosiale situasjoner, hvordan du er i nye sosiale settinger',
  'Arbeid & kreativitet': 'hva du er god på, hva du ville gjort annerledes, hva du driver med utenom jobb, hvilken del av jobben du liker best',
  'Natur & dyr': 'favorittårstid, hvilket dyr du kjenner deg igjen i, det rareste du har sett i naturen, et natursted du liker å vende tilbake til',
  'Hverdagsliv & vaner': 'morgenrutiner, guilty pleasures, rare vaner, vaner du har gitt opp, hva du gjør annerledes enn de fleste',
  'Hypotetiske valg': 'enten/eller-valg, hva du ville gjort med en fridag, hva du ville studert hvis du startet på nytt',
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

/* ── System prompt ── */
function buildSystemPrompt(recentQuestions, category) {
  const dayOfWeek = new Date().toLocaleDateString('nb-NO', { weekday: 'long' });
  const dayHint = dayOfWeek === 'mandag'
    ? '\nDAGENS DAG er mandag – jobb gjerne mot fremover-energi og ny-uke-stemning.'
    : dayOfWeek === 'fredag'
    ? '\nDAGENS DAG er fredag – jobb gjerne mot refleksjon, avslutning og takknemlighet.'
    : '';

  let prompt = `Du er en kreativ assistent som genererer engasjerende sjekk-inn-spørsmål for daglige standup-møter i et profesjonelt team.${dayHint}
  
  Generer ETT spørsmål fra kategorien: **${category}**Mulige vinkler: ${CATEGORY_HINTS[category]}

  ${historyHint}

  Et godt spørsmål:
  - Er kort og enkelt – noe man kunne sagt høyt til en kollega over kaffen, ikke noe som ville stått i et essay
  - Spør om ÉN ting – ikke flere lag eller en innebygd vri i samme setning
  - Er konkret nok til at folk får et eksempel som svar, men trenger ikke være overraskende eller original i seg selv

  UNNGÅ denne typen struktur – den virker konstruert og mekanisk:
  - "Hva er en ting du [gjør/gjorde], som [betingelse], men som [overraskende motsetning]?"
  - "Hvilken [ting] hadde du som [da], som du [sluttet med], og som du nå [innser]?"
  Disse har flere bisetninger og et innbakt vendepunkt. Spørsmål med maks én bisetning er nesten alltid bedre.

  Eksempler på ØNSKET stil – enkle og direkte:
  - "Har du noen partytriks?"
  - "Fortell om den beste matopplelsen du har hatt."
  - "Jeg vet du ligner på deg selv, men har du noen gang hatt en lookalike?"
  - "Hvis du kunne lagt til en 0 hvor som helst i livet ditt, hvor ville du lagt den?"

  Eksempler på UØNSKET stil – for konstruert:
  - "Hvilken vane hadde du som barn som du bare sluttet med en dag, og som du nå innser var ganske genial?"
  - "Hva er en arbeidsoppgave du gjør som folk tror må være kjedelig, men som du faktisk koser deg med?"
  - "Hva er det siste du lærte deg som ikke var nyttig i det hele tatt, men som du er glad for å vite?"

  STRENGE FORBUD – aldri generer spørsmål om:
  - Superkrefter eller magiske evner
  - Hvilken kjendis eller historisk person du vil møte
  - Øde øy med tre ting
  - Tidsmaskin (fortids- eller fremtidsreise)
  - Zombie-apokalypse eller verdens undergang
  - Lotto/uventet rikdom i generell form

  Spørsmålet skal være maks 1-2 setninger, og det skal være passende for 
  et profesjonelt miljø.

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

  const [category, recentQuestions] = await Promise.all([
    getCurrentCategory(),
    getRecentQuestions(),
  ]);
  const systemPrompt = buildSystemPrompt(recentQuestions, category);

  const body = JSON.stringify({
    model: 'claude-sonnet-5',
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
