// Intestazione di colonna cliccabile per ordinare una tabella — condivisa tra
// Dashboard e Pazienti (prima era definita identica in entrambi i file).
export default function SortableTh({ label, sortKey, sort, setSort }) {
  const active = sort.key === sortKey;
  return (
    <th
      onClick={() => setSort((s) => (s.key === sortKey ? { key: sortKey, dir: s.dir === "asc" ? "desc" : "asc" } : { key: sortKey, dir: "asc" }))}
      style={{ cursor: "pointer", userSelect: "none" }}
    >
      {label} {active ? (sort.dir === "asc" ? "▲" : "▼") : ""}
    </th>
  );
}
