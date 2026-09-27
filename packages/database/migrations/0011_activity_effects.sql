-- What an event recorded moving, and who it moved for.
--
-- Amounts live in their own table rather than as columns on canonical_activities, so that an
-- activity carrying no readable amount is an absence of rows rather than a zero. A protocol that
-- renames a field, or names an asset outside the pinned registry, produces an activity with no
-- effects and is visibly unknown.

ALTER TABLE canonical_activities ADD COLUMN owner text CHECK (owner <> '');
-- Joins an event back to a workflow when the Stacks transaction is not the user's own: an sBTC
-- mint is broadcast by the signers and carries the Bitcoin output it settles, and a withdrawal is
-- carried across three events by its request id.
ALTER TABLE canonical_activities ADD COLUMN reference text CHECK (reference <> '');

CREATE INDEX canonical_activities_by_reference
  ON canonical_activities (network, reference) WHERE reference IS NOT NULL;

CREATE TABLE activity_effects (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  activity_id text NOT NULL REFERENCES canonical_activities (id) ON DELETE CASCADE,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  -- From the owner's point of view: what they received, and what they parted with.
  direction text NOT NULL CHECK (direction IN ('in', 'out')),
  -- Mirrors formatAssetId. Deliberately not a foreign key onto assets: an event may name an asset
  -- the registry pins before a snapshot has ever been written for it, and evidence must record
  -- what the chain said rather than fail on a table that has not caught up.
  asset_id text NOT NULL CHECK (asset_id <> ''),
  quantity token_quantity NOT NULL CHECK (quantity >= 0),
  UNIQUE (activity_id, ordinal)
);

CREATE INDEX activity_effects_by_activity ON activity_effects (activity_id);

CREATE TRIGGER activity_effects_append_only BEFORE UPDATE ON activity_effects
  FOR EACH ROW EXECUTE FUNCTION reject_row_change();
