/**
 * Public about page `/about` (task 17.1; Requirements 10.1, 10.7).
 *
 * Static server component served without authentication.
 */
import type { ReactNode } from "react";

export const metadata = {
  title: "About | Virtual HEMS",
};

export default function AboutPage(): ReactNode {
  return (
    <main aria-label="About Virtual HEMS">
      <h1>About Virtual HEMS</h1>
      <p>
        Virtual HEMS is a training platform that recreates the operational rhythm
        of a regional helicopter emergency medical service. It is modeled on the
        documented Western Pennsylvania and tri-state HEMS system and is intended
        for procedural flight, systems, and mission training.
      </p>

      <section aria-label="How it works">
        <h2>How it works</h2>
        <ol>
          <li>
            A cross-platform desktop bridge reads live simulator telemetry from
            Microsoft Flight Simulator or X-Plane and normalizes it into a shared
            contract.
          </li>
          <li>
            Telemetry streams to the cloud, where a live theater map, a
            four-stage dispatcher, and a cockpit electronic flight bag coordinate
            the mission.
          </li>
          <li>
            A clinical Golden Hour model tracks the simulated patient, and an
            automated after-action review audits each completed mission.
          </li>
        </ol>
      </section>

      <p>
        This is a simulation and training system. It is not a real-world
        dispatch, medical-decision, or aviation-safety authority, and it uses
        only simulated, minimized patient data.
      </p>
    </main>
  );
}
