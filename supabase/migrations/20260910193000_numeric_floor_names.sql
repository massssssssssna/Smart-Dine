-- Floors are numbered 1-999. Remove only unused legacy labels before enforcing it.
do $$
begin
  if exists (
    select 1 from private.floors f
    where f.name !~ '^[1-9][0-9]{0,2}$'
      and exists (select 1 from private.dining_tables t where t.floor_id = f.id)
  ) then
    raise exception using errcode = '22023', message = 'Rename alphabetic floors containing tables to a number first';
  end if;

  delete from private.floors f where f.name !~ '^[1-9][0-9]{0,2}$';
end $$;

alter table private.floors
  add constraint floors_numeric_name_check
  check (name ~ '^[1-9][0-9]{0,2}$');
