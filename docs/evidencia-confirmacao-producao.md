# Evidência de confirmação de produção

O modal compartilhado da tela interna e do link público exige uma foto do pedido em papel antes da senha. A foto pode vir da câmera ou da galeria. A prévia permite revisar ou substituir o arquivo; selecionar a foto ainda não envia dados à nuvem.

No envio final, os endpoints recebem `multipart/form-data` com `foto`, `senha`, `solicitacaoId` e `itens` (JSON). Confirmações JSON antigas sem foto são recusadas. A tela interna mantém autenticação/permissão; o link público mantém assinatura, validade, habilitação do aplicativo e vínculo com uma única solicitação. Ambos exigem as mesmas senhas.

## Armazenamento e publicação

1. Aplicar a migration Prisma `20261016160000_evidencia_confirmacao_producao` antes de publicar o código e gerar o Prisma Client.
2. Configurar `GOOGLE_CLOUD_STORAGE_EVIDENCIAS_BUCKET` no ambiente de execução com um bucket privado. Não usar o bucket público do catálogo. O código exige `iamConfiguration.publicAccessPrevention=enforced` e falha sem enviar arquivos se essa proteção não estiver habilitada.
3. Reutilizar `GOOGLE_CLOUD_CLIENT_EMAIL` e `GOOGLE_CLOUD_PRIVATE_KEY`. A conta de serviço precisa consultar a configuração do bucket (`storage.buckets.get`), criar objetos, ler evidências (`storage.objects.get`) e apagar arquivos sem vínculo. Não são necessárias permissões para tornar objetos públicos.
4. Publicar a aplicação e validar câmera/galeria em um celular real, senha incorreta, upload com falha e confirmação completa com um pedido de teste apropriado.

A URL canônica do objeto, o bucket e o caminho são persistidos em `solicitacoes_producao.evidencia_url`, `evidencia_bucket` e `evidencia_storage_path`. O link permanece privado; não contém credenciais nem assinatura com expiração. A visualização direta exige acesso autorizado ao Google Cloud Storage. Confirmações históricas permanecem com os campos nulos.

A página filha `/solicitacoes-producao/[id]`, acessível pelo link “Detalhes” em Anotar produção, permite visualizar e baixar a evidência. O servidor autentica o usuário, verifica as permissões da página e restringe a consulta ao aplicativo do usuário antes de carregar a foto. Bucket, caminho e URL privada não são enviados no JSON dos detalhes; a imagem é entregue pelo endpoint autenticado `/api/solicitacoes-producao/[id]/evidencia`, sem cache compartilhado.

## Limites e consistência

- O navegador aceita fotos de até 20 MB e tenta convertê-las para JPEG, até 1600 px no maior lado e 3 MB. O backend garante o mesmo limite de resolução e JPEG com qualidade 75 para reduzir o espaço no storage, preservando proporções e sem ampliar fotos menores. Formatos que o navegador não consegue decodificar apresentam erro recuperável. Câmera depende do suporte do navegador/dispositivo; no desktop o seletor de arquivos pode ser exibido. A legibilidade depende da captura e deve ser conferida na prévia; fotos já armazenadas não são reprocessadas.
- O backend limita o corpo real a 4 MB, independentemente do `Content-Length`, e a foto recebida a 3 MB. Decodifica e recodifica a imagem, rejeita formatos não permitidos/animações, limita pixels e remove metadados como EXIF/GPS. Não aceita URL fornecida pelo cliente como evidência.
- A senha e o vínculo com a solicitação são validados antes de enviar a foto ao storage. A transação de confirmação grava quantidades, movimentações, evidência e status `concluida` em conjunto, mantendo o isolamento `Serializable`.
- Se a confirmação falhar depois do upload, o backend verifica se a evidência foi vinculada antes de tentar excluir o objeto. Se não conseguir verificar ou limpar, preserva o arquivo e registra uma mensagem genérica; pode restar um arquivo órfão para reconciliação operacional. Upload e banco não compartilham uma transação distribuída.
- O limitador de senhas existente continua em memória por instância; não é um bloqueio distribuído entre instâncias.

## Validação

Testes locais cobrem multipart, limites reais do corpo, ausência/falsificação de foto, normalização sem EXIF, autorização, senhas, token público, isolamento por aplicativo, falhas de upload/transação e limpeza segura. Integrações externas são simuladas nesses testes; isso não valida permissões reais do bucket nem aplica a migration.

Referências: [prevenção de acesso público do Google Cloud Storage](https://docs.cloud.google.com/storage/docs/using-public-access-prevention) e [limites de payload das Vercel Functions](https://vercel.com/docs/functions/limitations).
