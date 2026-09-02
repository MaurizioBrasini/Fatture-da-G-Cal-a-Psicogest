"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const ITEMS = [
  { href: "/", label: "Da fatturare" },
  { href: "/pazienti", label: "Pazienti" },
  { href: "/storico", label: "Storico fatture" },
  { href: "/impostazioni", label: "Impostazioni" },
];

export default function Sidebar({ readyCount }) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();

  async function logout() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">§</div>
        <div>
          <div className="brand-title">Fatturazione studio</div>
          <div className="brand-sub">conteggio sedute → Psicogest</div>
        </div>
      </div>
      <nav>
        {ITEMS.map((item) => (
          <Link key={item.href} href={item.href} className={pathname === item.href ? "nav-item active" : "nav-item"}>
            {item.label}
            {item.href === "/" && readyCount > 0 && <span className="nav-badge">{readyCount}</span>}
          </Link>
        ))}
      </nav>
      <div className="sidebar-foot">
        <button className="btn btn-ghost" style={{ width: "100%" }} onClick={logout}>
          Esci
        </button>
      </div>
    </aside>
  );
}
