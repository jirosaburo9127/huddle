-- カテゴリ名の変更 RPC
create or replace function public.rename_workspace_category(
  p_workspace_id uuid,
  p_slug text,
  p_new_label text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not exists (
    select 1 from public.workspace_members
    where workspace_id = p_workspace_id and user_id = auth.uid()
  ) then raise exception 'forbidden'; end if;

  update public.workspace_categories
    set label = btrim(p_new_label)
    where workspace_id = p_workspace_id and slug = p_slug;
end;
$$;

grant execute on function public.rename_workspace_category(uuid, text, text) to authenticated;

-- カテゴリの並び替え RPC（2つのカテゴリの sort_order を入れ替える）
create or replace function public.swap_category_order(
  p_workspace_id uuid,
  p_slug_a text,
  p_slug_b text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_a int;
  v_order_b int;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not exists (
    select 1 from public.workspace_members
    where workspace_id = p_workspace_id and user_id = auth.uid()
  ) then raise exception 'forbidden'; end if;

  select sort_order into v_order_a
    from public.workspace_categories
    where workspace_id = p_workspace_id and slug = p_slug_a;
  select sort_order into v_order_b
    from public.workspace_categories
    where workspace_id = p_workspace_id and slug = p_slug_b;

  update public.workspace_categories
    set sort_order = v_order_b
    where workspace_id = p_workspace_id and slug = p_slug_a;
  update public.workspace_categories
    set sort_order = v_order_a
    where workspace_id = p_workspace_id and slug = p_slug_b;
end;
$$;

grant execute on function public.swap_category_order(uuid, text, text) to authenticated;
