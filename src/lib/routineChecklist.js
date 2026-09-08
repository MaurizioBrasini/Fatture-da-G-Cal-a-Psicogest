// Checklist "routine di fine giornata" mostrata in Dashboard: tiene traccia
// di quali dei 3 passaggi (aggiorna dal calendario, registra disdette,
// rinumera tutti) sono già stati fatti OGGI — persistita in localStorage,
// per viewer (non condivisa tra dispositivi/browser), azzerata da sola ogni
// nuovo giorno perché la chiave include la data. Rinumera tutti si fa dalla
// pagina Pazienti (pagina diversa), quindi la scrittura da lì usa la stessa
// chiave per restare in sync quando si torna in Dashboard.

const STEPS = ["sync", "disdette", "rinumera"];

function chiave(dataISO) {
  return `routine-fine-giornata-${dataISO}`;
}

export function leggiRoutine(dataISO) {
  const vuota = Object.fromEntries(STEPS.map((s) => [s, false]));
  if (typeof window === "undefined") return vuota;
  try {
    const salvata = JSON.parse(window.localStorage.getItem(chiave(dataISO)) || "{}");
    return { ...vuota, ...salvata };
  } catch {
    return vuota;
  }
}

export function segnaRoutine(dataISO, step, valore = true) {
  if (typeof window === "undefined") return leggiRoutine(dataISO);
  const next = { ...leggiRoutine(dataISO), [step]: valore };
  try {
    window.localStorage.setItem(chiave(dataISO), JSON.stringify(next));
  } catch {}
  return next;
}
