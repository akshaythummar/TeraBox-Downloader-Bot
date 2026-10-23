-- Drops the old Redis-style tables (schema v1) once schema v2 is live and migrate_v2.sql has copied
-- them. Their indexes (kv_expires, sorted_sets_score) go with them.
--   npx wrangler d1 execute terabox-bot-eu --remote --file drop_v1.sql
-- Done on the live database on 2026-10-24 (Time Travel bookmark taken just before:
-- 0000005a-000015ea-0000510d-2f5b916ed5a9aaa564c495c4e66778bd).
DROP TABLE IF EXISTS kv;
DROP TABLE IF EXISTS hashes;
DROP TABLE IF EXISTS sets;
DROP TABLE IF EXISTS sorted_sets;
DROP TABLE IF EXISTS lists;
