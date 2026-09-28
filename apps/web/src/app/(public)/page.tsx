/**
 * Public landing page `/` (task 17.1; Requirements 10.1, 10.7).
 *
 * Static server component served without authentication. Introduces the
 * platform and links to the onboarding surfaces (downloads, register).
 */
import Link from "next/link";
import type { ReactNode } from "react";

export default function HomePage(): ReactNode {
  return (
    <main aria-label="Virtual HEMS home">
      <h1>Virtual HEMS</h1>
      <p>
        A flight-following, mission-dispatch, clinical-simulation, and
        safety-management platform for helicopter emergency medical services
        (HEMS) simulation. Modeled on the Western Pennsylvania and tri-state
        regional HEMS system, Virtual HEMS connects Microsoft Flight Simulator
        and X-Plane to a live theater map, a four-stage dispatcher, a cockpit
        electronic flight bag, and a clinical Golden Hour model.
      </p>

      <p>This is a simulation and training system — it uses only simulated data.</p>

      <section aria-label="Get started">
        <h2>Get started</h2>
        <ul>
          <li>
            <Link href="/about">Learn how the platform works</Link>
          </li>
          <li>
            <Link href="/safety">Read the Safety Charter</Link>
          </li>
          <li>
            <Link href="/fleet">Explore the approved fleet</Link>
          </li>
          <li>
            <Link href="/downloads">Download the desktop bridge</Link>
          </li>
          <li>
            <Link href="/register">Register as a pilot</Link>
          </li>
        </ul>
      </section>
    </main>
  );
}
