import type { Categoria, Evento, Produto, Regiao, RegraData } from "./planejamento";

const turismo = { titulo: "Calendário turístico oficial — conferir edição e município", url: "https://turismo.gov.br/agenda-eventos/views/index.php" };
const saude = { titulo: "Ministério da Saúde — campanhas", url: "https://www.gov.br/saude/pt-br/campanhas-da-saude/campanhas-da-saude" };
const fonte = (titulo: string, url: string) => ({ titulo, url });
const fix = (mes: number, dia: number): RegraData => ({ tipo: "fixa", mes, dia });
const periodo = (mes: number, fimMes = mes): RegraData => ({ tipo: "periodo", mes, fimMes });
const ref = (mes: number, fimMes = mes): RegraData => ({ tipo: "referencia", mes, fimMes });
const LP: Produto[] = ["Lenços", "Pareôs"], FP: Produto[] = ["Forros de mesa", "Painéis"], LFP: Produto[] = ["Lenços", ...FP];
const todos: Produto[] = [...LP, ...FP];
function evento(id: string, nome: string, categoria: Categoria, data: RegraData, produtos: Produto[], estampas: string,
  extra: Partial<Omit<Evento, "id" | "nome" | "categoria" | "data" | "produtos" | "estampas">> = {}): Evento {
  return { id, nome, categoria, data, produtos, estampas, regioes: ["Nacional"],
    divulgacao: categoria === "Conscientização" ? "periodo" : "ambos",
    recomendacao: "Adaptar a composição ao formato: moldura e cantos para lenços; leitura ampla para pareôs; bordas para mesa; ponto focal para painéis. Preferir opções sem ano para ampliar o período de venda.",
    fontes: [turismo], ...extra };
}
const regional = (regiao: Regiao, local: string) => ({ regioes: [regiao], local });
const religioso = (id: string, nome: string, mes: number, dia: number, estampas: string, extra: Parameters<typeof evento>[6] = {}) =>
  evento(id, nome, "Religioso", fix(mes, dia), LFP, estampas, { recomendacao: "Criar composições próprias para esta devoção. Respeitar símbolos e contexto religioso; não misturar tradições diferentes na mesma arte.", ...extra });

