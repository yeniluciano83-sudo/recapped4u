-- deliverables had no uniqueness guard on booking_id, so re-running the
-- recap pipeline on an already-delivered booking (auto-recap.js is
-- explicitly designed to support this -- see its "reprocess" comments)
-- could leave two rows per booking instead of replacing the first. The
-- gallery API route happens to defensively pick the newest row by
-- delivered_at, so this hasn't broken production, but nothing enforced it.
-- finalizeDelivery now upserts on booking_id instead of blindly inserting.

-- If a booking somehow already has more than one deliverables row, keep
-- only the most recent (by delivered_at) before adding the constraint --
-- otherwise creating it below would fail.
delete from deliverables a using deliverables b
  where a.booking_id = b.booking_id and a.delivered_at < b.delivered_at;

alter table deliverables add constraint deliverables_booking_id_key unique (booking_id);
