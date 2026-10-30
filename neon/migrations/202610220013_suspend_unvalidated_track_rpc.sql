-- Security stopgap for the client-supplied full-state RPC.
-- Keep the function and all rows for audit/rollback analysis, but prevent client roles
-- from invoking it until a transition-based, database-tested replacement is available.
revoke all on function public.apply_event_track_operation(uuid,uuid,bigint,text,jsonb,text)
  from public, anon, authenticated;

-- Track tables remain readable under RLS. Writes must only return through a reviewed RPC.
revoke insert, update, delete, truncate, references, trigger
  on public.event_track_states, public.event_track_operations from public, anon, authenticated;
grant select on public.event_track_states, public.event_track_operations to authenticated;

comment on function public.apply_event_track_operation(uuid,uuid,bigint,text,jsonb,text)
  is 'Execution suspended by 202610220013: accepts caller-supplied full state without action transition validation. Do not regrant until replaced and tested.';
