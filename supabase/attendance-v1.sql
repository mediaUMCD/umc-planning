-- UMCD Attendance v1 — run once in the Supabase Dashboard SQL Editor.
-- Builds on the existing people / families / attendance_events / attendance_checkins
-- tables (already used by Christian Education's "Push to Attendance Tracker").
-- Safe to run twice.

-- 1) People: active flag + Breeze ID for the import ----------------------------
alter table people add column if not exists is_active boolean not null default true;
alter table people add column if not exists breeze_id text;
create unique index if not exists people_breeze_id_key on people (breeze_id) where breeze_id is not null;
alter table families add column if not exists breeze_family_id text;

-- 2) Attendance events: tie to the church calendar, more kinds of events ------
alter table attendance_events drop constraint if exists attendance_events_event_type_check;
alter table attendance_events add constraint attendance_events_event_type_check
  check (event_type in ('sunday_service','online_service','sunday_school','bible_study','workshop',
                        'meeting','fellowship','outreach','special_event','other'));
-- one attendance record per calendar event
-- (NULLs don't clash, so CE's headcount-only records without a calendar link still work)
drop index if exists attendance_events_calendar_event_key;
create unique index attendance_events_calendar_event_key on attendance_events (calendar_event_id);
alter table attendance_events add column if not exists notes text;

-- 3) Check-ins: who added it, and a review step for self check-in later -------
alter table attendance_checkins add column if not exists source text not null default 'leader';
alter table attendance_checkins drop constraint if exists attendance_checkins_source_check;
alter table attendance_checkins add constraint attendance_checkins_source_check
  check (source in ('leader','self','signup','import'));
alter table attendance_checkins add column if not exists status text not null default 'approved';
alter table attendance_checkins drop constraint if exists attendance_checkins_status_check;
alter table attendance_checkins add constraint attendance_checkins_status_check
  check (status in ('approved','pending','declined'));
-- a person can only be checked in once per event
create unique index if not exists attendance_checkins_event_person_key
  on attendance_checkins (attendance_event_id, person_id) where person_id is not null;

-- 4) Who can take attendance: admins, plus anyone given the 'attendance' role --
create or replace function public.can_take_attendance()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from user_roles where user_id = auth.uid() and role in ('admin','attendance'))
$$;

drop policy if exists "Auth full access attendance_events" on attendance_events;
drop policy if exists attendance_events_staff on attendance_events;
create policy attendance_events_staff on attendance_events for all
  using (can_take_attendance()) with check (can_take_attendance());

drop policy if exists "Auth full access attendance_checkins" on attendance_checkins;
drop policy if exists attendance_checkins_staff on attendance_checkins;
create policy attendance_checkins_staff on attendance_checkins for all
  using (can_take_attendance()) with check (can_take_attendance());

-- People / families / tags keep their current policies for now.
-- Before the Breeze import, these get locked down the same way (step 2 SQL),
-- once we've confirmed which apps read them.

-- 5) Year report: one row per person per event, approved only ----------------
create or replace view attendance_report with (security_invoker = true) as
select e.id as attendance_event_id, e.event_name, e.event_date, e.event_type,
       c.person_id, p.first_name, p.last_name, p.preferred_name,
       c.guest_name, c.mode, c.source
from attendance_checkins c
join attendance_events e on e.id = c.attendance_event_id
left join people p on p.id = c.person_id
where c.status = 'approved';
