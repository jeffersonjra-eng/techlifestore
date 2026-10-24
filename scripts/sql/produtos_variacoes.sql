-- Variacoes de produto (ex.: 1 unidade, 2 unidades, 3 unidades, cores, tamanhos).
-- Rode uma vez no SQL Editor do Supabase. E seguro rodar de novo.
--
-- variacoes: lista (jsonb) de opcoes, cada uma com
--   { "id": "v1", "nome": "2 unidades", "preco": 69.90, "unidades": 2 }
-- Produto sem variacao: coluna vazia (null). O admin cuida de preencher.
alter table public."Produtos" add column if not exists variacoes jsonb;
