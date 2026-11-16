# Busca de estampas por foto

A foto enviada é analisada **pelo mesmo processo já usado na catalogação**: mesmos provedores configurados, prompt, schema, normalização de taxonomias, verificação de qualidade e fallback. Não há Voyage, provedor novo, embeddings ou indexação adicional do catálogo.

A consulta compara os atributos reconhecidos com os metadados existentes: até cinco motivos, quatro cores principais, tema, estilo, distribuição e linguagem visual quando identificados. Os atributos da foto são preferências com ranking por correspondência; os filtros preenchidos pela designer e o texto digitado continuam obrigatórios. O percentual indica critérios atendidos, não probabilidade de semelhança nem confiança da IA. Não é uma comparação direta da geometria das imagens.

## Dados, segurança e operação

- JPEG, PNG e WebP até 10 MB e 40 megapixels; assinatura e decodificação validadas no servidor, imagem inteira normalizada e metadados removidos. O navegador reduz a foto antes do envio para evitar o limite de corpo das Functions.
- Autenticação e permissões iguais às da pesquisa. A foto não é cadastrada, gravada no banco nem adicionada à fila de indexação; é processada pelos provedores que a aplicação já usa.
- Os atributos são devolvidos num token cifrado e autenticado AES-GCM, vinculado ao usuário, válido por 30 minutos. A paginação reutiliza esse token, sem reenviar a foto ou chamar a IA de novo. O token fica somente no estado da aba, fora da URL e do cache compartilhado.
- A chave de cifra deriva de `ESTAMPAS_CONSULTA_FOTO_SECRET` quando configurada, ou da chave privada de servidor já usada pela aplicação. Nunca configurar uma dessas chaves como variável `NEXT_PUBLIC_*`. Rotação invalida consultas temporárias existentes.
- Limite de seis novas análises por minuto por usuário/instância, seguindo o padrão local do projeto. **Não é um limite global distribuído**; múltiplas instâncias podem aceitar mais consultas. Para controle global de custo, usar também os limites da infraestrutura/provedor.
- O recurso usa as credenciais já existentes de análise; há consumo normal desses provedores. A retenção externa segue os contratos deles.

## Publicação

Não é preciso instalar tabelas, aplicar migrations, gerar assinaturas ou reindexar as estampas. O SQL e o indexador da proposta anterior foram removidos.

Publicar o código com a configuração de análise de imagens já utilizada pela aplicação. `ESTAMPAS_BUSCA_VISUAL_HABILITADA=false` desativa a opção; por padrão ela fica disponível. Se o provedor estiver configurado como Codex local, o servidor precisa do mesmo runtime necessário para a catalogação; não trocar automaticamente de provedor.

Validar com fotos reais das designers antes de considerar a qualidade aprovada. Metadados incompletos ou descrições diferentes podem prejudicar o ranking; o recurso permite refinar a pesquisa pelos filtros existentes. O catálogo não é reanalisado automaticamente.

## Contrato HTTP

`GET /api/estampas/pesquisa-imagem` exige autorização e retorna `{ habilitada }`.

`POST` aceita multipart com `foto` e `parametros` (query string da pesquisa). Próximas páginas recebem `consultaId` no lugar de `foto`. A resposta preserva o formato da pesquisa e acrescenta `consultaId` e `imagem: { criterios }`. Sem referência válida retorna 410; a interface permite repetir a busca com a foto ainda selecionada. Respostas não expõem erros internos ou credenciais.

## Validação

Os testes cobrem o reaproveitamento do prompt/schema/provedores, extração de atributos, upload, cifra e expiração, isolamento por usuário, permissões, limites, paginação sem nova análise e filtros obrigatórios, além da regressão textual. APIs e provedores são simulados; não comprovam qualidade com fotos reais.

O painel isolado foi conferido anteriormente em frames de 390 e 1280 px, nos dois temas, com referência sintética, nome longo e ações por teclado. Isso não equivale à validação da página autenticada completa ou de toque em dispositivo real.
