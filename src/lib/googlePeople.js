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

// Scarica TUTTI i contatti (paginando) invece di usare l'endpoint dedicato
// people:searchContacts — quello ha un indice di ricerca "warmed up" in
// modo asincrono lato Google e può restituire risultati vuoti/incompleti
// appena dopo l'abilitazione della People API o l'aggiunta di un
// contatto. Con un numero di contatti personali comunque limitato, è più
// affidabile scaricare la lista una volta per richiesta e filtrare qui.
export async function fetchAllGoogleContacts(refreshToken) {
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

  return contatti;
}
