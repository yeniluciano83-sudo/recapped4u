alter table bookings add column delivery_format text not null default 'recap' check (delivery_format in ('recap', 'social_cuts'));
