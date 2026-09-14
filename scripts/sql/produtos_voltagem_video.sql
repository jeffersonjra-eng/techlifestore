-- Adiciona suporte a voltagem (127V/220V) e video vertical (9:16) no
-- cadastro de produtos.
--
-- voltagem: texto livre, mas o admin.html so grava um destes valores:
--   NULL/''      -> nao se aplica (produto nao tem voltagem)
--   '127V'       -> so funciona em 127V
--   '220V'       -> so funciona em 220V
--   'Bivolt'     -> funciona nas duas, sem escolha necessaria
--   '127V/220V'  -> sao versoes diferentes; o cliente escolhe uma na pagina do produto
--
-- video_url: link publico do video (armazenado no mesmo bucket "Produtos"
-- do Supabase Storage usado pelas fotos), pensado para formato vertical 9:16.

alter table "Produtos" add column if not exists voltagem text;
alter table "Produtos" add column if not exists video_url text;
