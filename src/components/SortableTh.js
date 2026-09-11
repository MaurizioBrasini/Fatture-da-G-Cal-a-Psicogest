// Intestazione di colonna cliccabile per ordinare una tabella — condivisa tra
// Dashboard e Pazienti (prima era definita identica in entrambi i file).
//
// Supporta due modalità, scelte in base alla forma di `sort`:
// - oggetto singolo { key, dir } (Dashboard): un solo criterio, invariato.
// - array [{ key, dir }, ...] (Pazienti): ordinamento multi-colonna "a pila".
//   Cliccando una colonna già in cima (primaria) si inverte la direzione;
//   cliccando una colonna diversa, questa diventa la nuova primaria (in
//   testa, direzione asc) e le precedenti scalano di un posto come criteri
//   secondari — così "ordino per A poi per B" produce B primario, A
//   secondario, esattamente come un ordinamento a più colonne di un foglio
//   di calcolo.
const SUPERSCRIPT = ["", "¹", "²", "³", "⁴", "⁵", "⁶", "⁷", "⁸", "⁹"];

export default function SortableTh({ label, sortKey, sort, setSort, title }) {
  if (Array.isArray(sort)) {
    const idx = sort.findIndex((s) => s.key === sortKey);
    const active = idx !== -1;
    const dir = active ? sort[idx].dir : null;
    return (
      <th
        onClick={() =>
          setSort((prev) => {
            if (prev[0]?.key === sortKey) {
              return [{ key: sortKey, dir: prev[0].dir === "asc" ? "desc" : "asc" }, ...prev.slice(1)];
            }
            return [{ key: sortKey, dir: "asc" }, ...prev.filter((s) => s.key !== sortKey)];
          })
        }
        style={{ cursor: "pointer", userSelect: "none" }}
        title={title || (active && idx > 0 ? `Criterio secondario, priorità ${idx + 1}` : undefined)}
      >
        {label} {active ? (dir === "asc" ? "▲" : "▼") : ""}
        {active && idx > 0 ? SUPERSCRIPT[idx + 1] || `(${idx + 1})` : ""}
      </th>
    );
  }
  const active = sort.key === sortKey;
  return (
    <th
      onClick={() => setSort((s) => (s.key === sortKey ? { key: sortKey, dir: s.dir === "asc" ? "desc" : "asc" } : { key: sortKey, dir: "asc" }))}
      style={{ cursor: "pointer", userSelect: "none" }}
      title={title}
    >
      {label} {active ? (sort.dir === "asc" ? "▲" : "▼") : ""}
    </th>
  );
}
