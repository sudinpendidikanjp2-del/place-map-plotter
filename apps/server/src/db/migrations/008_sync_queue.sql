-- Permintaan sinkronisasi dari web: status "menunggu" diambil oleh pekerja, yang juga mencatat denyutnya.
alter table sync_runs drop constraint sync_runs_status_check;
alter table sync_runs add constraint sync_runs_status_check check (status in ('menunggu', 'berjalan', 'selesai', 'gagal', 'ditolak', 'dibatalkan'));
alter table sync_runs add column requested_by bigint references users (id) on delete set null;

create table sync_workers (
  source  text primary key,
  seen_at timestamptz not null default now()
);
