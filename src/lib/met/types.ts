/** One canonical MET (multi-environment trial) observation record (V2-05).
 * Every G×E chart/table/R-engine input is built from a list of these -
 * never from its own independent query. Mirrors the role
 * `ObservationRecord` plays for V2-04 (`src/lib/analytics/types.ts`), kept
 * as a sibling type rather than merged into it: a MET observation always
 * carries an explicit environment and entry, which a plain trait
 * observation never does. */
export type MetObservationRecord = {
  traitValueId: string;
  numericValue: number;

  evaluationId: string;
  evaluationDate: string | null;

  phenotypeId: string;
  phenotypeCode: string;

  entryId: string;
  entryCode: string;
  entryLabel: string;
  /** Always the explicit, user-stated classification from
   * `trial_entries.scientific_role` - never inferred. Only
   * `scientific_role === "genotype"` may ever be labelled G×E in the UI;
   * every other role is Entry×Environment (task review finding, see
   * migration 000028). */
  entryScientificRole:
    | "genotype"
    | "family"
    | "population"
    | "seed_lot"
    | "other";

  environmentId: string;
  environmentCode: string;
  siteId: string;
  siteCode: string;
  campaign: string | null;

  block: string | null;
  replicate: number | null;
};

export type MetFilters = {
  trialId: string;
  traitId: string;
  includeArchived: boolean;
};
