/**
 * Public network page `/network` (task 17.1; Requirements 10.1, 10.7).
 *
 * Static server component served without authentication. Describes the regional
 * HEMS network at an aggregate, non-identifying level only — no patient,
 * clinical, VIRS, or individual-pilot data (8.7).
 */
import type { ReactNode } from "react";

export const metadata = {
  title: "Network | Virtual HEMS",
};

export default function NetworkPage(): ReactNode {
  return (
    <main aria-label="Regional network">
      <h1>Regional network</h1>
      <p>
        Virtual HEMS models the Western Pennsylvania and tri-state regional HEMS
        network, drawing on the documented STAT MedEvac and AHN LifeFlight
        operating model. Bases, hospitals, and helipads are placed on real
        regional geography for authentic flight-following and dispatch training.
      </p>

      <section aria-label="Network overview">
        <h2>What the network includes</h2>
        <ul>
          <li>HEMS bases distributed across the regional coverage area.</li>
          <li>
            Receiving hospitals with modeled helipad surfaces, placement, and
            trauma capability.
          </li>
          <li>
            Spatial facility recommendation that respects capability, helipad
            status, and route constraints.
          </li>
        </ul>
      </section>

      <p>
        Only aggregate, de-identified network information is shown here. No
        patient, clinical, incident, or individual operational records are
        exposed on public pages.
      </p>
    </main>
  );
}
