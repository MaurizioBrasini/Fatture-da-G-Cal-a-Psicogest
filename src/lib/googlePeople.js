// Usa il refresh token salvato per ottenere un access token fresco da
// Google, poi legge i Contatti Google (People API, sola lettura).

async function getAccessToken(refreshToken) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error("Rinnovo del token Google fallito: " + text);
  }
  const data = await res.json();
  return data.access_token;
}

// Cache in memoria per processo (best-effort: sopravvive solo finché la
// funzione serverless resta "calda" tra un'invocazione e l'altra, niente di
// più) — riduce le chiamate ripetute all'API People quando arrivano più
// richieste ravvicinate (ricerca + verifica bulk, o più ricerche di
// fila). Senza questo, ogni singola ricerca riscaricava l'intera rubrica,
// ed è bastato sforare la quota di Google in un test reale ("quota
// exceeded" durante una sessione di prove ravvicinate).
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map(); // refreshToken -> { contatti, scaduta }

// Scarica TUTTI i contatti (paginando) invece di usare l'endpoint dedicato
// people:searchContacts — quello ha un indice di ricerca "warmed up" in
// modo asincrono lato Google e può restituire risultati vuoti/incompleti
// appena dopo l'abilitazione della People API o l'aggiunta di un
// contatto. Con un numero di contatti personali comunque limitato, è più
// affidabile scaricare la lista una volta per richiesta e filtrare qui.
export async function fetchAllGoogleContacts(refreshToken) {
  const cached = cache.get(refreshToken);
  if (cached && cached.scaduta > Date.now()) return cached.contatti;

  const accessToken = await getAccessToken(refreshToken);

  let contatti = [];
  let pageToken = undefined;
  do {
    const url = new URL("https://people.googleapis.com/v1/people/me/connections");
    url.searchParams.set("personFields", "names,emailAddresses,phoneNumbers,addresses");
    url.searchParams.set("pageSize", "1000");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) {
      const text = await res.text();
      throw new Error("Lettura dei Contatti Google fallita: " + text);
    }
    const data = await res.json();
    contatti = contatti.concat(
      (data.connections || [])
        .map((p) => ({
          resourceName: p.resourceName,
          nome: p.names?.[0]?.displayName || "",
          telefoni: (p.phoneNumbers || []).map((t) => t.value).filter(Boolean),
          email: (p.emailAddresses || []).map((e) => e.value).filter(Boolean),
          indirizzo: p.addresses?.[0]?.formattedValue || "",
        }))
        .filter((c) => c.nome)
    );
    pageToken = data.nextPageToken;
  } while (pageToken);

  // "Altri contatti": le persone con cui hai scambiato mail ma che non hai
  // mai salvato in rubrica. Google li tiene in un elenco separato
  // (otherContacts), che non compare in people/me/connections e richiede lo
  // scope contacts.other.readonly. Espone solo nome/email/telefono (niente
  // indirizzi). Se lo scope non è ancora stato concesso (login da rifare)
  // NON blocchiamo tutto: si continua con i soli contatti in rubrica e si
  // restituisce un avviso da mostrare.
  let avviso = null;
  try {
    const altri = await fetchOtherContacts(accessToken);
    const emailNote = new Set(contatti.flatMap((c) => c.email.map((e) => e.toLowerCase())));
    for (const a of altri) {
      // Se un contatto in rubrica ha già la stessa email, l'altro è un doppione.
      if (a.email.some((e) => emailNote.has(e.toLowerCase()))) continue;
      contatti.push(a);
    }
  } catch (e) {
    avviso =
      "Non ho potuto leggere gli \"Altri contatti\" di Google (quelli presi dalla posta): " +
      "esci e rifai il login per concedere il nuovo permesso. Uso solo la rubrica. " +
      `(${e.message.slice(0, 160)})`;
  }

  // Le proprietà su un array non finiscono nel JSON: le route lo passano a mano.
  contatti.avviso = avviso;
  cache.set(refreshToken, { contatti, scaduta: Date.now() + CACHE_TTL_MS });
  return contatti;
}

async function fetchOtherContacts(accessToken) {
  let altri = [];
  let pageToken = undefined;
  do {
    const url = new URL("https://people.googleapis.com/v1/otherContacts");
    url.searchParams.set("readMask", "names,emailAddresses,phoneNumbers");
    url.searchParams.set("pageSize", "1000");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) {
      const text = await res.text();
      throw new Error("Lettura degli Altri contatti fallita: " + text);
    }
    const data = await res.json();
    altri = altri.concat(
      (data.otherContacts || [])
        .map((p) => {
          const email = (p.emailAddresses || []).map((e) => e.value).filter(Boolean);
          return {
            resourceName: p.resourceName,
            // Molti "altri contatti" hanno solo l'email: in quel caso la
            // usiamo come nome, così restano trovabili anche per indirizzo.
            nome: p.names?.[0]?.displayName || email[0] || "",
            telefoni: (p.phoneNumbers || []).map((t) => t.value).filter(Boolean),
            email,
            indirizzo: "",
            daPosta: true,
          };
        })
        .filter((c) => c.nome)
    );
    pageToken = data.nextPageToken;
  } while (pageToken);
  return altri;
}
