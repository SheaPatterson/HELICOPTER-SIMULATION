/**
 * In-memory reference implementation of {@link DispatchLookupPort}.
 *
 * Used by unit tests and local wiring to answer reference-existence checks
 * (base / airframe / facility) without a live database. The production port is
 * backed by the `hems_bases`, airframe config, and `hospitals` tables (migration
 * task 2.x); this reference implementation holds the configured ids in memory.
 */

import type { Uuid } from "@virtualhems/contracts";
import type { DispatchLookupPort } from "./state-machine.js";

/** Configured reference ids the in-memory lookup treats as existing. */
export interface InMemoryLookupConfig {
  baseIds?: Iterable<Uuid>;
  airframeIds?: Iterable<Uuid>;
  facilityIds?: Iterable<Uuid>;
}

/**
 * An in-memory {@link DispatchLookupPort}. Ids added to the corresponding set
 * are treated as existing configured records; anything else does not exist.
 */
export class InMemoryDispatchLookup implements DispatchLookupPort {
  private readonly bases: Set<string>;
  private readonly airframes: Set<string>;
  private readonly facilities: Set<string>;

  constructor(config: InMemoryLookupConfig = {}) {
    this.bases = new Set(config.baseIds ?? []);
    this.airframes = new Set(config.airframeIds ?? []);
    this.facilities = new Set(config.facilityIds ?? []);
  }

  baseExists(base_id: Uuid): boolean {
    return this.bases.has(base_id);
  }

  airframeExists(airframe_id: Uuid): boolean {
    return this.airframes.has(airframe_id);
  }

  facilityExists(facility_id: Uuid): boolean {
    return this.facilities.has(facility_id);
  }

  /** Register a configured base id. */
  addBase(base_id: Uuid): this {
    this.bases.add(base_id);
    return this;
  }

  /** Register a configured airframe id. */
  addAirframe(airframe_id: Uuid): this {
    this.airframes.add(airframe_id);
    return this;
  }

  /** Register a configured facility id. */
  addFacility(facility_id: Uuid): this {
    this.facilities.add(facility_id);
    return this;
  }
}
