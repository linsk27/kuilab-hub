create or replace function work_rpc(p_action text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_pass text := coalesce(p_payload->>'pass', '');
  v_space text;
  v_items jsonb;
  v_count int := 0;
begin
  if length(v_pass) < 6 then
    return jsonb_build_object('ok', false, 'error', 'weak_pass');
  end if;
  v_space := encode(sha256(convert_to(v_pass, 'UTF8')), 'hex');

  if p_action = 'pull' then
    return jsonb_build_object('ok', true, 'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', w.id, 'text', w.body, 'done', w.done, 'deleted', w.deleted,
        'at', w.created_at, 'doneAt', w.done_at, 'upd', w.updated_at
      ) order by w.created_at desc)
      from work_items w where w.space = v_space
    ), '[]'::jsonb));

  elsif p_action = 'push' then
    v_items := coalesce(p_payload->'items', '[]'::jsonb);
    insert into work_items (id, space, body, done, deleted, created_at, done_at, updated_at)
    select
      left(x->>'id', 64),
      v_space,
      left(coalesce(x->>'text', ''), 500),
      coalesce((x->>'done')::boolean, false),
      coalesce((x->>'deleted')::boolean, false),
      coalesce(nullif(x->>'at', '')::timestamptz, now()),
      nullif(x->>'doneAt', '')::timestamptz,
      coalesce(nullif(x->>'upd', '')::timestamptz, now())
    from jsonb_array_elements(v_items) as x
    where coalesce(x->>'id', '') <> ''
    on conflict (id) do update set
      body = excluded.body,
      done = excluded.done,
      deleted = excluded.deleted,
      done_at = excluded.done_at,
      updated_at = excluded.updated_at
    where work_items.space = v_space and work_items.updated_at <= excluded.updated_at;
    get diagnostics v_count = row_count;
    return jsonb_build_object('ok', true, 'count', v_count);

  else
    return jsonb_build_object('ok', false, 'error', 'unknown_action');
  end if;
end;
$fn$;
