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
