-- A dropped/lost response after the server already committed an upload
-- (confirmed live: same 3 photos re-inserted 7 times, ~5-11s apart --
-- consistent with a guest re-tapping "Add to the recap" after the app
-- showed "failed" even though the previous request had actually
-- succeeded) previously had no way to be recognized as a repeat, since
-- every POST just inserted a fresh row. client_upload_id is a stable
-- per-file key the client derives from the File object itself (name +
-- size + lastModified), sent with every attempt of uploading that same
-- file -- see app/api/events/[eventId]/upload/route.js.
--
-- Postgres unique constraints treat NULL as distinct from every other
-- value (including other NULLs), so existing rows and any future insert
-- path that doesn't set this column are unaffected -- only two rows that
-- both provide the SAME (booking_id, client_upload_id) pair conflict.
alter table uploads add column client_upload_id text;
alter table uploads add constraint uploads_booking_client_upload_id_key unique (booking_id, client_upload_id);
