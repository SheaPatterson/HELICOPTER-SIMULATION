/**
 * Public fleet page `/fleet` (task 17.1; Requirements 10.1, 10.4, 10.7).
 *
 * Static server component served without authentication. Displays all four
 * approved airframes with capability information by mapping over the pure
 * `@/lib/fleet` catalog — so the page cannot silently omit an airframe (10.4).
 */
import type { ReactNode } from "react";
import { FLEET } from "@/lib/fleet";

export const metadata = {
  title: "Fleet | Virtual HEMS",
};

export default function FleetPage(): ReactNode {
  return (
    <main aria-label="Approved fleet">
      <h1>Approved fleet</h1>
      <p>
        Virtual HEMS operates four approved airframes across the regional
        network. Performance figures are representative simulation reference
        values, not certified performance data.
      </p>

      <ul>
        {FLEET.map((airframe) => (
          <li key={airframe.model} aria-label={`Airframe ${airframe.model}`}>
            <h2>{airframe.model}</h2>
            <p>
              {airframe.manufacturer} — {airframe.role}
            </p>
            <dl>
              <dt>Engines</dt>
              <dd>{airframe.engines}</dd>
              <dt>Crew capacity</dt>
              <dd>{airframe.crewCapacity}</dd>
              <dt>Cruise speed</dt>
              <dd>{airframe.cruiseSpeedKts} kts</dd>
              <dt>Range</dt>
              <dd>{airframe.rangeNm} nm</dd>
            </dl>
            <h3>Capabilities</h3>
            <ul>
              {airframe.capabilities.map((capability) => (
                <li key={capability}>{capability}</li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </main>
  );
}