export const catalogoComercial: Evento[] = [
  evento("verao", "Verão, praia e férias", "Temporadas/comercial", periodo(12, 2), LP, "Coqueiros, conchas, ondas, frutas, flores grandes e composição náutica.", {
    destaques: [
      { regiao: "Nordeste", texto: "Valorizar paisagens e referências do litoral atendido, sem tratar toda a região como uma única estética." },
      { regiao: "Sudeste", texto: "Direcionar divulgação ao litoral de SP, RJ e ES; separar das campanhas voltadas ao interior." },
      { regiao: "Sul", texto: "Concentrar pareôs na temporada de praia; manter linha de lenços própria para o inverno." },
      { regiao: "Norte", texto: "Praias de rio têm calendários próprios. Conferir nível dos rios e condições locais; não assumir esta temporada para toda a região." },
    ],
  }),
  religioso("reis", "Dia de Reis e Folias de Reis", 1, 6, "Estrelas, coroas, fitas e cortejos; referências específicas de reisados e folias."),
  religioso("sebastiao", "São Sebastião", 1, 20, "Composições devocionais e flores.", { destaques: [{ regiao: "Sudeste", texto: "Destaque para o Rio de Janeiro; confirmar a programação das festas locais." }] }),
  evento("janeiro-branco", "Janeiro Branco", "Conscientização", periodo(1), ["Lenços", "Painéis"], "Acolhimento, bem-estar e mensagens respeitosas sobre saúde mental.", { fontes: [saude] }),
  evento("carnaval", "Carnaval", "Festas populares", { tipo: "pascoa", deslocamento: -47 }, ["Lenços", "Pareôs", "Painéis"], "Confetes, máscaras, serpentinas e grafismos vibrantes.", {
    destaques: [{ regiao: "Nordeste", texto: "Separar frevo e maracatu de Recife/Olinda das referências do Carnaval de Salvador." }, { regiao: "Sudeste", texto: "Criar artes autorais para blocos e samba, sem copiar marcas de escolas de samba." }],
  }),
  religioso("iemanja", "Iemanjá", 2, 2, "Ondas, flores e composições devocionais específicas."),
  religioso("lourdes", "Nossa Senhora de Lourdes", 2, 11, "Flores, luz e composição mariana."),
  evento("quaresma", "Quaresma", "Religioso", { tipo: "pascoa", deslocamento: -46, fimDeslocamento: -3 }, FP, "Cruz, luz, ramos e composições de reflexão."),
  evento("mulher", "Dia da Mulher", "Temporadas/comercial", fix(3, 8), ["Lenços", "Painéis"], "Florais e composições para presentes e homenagens."),
  religioso("jose", "São José", 3, 19, "São José, Sagrada Família, flores e luz.", { destaques: [{ regiao: "Norte", texto: "Padroeiro de Macapá/AP; preparar linha própria para a festividade local." }, { regiao: "Nordeste", texto: "Trabalhar fé e paisagens do sertão com referências locais." }], fontes: [fonte("Prefeitura de Macapá — São José", "https://macapa.ap.gov.br/celebracao-promovida-pela-prefeitura-homenageia-sao-jose-o-padroeiro-de-macapa/")] }),
  evento("semana-santa", "Semana Santa", "Religioso", { tipo: "pascoa", deslocamento: -7, fimDeslocamento: 0 }, FP, "Ramos, cruz, luz e ressurreição; linha cristã separada da Páscoa lúdica."),
  evento("pascoa", "Páscoa", "Temporadas/comercial", { tipo: "pascoa", deslocamento: 0 }, FP, "Coelhos, ovos, cenouras, jardins e florais; versões infantis e elegantes."),
  evento("autismo", "Conscientização sobre o autismo", "Conscientização", fix(4, 2), ["Lenços", "Painéis"], "Inclusão, diversidade e acolhimento.", { recomendacao: "Validar símbolos e mensagens com o público atendido. Evitar infantilizar pessoas autistas e preservar a diversidade de experiências.", fontes: [fonte("Ministério dos Direitos Humanos — conscientização e direitos", "https://www.gov.br/mdh/pt-br")] }),
  religioso("jorge", "São Jorge", 4, 23, "São Jorge e composições devocionais.", { destaques: [{ regiao: "Sudeste", texto: "Destaque no Rio de Janeiro; preservar as diferenças entre tradições religiosas." }] }),
  evento("maes", "Dia das Mães", "Temporadas/comercial", { tipo: "domingo", mes: 5, ordinal: 2 }, ["Lenços", "Forros de mesa", "Painéis"], "Florais, aquarelas, arabescos, maternidade e família."),
  evento("mariano", "Mês mariano", "Religioso", periodo(5), LFP, "Flores e composições marianas, com linhas separadas por devoção."),
  religioso("fatima", "Nossa Senhora de Fátima", 5, 13, "Flores, luz e composição mariana."),
  evento("corpus", "Corpus Christi", "Religioso", { tipo: "pascoa", deslocamento: 60 }, FP, "Símbolos eucarísticos e composição religiosa."),
  evento("maio-amarelo", "Maio Amarelo", "Conscientização", periodo(5), ["Painéis"], "Segurança no trânsito, respeito e mobilidade.", { fontes: [fonte("Campanhas de conscientização — Governo de Goiás", "https://goias.gov.br/esporte/campanhas-2026/")] }),
  evento("juninas", "Festas juninas e julinas", "Festas populares", periodo(6, 7), LFP, "Xadrez, chita, bandeirinhas, retalhos, cordel, milho, sanfona e zabumba.", {
    recomendacao: "Criar arte principal, coordenado simples e versão discreta. Opções sem mês e sem ‘São João’ escrito continuam utilizáveis nas festas julinas.",
    destaques: [{ regiao: "Nordeste", texto: "Priorizar São João, incluindo Caruaru/PE e Campina Grande/PB. Diferenciar cordel, chita e repertórios de cada localidade." }],
    fontes: [fonte("Ministério do Turismo — cultura do São João", "https://www.gov.br/turismo/pt-br/assuntos/ultimas-noticia/dancas-e-brincadeiras-celebram-a-cultura-do-sao-joao")],
  }),
  evento("namorados", "Dia dos Namorados", "Temporadas/comercial", fix(6, 12), ["Forros de mesa", "Painéis", "Lenços"], "Corações, pares, flores e composições românticas."),
  religioso("antonio", "Santo Antônio", 6, 13, "Santo Antônio, flores e elementos juninos."),
  religioso("joao", "São João", 6, 24, "São João, bandeirinhas e elementos de arraial."),
  religioso("pedro", "São Pedro", 6, 29, "São Pedro, barcos e elementos de festas locais."),
  religioso("carmo", "Nossa Senhora do Carmo", 7, 16, "Flores e composição mariana."),
  evento("avos", "Dia dos Avós — Sant’Ana e São Joaquim", "Temporadas/comercial", fix(7, 26), LFP, "Família, afeto e florais; composições religiosas em linha própria."),
  evento("pais", "Dia dos Pais", "Temporadas/comercial", { tipo: "domingo", mes: 8, ordinal: 2 }, FP, "Hobbies, churrasco, encontros familiares e padrões rústicos."),
  evento("folclore", "Dia do Folclore", "Festas populares", fix(8, 22), FP, "Personagens autorais inspirados no folclore de cada região."),
  evento("agosto-lilas", "Agosto Lilás", "Conscientização", periodo(8), ["Lenços", "Painéis"], "Respeito e enfrentamento à violência contra a mulher.", { fontes: [fonte("Ministério das Mulheres", "https://www.gov.br/mulheres/pt-br")] }),
  evento("independencia", "Independência do Brasil", "Temporadas/comercial", fix(9, 7), ["Lenços", "Painéis"], "Brasilidade, fauna e flora brasileiras."),
  evento("primavera", "Primavera — coleção floral", "Temporadas/comercial", periodo(9, 11), todos, "Jardins, flores grandes, pássaros e borboletas.", { recomendacao: "Janela comercial de setembro a novembro, sem representar datas astronômicas exatas. Manter florais sem frases como linha permanente." }),
  evento("setembro-amarelo", "Setembro Amarelo", "Conscientização", periodo(9), ["Lenços", "Painéis"], "Acolhimento e valorização da vida.", { fontes: [saude] }),
  religioso("cosme-catolico", "São Cosme e São Damião — tradição católica", 9, 26, "Composições devocionais, flores e doces."),
  religioso("cosme-popular", "São Cosme e São Damião — celebrações em 27/09", 9, 27, "Doces e composições devocionais contextualizadas.", { recomendacao: "Data adotada por muitas celebrações populares e afro-brasileiras. Confirmar a tradição da comunidade atendida e não misturar referências religiosas." }),
  evento("outubro-rosa", "Outubro Rosa", "Conscientização", periodo(10), ["Lenços", "Painéis"], "Florais, laços e mensagens de conscientização.", { fontes: [saude] }),
  religioso("francisco", "São Francisco de Assis", 10, 4, "São Francisco, animais e natureza."),
  religioso("aparecida", "Nossa Senhora Aparecida", 10, 12, "Nossa Senhora Aparecida, flores e elementos de romaria.", { destaques: [{ regiao: "Sudeste", texto: "Destaque para Aparecida/SP; antecipar a coleção para romeiros e eventos religiosos." }] }),
  evento("criancas", "Dia das Crianças", "Temporadas/comercial", fix(10, 12), FP, "Animais, dinossauros, espaço e fantasia; personagens autorais ou licenciados."),
  evento("professores", "Dia dos Professores", "Temporadas/comercial", fix(10, 15), ["Lenços", "Painéis"], "Livros, flores e educação; opções para homenagem e presente."),
  evento("halloween", "Halloween", "Festas populares", fix(10, 31), FP, "Abóboras, fantasmas, morcegos e teias; coleção específica para públicos interessados."),
  evento("novembro-azul", "Novembro Azul", "Conscientização", periodo(11), ["Lenços", "Painéis"], "Composições para campanhas de saúde do homem.", { fontes: [saude] }),
  evento("consciencia-negra", "Consciência Negra", "Conscientização", fix(11, 20), LFP, "Valorização da identidade negra e cultura afro-brasileira.", { recomendacao: "Contextualizar referências e creditar artistas quando aplicável. Não tratar culturas africanas distintas como uma estética única.", fontes: [fonte("Ministério da Cultura", "https://www.gov.br/cultura/pt-br")] }),
  evento("advento", "Advento", "Religioso", { tipo: "advento" }, FP, "Velas, coroas, estrelas e preparação para o Natal.", { recomendacao: "Consultar o calendário litúrgico para atividades específicas. Esta coleção acompanha o período de preparação para o Natal." }),
  religioso("conceicao", "Nossa Senhora da Conceição", 12, 8, "Flores e composição mariana."),
  evento("natal", "Natal", "Temporadas/comercial", fix(12, 25), FP, "Árvores, renas, laços e presentes; presépio e Sagrada Família em linha religiosa própria."),
  evento("reveillon", "Réveillon", "Temporadas/comercial", fix(12, 31), todos, "Branco, estrelas, ondas e detalhes dourados impressos, sem prometer acabamento metálico."),
  evento("dezembro-vermelho", "Dezembro Vermelho", "Conscientização", periodo(12), ["Painéis", "Lenços"], "Informação, respeito e conscientização sobre HIV/aids.", { fontes: [saude] }),

  evento("bonfim", "Lavagem do Bonfim", "Religioso", ref(1), ["Lenços", "Painéis"], "Flores, fitas e referências arquitetônicas locais.", { ...regional("Nordeste", "Salvador/BA"), fontes: [fonte("Setur Bahia — Lavagem do Bonfim", "https://www.ba.gov.br/turismo/noticia/2024-07/4869/lavagem-do-bonfim-reune-baianos-e-turistas-nesta-quinta-feira")] }),
  evento("bumba-meu-boi", "Bumba meu boi do Maranhão", "Festas populares", ref(6, 7), LFP, "Bois e elementos dos sotaques locais, com arte autoral e referências contextualizadas.", regional("Nordeste", "Maranhão")),
  evento("vaquejadas", "Vaquejadas e cavalgadas — referência comercial", "Country/rural", ref(7, 9), LFP, "Vaqueiro, cavalos, selaria, mandacaru e paisagens da caatinga.", { ...regional("Nordeste", "Municípios com eventos de vaquejada e cavalgada"), recomendacao: "Julho a setembro é apenas uma janela de planejamento sugerida, não uma temporada oficial. Existem eventos ao longo do ano; conferir a agenda do município. Diferenciar cultura de vaqueiro de country e tradição gaúcha." }),
  evento("dores", "Romaria de Nossa Senhora das Dores", "Religioso", ref(9), ["Lenços", "Painéis"], "Nossa Senhora das Dores, flores e elementos de romaria.", { ...regional("Nordeste", "Juazeiro do Norte/CE"), fontes: [fonte("Prefeitura — ciclo de romarias", "https://juazeirodonorte.ce.gov.br/cartaservicos?id=263")] }),
  evento("romaria-finados", "Romaria de Finados", "Religioso", ref(10, 11), ["Lenços", "Painéis"], "Fé, memória e composições de romaria.", { ...regional("Nordeste", "Juazeiro do Norte/CE"), fontes: [fonte("Calendário de romarias — Lei 15.443/2026", "https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2026/lei/l15443.htm")] }),

  evento("marabaixo", "Ciclo do Marabaixo", "Festas populares", { tipo: "pascoa", deslocamento: -1, fimDeslocamento: 63 }, LFP, "Tambores, flores e movimento das saias, com contexto afro-amapaense.", { ...regional("Norte", "Macapá/AP"), recomendacao: "Período do ciclo pascal: do Sábado de Aleluia ao domingo após Corpus Christi. Confirmar a programação dos barracões de cada edição; respeitar os elementos religiosos e comunitários.", fontes: [fonte("Prefeitura de Macapá — ciclo do Marabaixo", "https://agencia.macapa.ap.gov.br/uniao-fe-e-tradicao-marcam-a-2a-corrida-do-ciclo-do-marabaixo-apoiada-pela-prefeitura-de-macapa/")] }),
  evento("parintins", "Festival de Parintins", "Festas populares", ref(6), LFP, "Boi-bumbá, movimento, rios e floresta; linhas cromáticas distintas.", { ...regional("Norte", "Parintins/AM"), recomendacao: "Usar arte autoral. Não reproduzir marcas, personagens ou artes dos bois sem autorização. Confirmar as datas da edição.", fontes: [fonte("Prefeitura de Parintins — festival", "https://parintins.am.gov.br/noticia/festival-de-parintins-2026-e-lancado-em-manaus-e-promete-movimentar-cultura-turismo-e-economia-do-amazonas")] }),
  evento("praias-rio", "Férias e praias de rio", "Temporadas/comercial", ref(7), LP, "Rios, peixes, areia, pôr do sol, frutas e folhagens.", { ...regional("Norte", "Destinos do Pará e Tocantins, conforme condições locais"), recomendacao: "Julho é referência de férias e divulgação, não garantia de praias disponíveis. Conferir município, nível dos rios e condições de acesso." }),
  evento("gloria", "Novenário de Nossa Senhora da Glória", "Religioso", ref(8), ["Lenços", "Painéis"], "Flores e composições devocionais.", { ...regional("Norte", "Cruzeiro do Sul/AC"), fontes: [fonte("Ministério do Turismo — eventos de agosto", "https://www.gov.br/turismo/pt-br/assuntos/noticias/agosto-chegou-recheado-de-eventos-pelo-brasil")] }),
  evento("cirio", "Círio de Nazaré", "Religioso", { tipo: "domingo", mes: 10, ordinal: 2 }, LFP, "Nossa Senhora de Nazaré, berlinda, flores e romaria.", { ...regional("Norte", "Belém/PA"), recomendacao: "A data indica a procissão principal de Belém. Confirmar a programação das demais romarias; círios de outros municípios têm calendários próprios.", fontes: [fonte("Iphan — Círio de Nazaré", "https://www.gov.br/iphan/pt-br/superintendencias/para/patrimonio-mundial")] }),

  evento("vindima", "Vindima", "Temporadas/comercial", ref(1, 3), ["Forros de mesa", "Painéis", "Lenços"], "Uvas, parreiras, folhas de videira, frutas e mesa colonial.", { ...regional("Sul", "Áreas produtoras da Serra Gaúcha/RS"), fontes: [fonte("Ministério do Turismo — vindima", "https://www.gov.br/turismo/pt-br/assuntos/ultimas-noticia/e-tempo-de-vindima-na-serra-gaucha")] }),
  religioso("caravaggio", "Nossa Senhora de Caravaggio", 5, 26, "Flores, composição mariana e elementos de peregrinação.", { ...regional("Sul", "Farroupilha/RS e comunidades devotas") }),
  evento("inverno-sul", "Inverno e férias nas serras", "Temporadas/comercial", periodo(6, 8), ["Lenços", "Forros de mesa", "Painéis"], "Xadrez, araucárias, pinhão, paisagens serranas e tons terrosos.", regional("Sul", "Destinos serranos e de inverno")),
  evento("farroupilha", "Semana Farroupilha", "Festas populares", ref(9), LFP, "Cavalos, pampa, chimarrão e elementos da tradição gaúcha.", { ...regional("Sul", "Rio Grande do Sul"), recomendacao: "O marco é 20 de setembro. A programação varia por município; respeitar padrões de uso e referências locais dos lenços tradicionais.", fontes: [fonte("Turismo RS — Semana Farroupilha", "https://www.turismo.rs.gov.br/turismo/evento/visualizar/11396")] }),
  evento("oktober", "Oktoberfest e festas de outubro", "Festas populares", ref(10), LFP, "Losangos, flores, lúpulo e composições de festa germânica.", { ...regional("Sul", "Blumenau/SC, Santa Cruz do Sul/RS e outras cidades"), fontes: [fonte("Prefeitura de Blumenau — programação", "https://blumenau.sc.gov.br/"), fonte("Oktoberfest de Santa Cruz do Sul", "https://www.oktober.com.br/")] }),
  evento("natal-serra", "Temporada natalina de Gramado", "Temporadas/comercial", ref(10, 1), FP, "Casinhas, pinheiros, presépios, estrelas e cenários natalinos.", { ...regional("Sul", "Gramado/RS"), recomendacao: "Temporada local de eventos natalinos; confirmar início e término da edição. Criar arte própria sem copiar identidade visual dos espetáculos.", fontes: [fonte("Secretaria de Turismo de Gramado — eventos", "https://gramadoinesquecivel.tur.br/eventos")] }),

  evento("penha", "Festa da Penha", "Religioso", { tipo: "pascoa", deslocamento: 0, fimDeslocamento: 8 }, LFP, "Nossa Senhora da Penha, convento, flores e romaria.", { ...regional("Sudeste", "Vila Velha/ES"), confirmarProgramacao: true, recomendacao: "Período de referência ligado à Páscoa. Confirmar a programação oficial e as datas de cada romaria.", fontes: [fonte("Governo do ES — Festa da Penha", "https://www.es.gov.br/Noticia/festa-da-penha-2025-a-mais-tradicional-manifestacao-religiosa-do-espirito-santo-tera-inicio-neste-domingo-20")] }),
  evento("inverno-sudeste", "Inverno e férias nas serras", "Temporadas/comercial", periodo(6, 8), ["Lenços", "Forros de mesa", "Painéis"], "Xadrez, arabescos, flores e paisagens serranas.", regional("Sudeste", "Destinos serranos de SP, RJ, MG e ES")),
  evento("barretos", "Festa do Peão de Barretos", "Country/rural", ref(8), LFP, "Bandanas, cavalos, botas, chapéus, ferraduras e couro ilustrado.", { ...regional("Sudeste", "Barretos/SP"), recomendacao: "Trabalhar linha country autoral, sem marcas do evento ou artistas sem autorização. Confirmar as datas da edição.", fontes: [fonte("Prefeitura de Barretos — agenda", "https://turismo.barretos.sp.gov.br/agenda-de-eventos")] }),
];
