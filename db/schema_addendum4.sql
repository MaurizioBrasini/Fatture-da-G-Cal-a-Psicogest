-- Da eseguire IN AGGIUNTA a schema.sql, schema_addendum.sql, schema_addendum2.sql
-- e schema_addendum3.sql già eseguiti.
--
-- Allarga patient_slots.interval_days per ammettere anche la cadenza "ogni 4
-- settimane" (28 giorni) — comparsa nel ripopolamento calendario del
-- 2026-09-07 (Jessica M.), non prevista dallo schema originale che ammetteva
-- solo settimanale (7) o quindicinale (14).

alter table patient_slots drop constraint if exists patient_slots_interval_days_check;
alter table patient_slots add constraint patient_slots_interval_days_check
  check (interval_days in (7, 14, 28));
