import Link from "next/link";

export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="shell">
      <header className="topbar">
        <Link href="/" className="brand">
          <span className="brand-dot" /> Crashlab Studio
        </Link>
        <nav className="nav">
          <Link href="/">案例</Link>
          <Link href="/assets">资产库</Link>
        </nav>
      </header>
      <main>{children}</main>
    </div>
  );
}
