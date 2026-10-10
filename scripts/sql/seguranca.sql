-- Fecha a gravacao anonima no banco (Supabase) e passa a exigir login do administrador.
--
-- ANTES DE RODAR:
--   1) Troque 'EMAIL_DO_ADMIN@exemplo.com' abaixo pelo e-mail do usuario admin
--      (o mesmo criado em Authentication > Users). Pode ser mais de um, separados por virgula.
--   2) Publique antes o codigo novo (admin.html com login + funcoes do Netlify) e configure
--      no Netlify as variaveis SUPABASE_SERVICE_KEY e ADMIN_EMAILS. Se rodar este script antes,
--      o painel antigo e os checkouts param de gravar pedidos.
--
-- Rode inteiro, uma vez, no SQL Editor do Supabase. E seguro rodar de novo.

-- 0) Quem e administrador (so e-mails desta lista, e so com login valido).
create or replace function public.eh_admin()
returns boolean
language sql
stable
as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) = any (array['EMAIL_DO_ADMIN@exemplo.com']::text[]);
$$;
grant execute on function public.eh_admin() to anon, authenticated;

-- 1) Remove TODAS as policies antigas (inclusive as que liberavam escrita para "anon").
do $$
declare r record;
begin
  for r in
    select policyname, tablename from pg_policies
    where schemaname = 'public' and tablename in ('Produtos', 'Avaliacoes', 'Pedidos')
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

alter table public."Produtos"   enable row level security;
alter table public."Avaliacoes" enable row level security;
alter table public."Pedidos"    enable row level security;

-- 2) Permissoes de tabela: a chave publica (anon) nunca escreve e nunca toca em Pedidos.
revoke insert, update, delete, truncate on public."Produtos", public."Avaliacoes", public."Pedidos" from anon;
revoke all on public."Pedidos" from anon;

-- 3) Catalogo publico: o site so le o que esta ativo.
create policy "Produtos leitura publica" on public."Produtos"
  for select to anon, authenticated
  using ("Ativo" = true);

create policy "Avaliacoes leitura publica" on public."Avaliacoes"
  for select to anon, authenticated
  using (ativo = true);

-- 4) Administrador logado: tudo (inclui ver itens inativos e gerenciar pedidos).
create policy "Produtos admin" on public."Produtos"
  for all to authenticated
  using (public.eh_admin()) with check (public.eh_admin());

create policy "Avaliacoes admin" on public."Avaliacoes"
  for all to authenticated
  using (public.eh_admin()) with check (public.eh_admin());

create policy "Pedidos admin" on public."Pedidos"
  for all to authenticated
  using (public.eh_admin()) with check (public.eh_admin());

-- As funcoes do Netlify usam a chave de servico (service_role), que ignora RLS,
-- entao continuam gravando Pedidos normalmente.

-- 5) Fotos/videos dos produtos (Storage): leitura publica, escrita so do administrador.
do $$
declare r record;
begin
  for r in select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects'
  loop
    execute format('drop policy %I on storage.objects', r.policyname);
  end loop;
end $$;

create policy "Midia de produtos leitura publica" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'Produtos');

create policy "Midia de produtos admin" on storage.objects
  for all to authenticated
  using (bucket_id = 'Produtos' and public.eh_admin())
  with check (bucket_id = 'Produtos' and public.eh_admin());

-- Conferir depois (deve listar so policies de leitura para anon):
-- select schemaname, tablename, policyname, roles, cmd from pg_policies
--  where tablename in ('Produtos','Avaliacoes','Pedidos','objects') order by 1,2,3;
