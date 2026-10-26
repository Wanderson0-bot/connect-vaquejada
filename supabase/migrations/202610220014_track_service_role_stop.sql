-- Additive hardening for the Supabase service role. Migration 013 remains immutable.
-- service_role does not need a track RPC or direct track-table writes in this design.
revoke all on function public.apply_event_track_operation(uuid,uuid,bigint,text,jsonb,text)
  from service_role;

revoke insert, update, delete, truncate, references, trigger
  on public.event_track_states, public.event_track_operations from service_role;
