/**
 * Public-data pure core (task 17.2). Framework-free de-identification /
 * aggregation projection the public map + marketing routes MUST run over
 * operational data before returning it (Requirement 8.7). Public routes serve
 * aggregate or de-identified operational data ONLY — no patient, clinical, or
 * VIRS record and no pilot/patient/incident-identifying field.
 */

export {
  toPublicAssetSummary,
  toAggregateOperationalData,
  type RawOperationalAsset,
  type RawOperationalMission,
  type PublicAssetSummary,
  type AggregateOperationalData,
} from "./deidentify";
