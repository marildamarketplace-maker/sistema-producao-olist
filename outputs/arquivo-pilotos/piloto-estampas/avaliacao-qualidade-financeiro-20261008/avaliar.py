"""Avaliacao offline reproduzivel. Nao chama modelos nem modifica resultados do piloto."""
import collections, datetime, hashlib, json, pathlib, random, re, statistics, unicodedata
ROOT=pathlib.Path(__file__).resolve().parent
rows=[json.loads(l) for l in (ROOT/'snapshot.jsonl').read_text().splitlines() if l.strip()]
audits=json.loads((ROOT/'validacoes-contrato.json').read_text()); byline={a['linha']:a for a in audits}
def conf(r):
 c=r['configuracao'];return (c.get('provider','openai'),c['model'],c['detail'],c.get('thinkingLevel'))
def imagekey(r):return (r['id'],r['imageHash'])
def norm(s):return ''.join(c for c in unicodedata.normalize('NFD',s.lower()) if not unicodedata.combining(c))
def sha(o):return hashlib.sha256(json.dumps(o,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
groups=collections.defaultdict(list)
for i,r in enumerate(rows,1):r['_linha']=i;groups[conf(r)].append(r)
retained={}; repeated={}; attempts={}
for c,rr in groups.items():
 retained[c]={};repeated[c]=collections.defaultdict(list);attempts[c]={}
 for r in rr:
  ik=imagekey(r)
  if r['ok']:
   retained[c].setdefault(ik,r);repeated[c][ik].append(r)
  for e in r.get('historicoTentativas') or [r]:
   key=e.get('hash') or e.get('tentativaId') or e.get('resultado',{}).get('requestId') or sha({k:v for k,v in e.items() if k!='_linha'})
   attempts[c].setdefault(key,e)
valid_configs=[c for c in groups if retained[c]]
common=set.intersection(*(set(retained[c]) for c in valid_configs))
common_attempt=set.intersection(*({imagekey(r) for r in groups[c]} for c in valid_configs))
GENERIC={'moda','moda praia','decoracao','acessorios','vestuario','estampa','estampas','padrao','padroes','design','imagem','arte','moderno','design moderno','decorativo','verao','deco'}
PRESENTATION=re.compile(r'\b(codigo|texto central|tipografia|logotipo|identifica[cç][aã]o|regua|assinatura)\b')
def costs(rr):return [r['custoEstimadoUsd'] for r in rr if r.get('custoEstimadoUsd') is not None]
def metric(rr):
 ds=[r['resultado']['data'] for r in rr];kws=[t for d in ds for t in d['palavrasChave']]
 return {'n':len(rr),'aprovados':sum(r['qualidade']['status']=='APROVADO' for r in rr),'revisao':sum(r['qualidade']['precisaRevisao'] for r in rr),'media_termos':statistics.mean(len(d['palavrasChave']) for d in ds),'termos_amplos_ou_genericos':sum(norm(t) in GENERIC for t in kws),'total_termos':len(kws),'termos_apresentacao':sum(bool(PRESENTATION.search(norm(t))) for t in kws),'classificacao_textil_preenchida':sum(bool(d['classificacaoTextil']['padroesTexteis']) for d in ds),'custo_medio':statistics.mean(costs(rr)),'custo_p90':sorted(costs(rr))[int((len(costs(rr))-1)*.9)],'latencia_mediana_s':statistics.median(r['latencyMs'] for r in rr)/1000,'latencia_p90_s':sorted(r['latencyMs'] for r in rr)[int((len(rr)-1)*.9)]/1000,'media_input_tokens':statistics.mean(r['resultado']['usage']['inputTokens'] for r in rr),'media_output_tokens':statistics.mean(r['resultado']['usage']['outputTokens'] for r in rr),'cache_tokens':sum(r['resultado']['usage'].get('cachedInputTokens') or 0 for r in rr),'problemas':dict(collections.Counter(p['codigo'] for r in rr for p in r['qualidade']['problemas']))}
def stable_fn(d):return {'tipo':d['tipoImagem'],'distribuicao':tuple(sorted(d['composicaoVisual']['distribuicao']['valores'])),'orientacao':tuple(sorted(d['composicaoVisual']['orientacao']['valores'])),'densidade':tuple(sorted(d['composicaoVisual']['densidade']['valores'])),'linguagem':tuple(sorted(d['linguagemVisual']['valores'])),'padroes':tuple(sorted(i['termo'] for i in d['classificacaoTextil']['padroesTexteis']))}
def stability(c):
 batches=[rr for rr in repeated[c].values() if len(rr)>1];out={'imagens_reanalisadas':len(batches)}
 if not batches:return out
 for field in stable_fn(batches[0][0]['resultado']['data']):out[field+'_inalterado']=sum(len({stable_fn(r['resultado']['data'])[field] for r in rr})==1 for rr in batches)
 js=[]
 for rr in batches:
  a={norm(t) for t in rr[0]['resultado']['data']['palavrasChave']};b={norm(t) for t in rr[-1]['resultado']['data']['palavrasChave']};js.append(len(a&b)/len(a|b))
 out['jaccard_medio_keywords_primeiro_ultimo']=statistics.mean(js)
 return out
queries=[]
SPECS=[
 (1,'poá preto e branco',[['poa'],['pret'],['branc']],'poá com grade alternada',[['poa'],['grade'],['alternad']]),
 (2,'ondas multicoloridas',[['onda','ondulad'],['rosa'],['laranja']],'op art diagonal',[['op art','psicodelic','efeito optico'],['diagonal']]),
 (3,'quadrados concêntricos',[['quadrad','retangul'],['concentric']],'quadrados concêntricos centralizados',[['quadrad','retangul'],['concentric'],['centraliz','centro']]),
 (4,'folhagem azul',[['folhag','folh','botanic'],['azul']],'folhagem azul localizada',[['folhag','folh','botanic'],['azul'],['localiz']]),
 (5,'folhagem em ocre e creme',[['folhag','folh','botanic'],['ocre','bege','creme']],'ramo localizado com faixas verticais',[['ramo','ramag'],['localiz'],['vertical']]),
 (6,'paisley em tons terrosos',[['paisley'],['terros','marrom','marron','bege']],'paisley diagonal',[['paisley'],['diagonal']]),
 (7,'hibisco em fundo azul',[['hibisc'],['azul']],'hibisco com acabamento aquarelado',[['hibisc'],['aquarel']]),
 (8,'losangos em fundo escuro',[['losang'],['escuro','grafite','carvao','pret']],'losangos com baixo contraste',[['losang'],['baixo contraste','contraste baixo']]),
 (9,'veios de madeira em marrom',[['madeir'],['marrom','marron','caramelo']],'madeira com anéis concêntricos',[['madeir'],['aneis','anel','concentric','espira']]),
 (10,'flor centralizada',[['flor'],['central','centro']],'flor de cordão ou laçadas localizada',[['flor'],['cordao','lacad','laco'],['localiz']]),
 (11,'geométrico em faixas horizontais vermelhas',[['geometric'],['horizontal'],['vermelh']],'barrado geométrico vermelho',[['barrado'],['geometric'],['vermelh']]),
 (12,'buquês em fundo branco',[['buque'],['branc']],'buquês em fileiras alternadas',[['buque'],['alternad']]),
 (13,'arabesco vinho ou bordô',[['arabesc'],['vinho','bordo']],'treliça de arcos com buquês',[['trelica'],['arco'],['buque','flor']])]
visual=json.loads((ROOT/'amostra-visual.json').read_text());sid={v['indice']:v['id'] for v in visual}
for n,q1,g1,q2,g2 in SPECS:
 for q,gs in [(q1,g1),(q2,g2)]:queries.append({'imagem':sid[n],'consulta':q,'grupos_termos':gs})
query_details=[]
for c in valid_configs:
 for q in queries:
  rr=next(r for r in retained[c].values() if r['id']==q['imagem']);text=norm(byline[rr['_linha']]['textoPesquisa']);kw=norm(' '.join(rr['resultado']['data']['palavrasChave']))
  match=lambda t:all(any(re.search(r'\b'+re.escape(norm(v)),t) for v in group) for group in q['grupos_termos'])
  query_details.append({'configuracao':list(c),'imagem':q['imagem'],'consulta':q['consulta'],'coberta_indice_atual':match(text),'coberta_so_keywords':match(kw)})
metrics=[]
for c in valid_configs:
 rr=list(retained[c].values());paired=[retained[c][i] for i in sorted(common)];allattempt=list(attempts[c].values());fail=[e for e in allattempt if not e['ok']];f=sum(costs(fail));base=sum(costs(rr));repeat_cost=sum(costs([r for g in repeated[c].values() for r in g[1:]]));approved=sum(r['qualidade']['status']=='APROVADO' for r in rr)
 rng=random.Random(20261008);cc=costs(paired);boots=sorted(statistics.mean(rng.choices(cc,k=len(cc))) * 195000 for _ in range(3000))
 qs=[d for d in query_details if tuple(d['configuracao'])==c]
 metrics.append({'configuracao':list(c),'todos':metric(rr),'pareados':metric(paired),'operacao':{'imagens_tentadas':len({imagekey(r) for r in groups[c]}),'chamadas':len(allattempt),'falhas':len(fail),'falhas_sem_custo':sum(e.get('custoEstimadoUsd') is None for e in fail),'sucessos_reexecutados':sum(len(g)-1 for g in repeated[c].values()),'custo_sucessos_primeiros':base,'custo_sucessos_reexecutados':repeat_cost,'custo_falhas_conhecido':f,'custo_total_conhecido':sum(costs(allattempt)),'custo_por_imagem_aceita_com_falhas':(base+f)/len(rr),'custo_por_aprovacao_regra_com_falhas':(base+f)/approved,'projecao_195k_base':base/len(rr)*195000,'projecao_195k_com_falhas_conhecidas':(base+f)/len(rr)*195000,'projecao_195k_com_reserva20':(base+f)/len(rr)*195000*1.2,'sucessos_nas_80_comuns':len(set(retained[c])&common_attempt),'erros':dict(collections.Counter(e.get('erro') for e in fail))},'estabilidade':stability(c),'buscas':{'consultas':len(qs),'indice_atual':sum(q['coberta_indice_atual'] for q in qs),'so_keywords':sum(q['coberta_so_keywords'] for q in qs)},'bootstrap_media_custo_pareado_195k_ic95':[boots[75],boots[2924]]})
diverg={f:sum(len({stable_fn(retained[c][i]['resultado']['data'])[f] for c in valid_configs})>1 for i in common) for f in ['tipo','distribuicao','orientacao','densidade','linguagem','padroes']}
revisions=[]
for i in sorted(common):
 changes=[f for f in ['tipo','distribuicao','orientacao','densidade','linguagem','padroes'] if len({stable_fn(retained[c][i]['resultado']['data'])[f] for c in valid_configs})>1]
 if changes:revisions.append({'id':i[0],'divergencias':changes,'por_modelo':[{'configuracao':list(c),'atributos':stable_fn(retained[c][i]['resultado']['data'])} for c in valid_configs]})
claude_configs=[c for c in valid_configs if c[0]=='anthropic']
common_repeated=set.intersection(*({k for k,rr in repeated[c].items() if len(rr)>1} for c in claude_configs))
paired_stability={}
for c in claude_configs:
 paired_stability[c[1]]={'n':len(common_repeated)}
 for field in stable_fn(next(iter(retained[c].values()))['resultado']['data']):
  paired_stability[c[1]][field+'_inalterado']=sum(len({stable_fn(r['resultado']['data'])[field] for r in repeated[c][k]})==1 for k in common_repeated)
result={'corte':json.loads((ROOT/'corte.json').read_text()),'linhas':len(rows),'sucessos_brutos':len(audits),'sucessos_unicos':sum(len(r) for r in retained.values()),'reexecucoes_sucesso':len(audits)-sum(len(r) for r in retained.values()),'comparacao_conteudo_imagens':len(common),'comparacao_operacional_imagens':len(common_attempt),'contratos_invalidos':sum(not a['contratoValido'] for a in audits),'custos_divergentes':sum(a['diferencaCusto'] is not None and abs(a['diferencaCusto'])>1e-9 for a in audits),'metricas':metrics,'divergencias':diverg,'buscas':query_details,'consultas':queries,'fila_revisao':revisions,'estabilidade_pareada_claude':paired_stability,'gemini':'Sem resultados aceitos: 418 falhas de autenticacao; custo desconhecido, nao custo zero confirmado.'}
(ROOT/'metricas.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
assert result['sucessos_brutos']==808 and result['sucessos_unicos']==658
assert len({r['resultado']['requestId'] for r in rows if r['ok']})==808, 'Sucessos repetidos devem ser reconhecidos como chamadas distintas'
assert len(common)==61 and len(common_attempt)==80 and len(query_details)==130
assert all(len(m['configuracao'])==4 and m['buscas']['consultas']==26 for m in metrics)
assert result['contratos_invalidos']==result['custos_divergentes']==0
for m in metrics:
 op=m['operacao']
 assert abs(op['custo_total_conhecido']-op['custo_sucessos_primeiros']-op['custo_sucessos_reexecutados']-op['custo_falhas_conhecido'])<1e-9
for s in visual:
 h=hashlib.sha256(pathlib.Path(s['arquivo']).read_bytes()).hexdigest();assert (s['id'],h) in common
assert hashlib.sha256((ROOT/'snapshot.jsonl').read_bytes()).hexdigest()==result['corte']['sha256']
print(json.dumps({'validacoes':'OK','buscas_por_modelo':[{ 'config':m['configuracao'][1:3],**m['buscas']} for m in metrics],'estabilidade':[{'config':m['configuracao'][1:3],**m['estabilidade']} for m in metrics]},ensure_ascii=False))
