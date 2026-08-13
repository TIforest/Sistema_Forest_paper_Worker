# Seguranca

Este repositorio deve conter apenas os arquivos do site. Nao envie planilhas,
exportacoes do ERP, cadastros de clientes, credenciais, tokens, senhas ou links
pessoais do SharePoint.

## Publicacao

O site deve permanecer protegido por Cloudflare Access. Autorize pessoas por
endereco de e-mail individual, nao por uma regra aberta a qualquer usuario.
Proteja o dominio principal, o dominio `pages.dev` e os enderecos de preview.

## Codigos internos

Os codigos de Qualidade, Producao e Diretoria funcionam apenas como uma segunda
barreira da interface. A autenticacao efetiva deve ser feita pelo Cloudflare
Access. Troque os codigos quando alguem deixar a equipe ou quando houver suspeita
de compartilhamento.

## Incidentes

Em caso de exposicao, remova imediatamente o acesso da pessoa na politica do
Cloudflare Access, troque os codigos internos e revise o historico do Git.
