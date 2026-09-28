/**
 * In-memory reference implementation of {@link ConditionResolverPort}.
 *
 * Used by unit tests and local wiring to resolve a Stage 3 medical-condition
 * reference to its configured {@link MedicalCondition} record without a live
 * database or the clinical engine. The production port is backed by the
 * `medical_conditions` table (migration task 2.x) / the clinical engine's
 * resolver (task 9.1); this reference implementation holds condition records in
 * memory keyed by id.
 */

import type { MedicalCondition, Uuid } from "@virtualhems/contracts";
import type { ConditionResolverPort } from "./state-machine.js";

/**
 * An in-memory {@link ConditionResolverPort}. Conditions added by id are
 * resolvable; anything else resolves to `undefined` (does not exist).
 */
export class InMemoryConditionResolver implements ConditionResolverPort {
  private readonly conditions = new Map<string, MedicalCondition>();

  constructor(conditions: Iterable<MedicalCondition> = []) {
    for (const condition of conditions) {
      this.conditions.set(condition.id, condition);
    }
  }

  resolveCondition(condition_id: Uuid): MedicalCondition | undefined {
    return this.conditions.get(condition_id);
  }

  /** Register a configured medical condition record. */
  addCondition(condition: MedicalCondition): this {
    this.conditions.set(condition.id, condition);
    return this;
  }
}
