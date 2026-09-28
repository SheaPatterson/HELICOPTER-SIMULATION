/**
 * Shared navigation for the public marketing surface (task 17.1;
 * Requirements 10.1, 10.7). Static server component — no client JS, no auth —
 * so every public page stays inside the 3-second budget.
 */
import Link from "next/link";
import type { ReactNode } from "react";

const PUBLIC_LINKS: ReadonlyArray<{ href: string; label: string }> = [
  { href: "/", label: "Home" },
  { href: "/about", label: "About" },
  { href: "/safety", label: "Safety" },
  { href: "/fleet", label: "Fleet" },
  { href: "/network", label: "Network" },
  { href: "/downloads", label: "Downloads" },
  { href: "/contact", label: "Contact" },
];

export function PublicNav(): ReactNode {
  return (
    <nav aria-label="Public site navigation">
      <ul>
        {PUBLIC_LINKS.map((link) => (
          <li key={link.href}>
            <Link href={link.href}>{link.label}</Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
