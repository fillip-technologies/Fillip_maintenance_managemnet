-- Fixly v2, Phase 6 (contract): lifecycle_state is the only stored device state.
-- devices.status, which the v1 apps read, becomes a column the database derives
-- from it, so the two can never disagree and nothing writes status any more.
-- HOLD THIS BACK FROM PRODUCTION until every writer of devices.status runs this
-- branch's code (the API) — an older build that writes status would fail.

-- The (zone_id, status) index also backs the zone foreign key: keep zone_id indexed meanwhile.
CREATE INDEX `devices_zone_id_idx` ON `devices`(`zone_id`);

ALTER TABLE `devices` DROP INDEX `devices_zone_id_status_idx`;

ALTER TABLE `devices` DROP COLUMN `status`;

ALTER TABLE `devices` ADD COLUMN `status` ENUM('provisioned', 'active', 'under_maintenance', 'faulty', 'retired')
    AS (CASE `lifecycle_state`
          WHEN 'installed' THEN 'active'
          WHEN 'under_maintenance' THEN 'under_maintenance'
          WHEN 'faulty' THEN 'faulty'
          WHEN 'pending_replacement' THEN 'faulty'
          WHEN 'retired' THEN 'retired'
          WHEN 'disposed' THEN 'retired'
          WHEN 'lost' THEN 'retired'
          ELSE 'provisioned'
        END) PERSISTENT;

CREATE INDEX `devices_zone_id_status_idx` ON `devices`(`zone_id`, `status`);

ALTER TABLE `devices` DROP INDEX `devices_zone_id_idx`;
