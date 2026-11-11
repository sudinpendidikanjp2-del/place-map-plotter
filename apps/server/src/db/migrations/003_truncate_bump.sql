-- TRUNCATE tidak memicu pemicu DELETE, jadi versi data harus dinaikkan lewat pemicu tersendiri.
create trigger locations_bump_truncate after truncate on locations
  for each statement execute function bump_data_version();
