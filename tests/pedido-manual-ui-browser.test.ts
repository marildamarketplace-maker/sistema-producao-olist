import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { writeFile } from "node:fs/promises";
import { abrirChromeLocal,ate,chrome } from "./helpers/chrome-local";

test("pedido manual: fluxo completo responsivo, vendedor fixo, carteira e recuperação do aceite",{skip:chrome?false:"Chrome indisponível",timeout:120_000},async t => {
  const {cdp,url} = await abrirChromeLocal(t,"tests/fixtures/pedido-manual-browser.tsx", [{name:"link-local",setup(builder) { builder.onResolve({filter:/^next\/link$/},()=>({path:path.resolve("tests/fixtures/olist-empresa-link.tsx")})); }}]);
  const avaliar = <T,>(code:string) => cdp.avaliar<T>(code);
  const botao = (text:string) => `[...document.querySelectorAll("button")].find(b=>b.textContent.trim()===${JSON.stringify(text)})`;
  const aguardarBotaoHabilitado = (text:string,mensagem:string) => ate(()=>avaliar<boolean>(`(() => { const elemento=${botao(text)}; return Boolean(elemento && !elemento.disabled); })()`),mensagem);
  const clicar = async (text:string) => { await avaliar(`${botao(text)}.click()`); };
  const etapa = async (nome:string) => ate(()=>avaliar<boolean>(`document.querySelector("section h3")?.textContent===${JSON.stringify(nome)}`),`Etapa ${nome} não abriu`);
  const campo = (label:string) => `[...document.querySelectorAll("label")].find(l=>l.textContent.startsWith(${JSON.stringify(label)}))?.querySelector("input,select,textarea")`;
  const preencher = async (label:string,value:string) => avaliar(`{ const e=${campo(label)}; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)}); e.dispatchEvent(new Event('input',{bubbles:true})); }`);
  async function adicionarProduto() {
    await clicar("Adicionar item");
    await avaliar(`{const grupo=[...document.querySelectorAll("fieldset")].at(-1);[...grupo.querySelectorAll("button")].find(b=>b.textContent==="Produto sublimado").click();}`);
    await avaliar(`{const grupo=[...document.querySelectorAll("fieldset")].at(-1);for(const [nome,valor] of [["Estampa","6861"],["Variante","A"],["Tipo de produto","Lenço"],["Quantidade de tecido","1"]]){const e=[...grupo.querySelectorAll("label")].find(l=>l.textContent.startsWith(nome)).querySelector("input");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,valor);e.dispatchEvent(new Event("input",{bubbles:true}));}const label=[...grupo.querySelectorAll("label")].find(l=>l.textContent==="Tamanho");const e=document.getElementById(label.htmlFor);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,"70");e.dispatchEvent(new Event("input",{bubbles:true}));}`);
    await avaliar('[...document.querySelectorAll("button")].find(b=>b.textContent==="Confirmar metragem")?.click()');
  }
  let navegacao = 0;
  async function navegar(endereco:string) {
    const destino = new URL(endereco);
    destino.searchParams.set("navegacaoTeste",String(++navegacao));
    await cdp.pedir("Page.navigate",{url:destino.href});
    await ate(()=>avaliar<boolean>(`location.href===${JSON.stringify(destino.href)} && document.readyState==="complete" && Boolean(document.querySelector("#root > main")) && Boolean(window.testeManual)`),"Novo documento da fixture não ficou pronto");
  }
  async function preparar(nomeDestinoEsperado = "Filial com nome muito longo para verificar responsividade") {
    await aguardarBotaoHabilitado("Continuar","Conta não carregou").catch(async error=>{ console.error(await avaliar("document.body.innerText"),cdp.erros);throw error; });
    await etapa("Vendedor");
    assert.equal(await avaliar('document.body.innerText.includes("Vendedor fixo do usuário")'),true);
    assert.equal(await avaliar(`Boolean(${botao("Atualizar conta")} || ${botao("Tentar novamente")})`),false,"Carga automática dispensa ações de atualização da conta");
    assert.equal(await avaliar('document.querySelectorAll("select").length'),0);
    await clicar("Continuar"); await etapa("Cliente");
    await clicar("Buscar");
    await ate(()=>avaliar<boolean>('document.querySelector("select").options.length===2'),"Clientes não carregaram");
    await avaliar('{const s=document.querySelector("select");s.value="30";s.dispatchEvent(new Event("change",{bubbles:true}));}');
    await clicar("Continuar"); await etapa("Aplicativo");
    await aguardarBotaoHabilitado("Continuar","Destino não resolvido");
    assert.equal(await avaliar('document.querySelector("section h3").parentElement.querySelector("button")?.textContent'), "Atualizar direcionamento", "Ação fica no cabeçalho da etapa Aplicativo");
    assert.equal(await avaliar('(()=>{if(innerWidth<768)return true;const h=document.querySelector("section h3").getBoundingClientRect();const b=document.querySelector("section h3").parentElement.querySelector("button").getBoundingClientRect();return b.left>h.right&&Math.abs(h.top+h.height/2-b.top-b.height/2)<1;})()'), true, "No desktop a ação fica à direita, alinhada ao título");
    assert.equal(await avaliar('document.querySelectorAll("select").length'),0,"Destino é definido pela regra");
    assert.equal(await avaliar('document.querySelector("section dl dd").textContent'),nomeDestinoEsperado);
    await clicar("Continuar"); await etapa("Itens");
    await adicionarProduto();
    await preencher("Tecido","Oxford com nome longo para testar quebra no resumo comercial");
    await preencher("Quantidade de peças","10"); await preencher("Quantidade de tecido","2.5");
    await preencher("Estampa","6861");
    await clicar("Continuar"); await etapa("Dados comerciais");
    assert.equal(await avaliar('document.body.innerText.includes("Filtrar produtos carregados")'),false,"Produtos são definidos somente em Itens");
    await ate(()=>avaliar<boolean>('window.testeManual.consultas.some(q=>{const p=new URLSearchParams(q);return p.get("recurso")==="formas"&&p.get("busca")===""&&p.get("pagina")==="1";})'),"Formas de pagamento não carregaram automaticamente");
    assert.equal(await avaliar('(()=>{const f=[...document.querySelectorAll("label")].find(e=>e.textContent==="Forma de pagamento").parentElement;return [...f.querySelectorAll("button")].some(b=>b.textContent==="Anterior"||b.textContent==="Mais resultados");})()'),false,"Página única dispensa paginação");
    await clicar("Continuar"); await etapa("Revisão");
    assert.equal(await avaliar('document.querySelector("section dl dd").textContent'),nomeDestinoEsperado,"A revisão conserva o destinatário resolvido fora das referências");
    assert.equal(await avaliar('document.documentElement.scrollWidth<=innerWidth'),true);
  }
  async function selecionarClienteDaReferencia() {
    await clicar("Continuar");await etapa("Cliente");
    assert.equal(await avaliar('document.body.innerText.includes("Somente clientes da carteira do seu vendedor")'),true);
    await clicar("Buscar");
    await ate(()=>avaliar<boolean>('document.querySelector("select")?.options.length===2'),"Carteira da referência não carregou");
    await avaliar('{const s=document.querySelector("select");s.value="30";s.dispatchEvent(new Event("change",{bubbles:true}));}');
    await clicar("Continuar");await etapa("Aplicativo");
    await aguardarBotaoHabilitado("Continuar","Destino da referência não resolveu");
  }
  for(const width of [360,390,1440]) for(const theme of ["light","dark"]) await t.test(`${width}px ${theme}`,async () => {
    await cdp.pedir("Emulation.setDeviceMetricsOverride",{width,height:900,deviceScaleFactor:1,mobile:width<768});
    await navegar(`${url}?tema=${theme}`);
    await preparar();
    const rect=await avaliar<{x:number;y:number;width:number;height:number}>(`${botao("Enviar para fila")}.scrollIntoView({block:"center"});JSON.parse(JSON.stringify(${botao("Enviar para fila")}.getBoundingClientRect()))`);
    assert.ok(rect.height>=44&&rect.width>=44);
    if(width===360&&theme==="dark") {
      const shot=await cdp.pedir("Page.captureScreenshot",{format:"png"});
      await writeFile("/tmp/pedido-manual-mobile.png",Buffer.from(String(shot.data),"base64"));
    }
    if(width<768) {
      await cdp.pedir("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x:rect.x+rect.width/2,y:rect.y+rect.height/2}]});
      await cdp.pedir("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
    } else {
      await avaliar(`${botao("Enviar para fila")}.focus()`);
      await cdp.pedir("Input.dispatchKeyEvent",{type:"keyDown",key:"Enter",code:"Enter",windowsVirtualKeyCode:13,text:"\r"});
      await cdp.pedir("Input.dispatchKeyEvent",{type:"keyUp",key:"Enter",code:"Enter",windowsVirtualKeyCode:13});
    }
    await ate(()=>avaliar<boolean>('document.body.innerText.includes("Pedido registrado na fila")'),"Aceite não apareceu");
    assert.equal(await avaliar('window.testeManual.envios.length'),1);
    assert.equal(await avaliar('window.testeManual.envios[0].selecoes.vendedorId'),120);
    assert.equal(await avaliar('window.testeManual.envios[0].origemManual.vendedor.id'),20);
    assert.equal(await avaliar('window.testeManual.envios[0].selecoes.clienteId'),130);
    assert.equal(await avaliar('window.testeManual.envios[0].itens[0].quantidadeTecido'),2.5);
    assert.equal(await avaliar('document.querySelector("a[href*=fila-pedidos]")===null'),true,"Autor sem gestão não recebe acesso administrativo");
    assert.equal(await avaliar('document.documentElement.scrollWidth<=innerWidth'),true);
  });
  for (const [query,nome] of [["semAplicativoDestino=1","00000000-0000-0000-0000-000000000003"],
    ["contaUnica=1&semAplicativoDestino=1","Conta própria"]]) await t.test(`resposta sem nome de destino preserva a identificação na revisão: ${nome}`,async () => {
    await navegar(`${url}?${query}`);
    await preparar(nome);
    assert.equal(await avaliar(`${botao("Enviar para fila")}.disabled`),false);
  });
  await t.test("falha de rede preserva confirmação após recarregar e repete a mesma chave",async () => {
    await navegar(url); await preparar();
    await avaliar('window.testeManual.falhar=true'); await clicar("Enviar para fila");
    await ate(()=>avaliar<boolean>('Boolean([...document.querySelectorAll("button")].find(b=>b.textContent==="Confirmar resultado"))'),"Recuperação não apareceu");
    const tentativa=await avaliar('window.testeManual.envios[0]');
    await navegar(`${url}?preservar=1`);
    await aguardarBotaoHabilitado("Confirmar resultado","Confirmação não persistiu");
    await clicar("Confirmar resultado");
    await ate(()=>avaliar<boolean>('document.body.innerText.includes("Pedido registrado na fila")'),"Recuperação falhou");
    assert.deepEqual(await avaliar('window.testeManual.envios[0]'),tentativa);
    await navegar(`${url}?pedidoId=00000000-0000-0000-0000-000000000010&preservar=1`);
    await ate(()=>avaliar<boolean>('document.body.innerText.includes("Pedido registrado na fila")'),"Comprovante não persistiu no reload");
    assert.equal(await avaliar('window.testeManual.envios.length'),0);
  });
  await t.test("destino sem vínculo bloqueia avanço e permite repetir a resolução",async () => {
    await navegar(url);
    await aguardarBotaoHabilitado("Continuar","Conta inicial não carregou");
    await clicar("Continuar");await etapa("Cliente");await clicar("Buscar");
    await ate(()=>avaliar<boolean>('document.querySelector("select").options.length===2'),"Clientes não carregaram");
    await avaliar('{window.testeManual.falharCarteira=true;const s=document.querySelector("select");s.value="30";s.dispatchEvent(new Event("change",{bubbles:true}));}');
    await clicar("Continuar");await etapa("Aplicativo"); await clicar("Atualizar direcionamento");
    await ate(()=>avaliar<boolean>('document.body.innerText.includes("sem vínculo")'),"Erro de vínculo não apareceu");
    assert.equal(await avaliar(`${botao("Continuar")}.disabled`),true);
    await avaliar('window.testeManual.falharCarteira=false');await clicar("Atualizar direcionamento");
    await aguardarBotaoHabilitado("Continuar","Troca para conta válida não recuperou fluxo");
  });
  for (const width of [360,1440]) await t.test(`cliente sem documento bloqueia avanço e permite corrigir o cadastro em ${width}px`,async () => {
    await cdp.pedir("Emulation.setDeviceMetricsOverride",{width,height:900,deviceScaleFactor:1,mobile:width<768});
    await navegar(url);
    await aguardarBotaoHabilitado("Continuar","Conta não carregou");
    await clicar("Continuar");await etapa("Cliente");
    assert.equal(await avaliar('document.body.innerText.includes("O cliente precisa ter CPF/CNPJ cadastrado")'),true);
    await clicar("Buscar");
    await ate(()=>avaliar<boolean>('document.querySelector("select").options.length===2'),"Clientes não carregaram");
    await avaliar('{window.testeManual.clienteSemDocumento=true;const s=document.querySelector("select");s.value="30";s.dispatchEvent(new Event("change",{bubbles:true}));}');
    await clicar("Continuar");await etapa("Aplicativo"); await clicar("Atualizar direcionamento");
    await ate(()=>avaliar<boolean>('document.body.innerText.includes("Cadastre o CPF/CNPJ do cliente")'),"Aviso de documento não apareceu");
    assert.equal(await avaliar(`${botao("Continuar")}.disabled`),true);
    assert.equal(await avaliar('window.testeManual.envios.length'),0);
    assert.equal(await avaliar('document.documentElement.scrollWidth<=innerWidth'),true);
    await avaliar('window.testeManual.clienteSemDocumento=false');await clicar("Atualizar direcionamento");
    await aguardarBotaoHabilitado("Continuar","Documento cadastrado não recuperou a resolução");
    await clicar("Continuar");await etapa("Itens");
  });
  for (const recuperar of [false,true]) await t.test(`vínculo alterado é atualizado sem perder itens${recuperar ? " após reload" : ""}`,async () => {
    await cdp.pedir("Emulation.setDeviceMetricsOverride",{width:recuperar?1440:360,height:900,deviceScaleFactor:1,mobile:!recuperar});
    await navegar(`${url}?contaUnica=1`); await preparar("Conta própria");
    if(recuperar) {
      await avaliar('window.testeManual.falhar=true');await clicar("Enviar para fila");
      await aguardarBotaoHabilitado("Confirmar resultado","Tentativa não persistiu");
      await navegar(`${url}?preservar=1&contaUnica=1`);
      await aguardarBotaoHabilitado("Confirmar resultado","Tentativa não foi recuperada");
    }
    await avaliar('window.testeManual.vendedorAtual=21');
    await clicar(recuperar?"Confirmar resultado":"Enviar para fila");
    await etapa("Vendedor");
    await aguardarBotaoHabilitado("Continuar","Vínculo não foi reconsultado");
    const chaveOriginal=await avaliar<string>('window.testeManual.envios[0].chaveIdempotencia');
    assert.equal(await avaliar('sessionStorage.getItem("pedido-manual:00000000-0000-0000-0000-000000000001:chave")'),chaveOriginal,"A rejeição não pode abandonar a chave de uma confirmação concorrente");
    assert.equal(await avaliar('document.querySelectorAll("select").length'),0,"A correção não depende de trocar filial");
    assert.equal(await avaliar('document.body.innerText.includes("ID 21")'),true);
    assert.equal(await avaliar('document.querySelectorAll("select").length'),0);
    await clicar("Continuar");await etapa("Cliente");
    await ate(()=>avaliar<boolean>('!document.querySelector("select").disabled'),"Carga automática não concluiu");
    assert.equal(await avaliar('document.querySelector("select").value'),"30","O cliente do vínculo anterior deve ser limpo");
    await clicar("Buscar");
    await ate(()=>avaliar<boolean>('document.querySelector("select").options.length===2'),"Carteira atual não carregou");
    await avaliar('{const s=document.querySelector("select");s.value="30";s.dispatchEvent(new Event("change",{bubbles:true}));}');
    await clicar("Continuar");await etapa("Aplicativo");
    await aguardarBotaoHabilitado("Continuar","Destino não revalidou");
    await clicar("Continuar");await etapa("Itens");
    assert.equal(await avaliar(`${campo("Quantidade de peças")}.value`),"10");
    assert.equal(await avaliar(`${campo("Quantidade de tecido")}.value`),"2.5");
    assert.equal(await avaliar(`${campo("Tecido")}.value`),"Oxford com nome longo para testar quebra no resumo comercial");
    await clicar("Continuar");await etapa("Dados comerciais");await clicar("Continuar");await etapa("Revisão");
    await clicar("Enviar para fila");
    await ate(()=>avaliar<boolean>('document.body.innerText.includes("Pedido registrado na fila")'),"Pedido corrigido não foi aceito");
    assert.equal(await avaliar('window.testeManual.envios.at(-1).selecoes.vendedorId'),21);
    assert.equal(await avaliar('window.testeManual.envios.at(-1).chaveIdempotencia'),chaveOriginal,"A correção deve reutilizar a mesma intenção");
    assert.equal(await avaliar('document.documentElement.scrollWidth<=innerWidth'),true);
  });
  await t.test("conflito de conteúdo recupera o pedido aceito sem aplicar as novas alterações",async()=>{
    await navegar(url);await preparar();
    await avaliar('window.testeManual.conflitoExistente=true');await clicar("Enviar para fila");
    await ate(()=>avaliar<boolean>('document.body.innerText.includes("Pedido registrado na fila")'),"Não recuperou o comprovante no conflito");
    assert.equal(await avaliar('document.body.innerText.includes("As alterações atuais não foram aplicadas")'),true);
    assert.equal(await avaliar('document.body.innerText.includes("CANCELADO")'),true);
    assert.equal(await avaliar('document.body.innerText.includes("Destino atual do pedido aceito")'),true);
    assert.equal(await avaliar('window.testeManual.envios.length'),1);
    assert.equal(await avaliar('sessionStorage.getItem("pedido-manual:00000000-0000-0000-0000-000000000001:chave")'),null);
    assert.equal(await avaliar(`${botao("Confirmar resultado")} === undefined`),true);
    const chaveAnterior=await avaliar<string>('window.testeManual.envios[0].chaveIdempotencia');
    await clicar("Criar outro pedido");await preparar();
    await avaliar('window.testeManual.conflitoExistente=false');await clicar("Enviar para fila");
    await ate(()=>avaliar<boolean>('window.testeManual.envios.length===2'),"Novo pedido não foi enviado");
    assert.notEqual(await avaliar('window.testeManual.envios.at(-1).chaveIdempotencia'),chaveAnterior,"Somente um novo pedido explícito recebe outra chave");
  });
  for (const falha of ["falhaInicial", "falhaVendedor"]) for (const width of [360, 1440]) await t.test(`${falha} pode ser recuperada sem recarregar a página em ${width}px`,async()=>{
    await cdp.pedir("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
    await navegar(`${url}?${falha}=1`);
    await ate(()=>avaliar<boolean>('document.body.innerText.includes("Falha temporária")'),"Falha inicial não apareceu");
    assert.equal(await avaliar(`${botao("Atualizar conta")} === undefined`),true);
    assert.equal(await avaliar(`${botao("Continuar")}.disabled`),true);
    const consultasLista = () => avaliar<number>('window.testeManual.consultas.filter(q=>!new URLSearchParams(q).has("aplicativoId")).length');
    const chamadasAntes = await consultasLista();
    await clicar("Tentar novamente");
    await aguardarBotaoHabilitado("Continuar","Atualização inicial não recuperou o fluxo");
    assert.equal(await avaliar(`${botao("Tentar novamente")} === undefined`),true,"Recuperação desaparece após sucesso");
    assert.equal(await avaliar('Boolean(document.querySelector("[role=alert]"))'),false,"Recuperação limpa o erro de carregamento");
    assert.equal(await consultasLista(),chamadasAntes+(falha==="falhaInicial"?1:0),"Falha do vendedor não recarrega a lista de contas");
    assert.equal(await avaliar('document.documentElement.scrollWidth<=innerWidth'),true);
  });
  for (const width of [360, 1440]) await t.test(`busca inicial de vendedores automática e limitada em ${width}px`, async () => {
    await cdp.pedir("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
    await navegar(`${url}?livre=1`); await etapa("Vendedor");
    await ate(() => avaliar<boolean>('document.querySelector("select")?.options.length===2 && !document.querySelector("select").disabled'), "Vendedores não carregaram automaticamente");
    const consultas = () => avaliar<string[]>('window.testeManual.consultas.filter(q=>new URLSearchParams(q).get("recurso")==="vendedores")');
    assert.equal((await consultas()).length, 1);
    const inicial = new URLSearchParams((await consultas())[0]);
    assert.equal(inicial.get("busca"), ""); assert.equal(inicial.get("pagina"), "1");
    assert.equal(await avaliar('[...document.querySelectorAll("button")].some(b=>b.textContent==="Anterior"||b.textContent==="Mais resultados")'), false, "Busca com página única não exibe controles de paginação");
    assert.equal(await avaliar('document.querySelector("select").value'), "20", "Resultado único seleciona o vendedor");
    await avaliar('{const e=document.querySelector("fieldset input");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,"Ana");e.dispatchEvent(new Event("input",{bubbles:true}));}');
    assert.equal((await consultas()).length, 1, "Digitar não dispara nova chamada");
    await clicar("Buscar");
    await ate(async () => (await consultas()).length===2, "Pesquisa manual não foi executada");
    assert.equal(new URLSearchParams((await consultas())[1]).get("busca"), "Ana");
    await ate(() => avaliar<boolean>('!document.querySelector("select").disabled'), "Pesquisa não terminou");
    await avaliar('{const e=document.querySelector("select");e.value="20";e.dispatchEvent(new Event("change",{bubbles:true}));}');
    assert.equal((await consultas()).length, 2, "Selecionar não repete a carga inicial");
    assert.equal(await avaliar('document.documentElement.scrollWidth<=innerWidth'), true);
  });
  for (const width of [360, 1440]) await t.test(`busca inicial de clientes automática sem selecionar em ${width}px`, async () => {
    await cdp.pedir("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
    await navegar(url); await aguardarBotaoHabilitado("Continuar", "Conta não carregou");
    await clicar("Continuar"); await etapa("Cliente");
    await ate(() => avaliar<boolean>('document.querySelector("select")?.options.length===2 && !document.querySelector("select").disabled'), "Clientes não carregaram automaticamente");
    const consultas = () => avaliar<string[]>('window.testeManual.consultas.filter(q=>new URLSearchParams(q).get("recurso")==="clientes")');
    assert.equal((await consultas()).length, 1);
    const inicial = new URLSearchParams((await consultas())[0]);
    assert.equal(inicial.get("busca"), ""); assert.equal(inicial.get("pagina"), "1");
    assert.equal(await avaliar('[...document.querySelectorAll("button")].some(b=>b.textContent==="Anterior"||b.textContent==="Mais resultados")'), false, "Busca com página única não exibe controles de paginação");
    assert.equal(await avaliar('document.querySelector("select").value'), "30", "Resultado único seleciona o cliente");
    await avaliar('{const e=document.querySelector("select");e.value="30";e.dispatchEvent(new Event("change",{bubbles:true}));}');
    assert.equal((await consultas()).length, 1, "Selecionar não repete a consulta");
    await clicar("Voltar"); await clicar("Continuar"); await etapa("Cliente");
    await ate(() => avaliar<boolean>('!document.querySelector("select").disabled'), "Lista não reabriu");
    assert.equal(await avaliar('document.querySelector("select").value'), "30", "Reabrir preserva cliente selecionado");
    assert.equal(await avaliar('document.documentElement.scrollWidth<=innerWidth'), true);
  });
  await t.test("troca da referência limpa cliente mesmo para vendedor livre",async()=>{
    await navegar(`${url}?livre=1&fornecedor=1`);
    await etapa("Vendedor");
    await aguardarBotaoHabilitado("Continuar","Referência não carregou");await clicar("Buscar");
    await ate(()=>avaliar<boolean>('document.querySelector("fieldset select")?.value==="20"'),"Vendedores não carregaram");
    await clicar("Continuar");await etapa("Cliente");await clicar("Buscar");
    await ate(()=>avaliar<boolean>('document.querySelector("select").options.length===2'),"Clientes não carregaram");
    await avaliar('{const s=document.querySelector("select");s.value="30";s.dispatchEvent(new Event("change",{bubbles:true}));}');
    await clicar("Voltar");await etapa("Vendedor");
    await avaliar('{const s=document.querySelector("select");s.value="00000000-0000-0000-0000-000000000005";s.dispatchEvent(new Event("change",{bubbles:true}));}');
    await ate(()=>avaliar<boolean>('document.querySelector("fieldset select")?.value==="20" && !document.querySelector("fieldset select").disabled'),"Vendedor da nova referência não carregou");
    await clicar("Continuar");await etapa("Cliente");
    await ate(()=>avaliar<boolean>('document.querySelector("select")?.value==="30" && !document.querySelector("select").disabled'),"Carteira da nova referência não carregou");
    assert.equal(await avaliar('window.testeManual.consultas.some(q=>{const p=new URLSearchParams(q);return p.get("recurso")==="clientes"&&p.get("aplicativoId")==="00000000-0000-0000-0000-000000000005";})'),true,"Troca recarrega a carteira na conta escolhida");
    await clicar("Continuar");await etapa("Aplicativo");
    await aguardarBotaoHabilitado("Continuar","Destino da nova referência não resolveu");
    assert.equal(await avaliar('document.querySelector("section dl dd").textContent'),"Filial B do fornecedor");
  });
  const matrizFornecedor = "00000000-0000-0000-0000-000000000004";
  const filialA = "00000000-0000-0000-0000-000000000005";
  const filialB = "00000000-0000-0000-0000-000000000007";
  await t.test("padrão próprio sem vínculo mantém o seletor e permite escolher uma filial do fornecedor", async () => {
    await navegar(`${url}?fornecedor=1&padraoSemVinculo=1`);
    await etapa("Vendedor");
    await ate(()=>avaliar<boolean>('Boolean(document.querySelector("select")) && document.body.innerText.includes("sem vínculo")'),"Seletor não apareceu com a referência própria indisponível");
    assert.equal(await avaliar(`${botao("Continuar")}.disabled`),true);
    await avaliar(`{const s=document.querySelector("select");s.value=${JSON.stringify(filialA)};s.dispatchEvent(new Event("change",{bubbles:true}));}`);
    await aguardarBotaoHabilitado("Continuar","Fornecedor autorizado não recuperou o fluxo");
    assert.equal(await avaliar('document.body.innerText.includes("sem vínculo")'),false);
    assert.equal(await avaliar('document.querySelector("select").value'),filialA);
  });
  for (const referenciaInicial of [filialA,filialB]) for (const width of [360,1440]) for (const theme of ["light","dark"]) await t.test(`filial ${referenciaInicial===filialA?"A":"B"} como referência preserva itens na troca e envia para a matriz em ${width}px ${theme}`, async () => {
    const referenciaFinal = referenciaInicial===filialA?filialB:filialA;
    await cdp.pedir("Emulation.setDeviceMetricsOverride",{width,height:900,deviceScaleFactor:1,mobile:width<768});
    await navegar(`${url}?fornecedor=1&tema=${theme}`);
    await etapa("Vendedor");
    await ate(()=>avaliar<boolean>('Boolean(document.querySelector("select"))'),"Referências não carregaram");
    await aguardarBotaoHabilitado("Continuar","Conta de referência não carregou");
    assert.deepEqual(await avaliar('[...document.querySelector("select").options].map(o=>o.value)'),[
      "00000000-0000-0000-0000-000000000002",
      filialA,filialB,
    ],"A referência própria é preservada e a matriz fornecedora dá lugar às suas filiais");
    assert.equal(await avaliar('[...document.querySelector("select").options].slice(1).every(o=>o.textContent.includes("Conta do fornecedor"))'),true);
    assert.equal(await avaliar('document.body.innerText.includes("fila da matriz fornecedora")'),true);
    assert.equal(await avaliar('document.documentElement.scrollWidth<=innerWidth'),true);
    await avaliar(`{window.testeManual.semVinculoAplicativoId=${JSON.stringify(referenciaInicial)};const s=document.querySelector("select");s.value=${JSON.stringify(referenciaInicial)};s.dispatchEvent(new Event("change",{bubbles:true}));}`);
    await ate(()=>avaliar<boolean>('document.body.innerText.includes("Aguardando configuração de vendedor pelo fornecedor")'),"Ausência do vínculo na filial não bloqueou a referência");
    assert.equal(await avaliar(`${botao("Continuar")}.disabled`),true);
    assert.equal(await avaliar('window.testeManual.consultas.some(q=>new URLSearchParams(q).get("recurso")==="clientes")'),false,"Sem vínculo não consulta carteira");
    await avaliar(`{const s=document.querySelector("select");s.value=${JSON.stringify(referenciaFinal)};s.dispatchEvent(new Event("change",{bubbles:true}));}`);
    await aguardarBotaoHabilitado("Continuar","A outra filial vinculada não recuperou o fluxo");
    assert.equal(await avaliar('document.body.innerText.includes("Aguardando configuração")'),false);
    assert.equal(await avaliar('document.body.innerText.includes("Vendedor vinculado · ID 120")'),referenciaFinal===filialB,"Cada filial usa seu próprio vendedor");
    await avaliar(`{window.testeManual.semVinculoAplicativoId=null;const s=document.querySelector("select");s.value=${JSON.stringify(referenciaInicial)};s.dispatchEvent(new Event("change",{bubbles:true}));}`);
    await aguardarBotaoHabilitado("Continuar","Filial com vínculo confirmado não recuperou");
    await selecionarClienteDaReferencia();
    assert.equal(await avaliar(`window.testeManual.consultas.some(q=>{const p=new URLSearchParams(q);return p.get("recurso")==="clientes"&&p.get("aplicativoId")===${JSON.stringify(referenciaInicial)};})`),true);
    assert.equal(await avaliar('document.querySelector("section dl dd").textContent'),"Filial B do fornecedor","A referência não fixa o destinatário das regras");
    await clicar("Continuar"); await etapa("Itens"); await adicionarProduto(); await preencher("Tecido","Oxford preservado");
    await clicar("Voltar");await clicar("Voltar");await clicar("Voltar");await etapa("Vendedor");
    await avaliar(`{const s=document.querySelector("select");s.value=${JSON.stringify(referenciaFinal)};s.dispatchEvent(new Event("change",{bubbles:true}));}`);
    await aguardarBotaoHabilitado("Continuar","Troca para a outra filial não carregou");
    await ate(()=>avaliar<boolean>('!document.querySelector("select").disabled'),"Carga automática não concluiu");
    await clicar("Continuar");await etapa("Cliente");assert.equal(await avaliar('document.querySelector("select").value'),"30");
    await clicar("Buscar");await ate(()=>avaliar<boolean>('document.querySelector("select").options.length===2'),"Carteira nova não carregou");
    await avaliar('{const s=document.querySelector("select");s.value="30";s.dispatchEvent(new Event("change",{bubbles:true}));}');
    await clicar("Continuar");await etapa("Aplicativo");await aguardarBotaoHabilitado("Continuar","Destino novo não resolveu");
    await clicar("Continuar");await etapa("Itens");assert.equal(await avaliar(`${campo("Tecido")}.value`),"Oxford preservado");
    await clicar("Continuar");await clicar("Continuar");await etapa("Revisão");
    assert.equal(await avaliar('document.querySelector("section dl dd").textContent'),"Filial B do fornecedor");
    assert.equal(await avaliar('document.documentElement.scrollWidth<=innerWidth'),true);
    await clicar("Enviar para fila");await ate(()=>avaliar<boolean>('document.body.innerText.includes("Pedido registrado na fila")'),"Pedido externo não enfileirou");
    assert.equal(await avaliar('window.testeManual.envios[0].fornecedorManual.matrizId'),matrizFornecedor);
    assert.equal(await avaliar('window.testeManual.envios[0].fornecedorManual.referencia.aplicativoId'),referenciaFinal);
    assert.equal(await avaliar('window.testeManual.envios[0].origemManual.aplicativoId'),referenciaFinal);
    assert.equal(await avaliar('window.testeManual.envios[0].origemManual.vendedor.id'),referenciaFinal===filialB?120:20);
    assert.equal(await avaliar('window.testeManual.envios[0].fornecedorManual.destino.aplicativoId'),filialB);
    assert.equal(await avaliar('window.testeManual.envios[0].aplicativoId'),filialB);
    assert.equal(await avaliar('window.testeManual.envios[0].itens[0].tecidoNome'),"Oxford preservado");
    assert.equal(await avaliar(`window.testeManual.consultas.some(q=>new URLSearchParams(q).get("aplicativoId")===${JSON.stringify(matrizFornecedor)})`),false,"As filiais não exigem consultar vendedor ou carteira da matriz");
    assert.equal(await avaliar('document.querySelector("a[href*=fila-pedidos]")===null'),true);
  });
  for (const width of [360,1440]) for (const theme of ["light","dark"]) await t.test(`fornecedor sem filiais usa a matriz como referência e destino em ${width}px ${theme}`,async () => {
    await cdp.pedir("Emulation.setDeviceMetricsOverride",{width,height:900,deviceScaleFactor:1,mobile:width<768});
    await navegar(`${url}?fornecedor=1&fornecedorSemFiliais=1&tema=${theme}`);
    await aguardarBotaoHabilitado("Continuar","Referências sem filiais não carregaram");
    assert.deepEqual(await avaliar('[...document.querySelector("select").options].map(o=>o.value)'),[
      "00000000-0000-0000-0000-000000000002",matrizFornecedor,
    ]);
    await avaliar(`{const s=document.querySelector("select");s.value=${JSON.stringify(matrizFornecedor)};s.dispatchEvent(new Event("change",{bubbles:true}));}`);
    await aguardarBotaoHabilitado("Continuar","Matriz sem filiais não carregou");
    await selecionarClienteDaReferencia();
    assert.equal(await avaliar('document.querySelector("section dl dd").textContent'),"MV Tecidos fornecedor com nome longo");
    await clicar("Continuar");await etapa("Itens");await adicionarProduto();await preencher("Tecido","Oxford matriz");
    await clicar("Continuar");await etapa("Dados comerciais");await clicar("Continuar");await etapa("Revisão");
    assert.equal(await avaliar('document.querySelector("section dl dd").textContent'),"MV Tecidos fornecedor com nome longo");
    assert.equal(await avaliar('document.documentElement.scrollWidth<=innerWidth'),true);
    await clicar("Enviar para fila");await ate(()=>avaliar<boolean>('document.body.innerText.includes("Pedido registrado na fila")'),"Matriz sem filiais não enfileirou");
    assert.equal(await avaliar('window.testeManual.envios[0].fornecedorManual.matrizId'),matrizFornecedor);
    assert.equal(await avaliar('window.testeManual.envios[0].fornecedorManual.referencia.aplicativoId'),matrizFornecedor);
    assert.equal(await avaliar('window.testeManual.envios[0].fornecedorManual.destino.aplicativoId'),matrizFornecedor);
    assert.equal(await avaliar('window.testeManual.envios[0].selecoes.vendedorId'),20);
  });
  assert.deepEqual(cdp.erros,[]);
});
