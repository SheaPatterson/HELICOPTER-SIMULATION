/**
 * Layout for the public marketing surface (task 17.1; Requirements 10.1, 10.7).
 *
 * Wraps the seven public routes (/, /about, /safety, /fleet, /network,
 * /downloads, /contact) with shared navigation. This layout intentionally
 * applies NO authentication gate — public pages are served without prompting
 * for or requiring authentication (10.1). Pages under this group are static
 * server components where possible to honor the 3-second budget.
 */
import type { ReactNode } from "react";
import { PublicNav } from "./PublicNav";

export default function PublicLayout({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  return (
    <div>
      <header>
        <PublicNav />
      </header>
      {children}
    </div>
  );
}
