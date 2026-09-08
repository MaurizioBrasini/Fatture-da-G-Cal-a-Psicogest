// Usa il refresh token salvato per ottenere un access token fresco da Google,
// poi legge gli eventi del calendario nel periodo richiesto.

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

export async function fetchGoogleCalendarEvents(refreshToken, fromDate, toDate) {
  const accessToken = await getAccessToken(refreshToken);

  const timeMin = new Date(fromDate + "T00:00:00").toISOString();
  const timeMax = new Date(toDate + "T23:59:59").toISOString();

  let events = [];
  let pageToken = undefined;
  do {
    const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
    url.searchParams.set("timeMin", timeMin);
    url.searchParams.set("timeMax", timeMax);
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("maxResults", "2500");
    url.searchParams.set("orderBy", "startTime");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) {
      const text = await res.text();
      throw new Error("Lettura del calendario fallita: " + text);
    }
    const data = await res.json();
    events = events.concat(
      (data.items || []).map((ev) => {
        const startDateTime = ev.start?.dateTime || "";
        return {
          id: ev.id,
          data: (ev.start?.date || startDateTime || "").slice(0, 10),
          ora: startDateTime ? startDateTime.slice(11, 16) : null, // "HH:MM" oppure null se evento "tutto il giorno"
          titolo: ev.summary || "",
          // Testo attuale della nota dell'evento (necessario per poter
          // sostituire solo il codice numerico, senza cancellare il resto:
          // link Meet/Zoom, promemoria, ecc.)
          descrizione: ev.description || "",
          // Presente solo per le occorrenze di eventi ricorrenti: identifica
          // a quale serie appartiene questa singola occorrenza.
          recurringEventId: ev.recurringEventId || null,
          // Ultimo aggiornamento dell'evento (Google lo mantiene da solo).
          // Usato come proxy di "quando è stata scritta la nota di disdetta"
          // per calcolare il preavviso rispetto alla data della seduta.
          updated: ev.updated || null,
          // null/assente = colore di default (confermato); "6" = Tangerine/
          // mandarino (da confermare) — vedi updateGoogleCalendarEventColor.
          colorId: ev.colorId || null,
        };
      }).filter((e) => e.data)
    );
    pageToken = data.nextPageToken;
  } while (pageToken);

  return events;
}

// Aggiorna il testo della nota (descrizione) di un singolo evento del
// calendario. Va usata passando la descrizione GIÀ COMPLETA che deve
// risultare (compresa la parte da preservare, tipo link Meet/Zoom) — questa
// funzione si limita a scrivere quel testo su Google, senza fare unione o
// sostituzioni: quella logica va fatta prima di chiamarla.
export async function updateGoogleCalendarEventDescription(refreshToken, eventId, newDescription) {
  const accessToken = await getAccessToken(refreshToken);

  const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ description: newDescription }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error("Scrittura sull'evento del calendario fallita: " + text);
  }
  return res.json();
}

// Aggiorna solo il titolo (summary) di un evento esistente — es. per
// correggere la grafia del nome paziente (TUTTO MAIUSCOLO -> Prima
// maiuscola) su eventi già creati con la grafia sbagliata. Non tocca
// nessun altro campo dell'evento.
export async function updateGoogleCalendarEventTitle(refreshToken, eventId, newTitle) {
  const accessToken = await getAccessToken(refreshToken);

  const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ summary: newTitle }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error("Scrittura del titolo sull'evento del calendario fallita: " + text);
  }
  return res.json();
}

// Rimuove un evento dal calendario. Usata SOLO per le disdette con
// preavviso ≥48h (billing_status = not_charged): libera lo slot da subito.
// Le buche (charged) non vanno mai cancellate da qui — restano a calendario
// per pulizia storica, per costruzione del chiamante.
export async function deleteGoogleCalendarEvent(refreshToken, eventId) {
  const accessToken = await getAccessToken(refreshToken);

  const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  // Google risponde 410 Gone se l'evento è già stato cancellato in
  // precedenza (es. a mano, o da un giro precedente non completato) — non è
  // un errore da bloccare, il risultato che vogliamo (evento assente) è già
  // raggiunto.
  if (!res.ok && res.status !== 410 && res.status !== 404) {
    const text = await res.text();
    throw new Error("Cancellazione dell'evento dal calendario fallita: " + text);
  }
}

// Crea un singolo evento NON ricorrente (motore appuntamenti: il generatore
// crea un evento per ciascuna occorrenza calcolata da patient_slots, invece
// di affidarsi a una RRULE nativa — vedi "Perché non usare RRULE native" in
// istruzioni-claude-code-appuntamenti.md). data: "YYYY-MM-DD", ora: "HH:MM".
export async function createGoogleCalendarEvent(refreshToken, { data, ora, durataMinuti, titolo, descrizione, colorId }) {
  const accessToken = await getAccessToken(refreshToken);

  const inizio = `${data}T${ora}:00`;
  const [h, m] = ora.split(":").map(Number);
  const fineMinuti = h * 60 + m + durataMinuti;
  const fine = `${data}T${String(Math.floor(fineMinuti / 60) % 24).padStart(2, "0")}:${String(fineMinuti % 60).padStart(2, "0")}:00`;

  const body = {
    summary: titolo,
    description: descrizione || "",
    start: { dateTime: inizio, timeZone: "Europe/Rome" },
    end: { dateTime: fine, timeZone: "Europe/Rome" },
  };
  // colorId omesso = colore di default dell'evento (confermato); valorizzato
  // (es. "6" Tangerine/mandarino) per segnalare "da confermare".
  if (colorId) body.colorId = colorId;

  const res = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error("Creazione dell'evento sul calendario fallita: " + text);
  }
  return res.json();
}

// Cambia solo il colore di un evento esistente (bottone app confermato/da
// confermare — sezione 6 del piano di ripopolamento calendario). colorId
// null = torna al colore di default (confermato); "6" = Tangerine/mandarino
// (da confermare). PATCH invece di update: non tocca nessun altro campo
// dell'evento (titolo, descrizione, orario restano quelli che sono).
export async function updateGoogleCalendarEventColor(refreshToken, eventId, colorId) {
  const accessToken = await getAccessToken(refreshToken);

  const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ colorId: colorId || null }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error("Scrittura del colore sull'evento del calendario fallita: " + text);
  }
  return res.json();
}
