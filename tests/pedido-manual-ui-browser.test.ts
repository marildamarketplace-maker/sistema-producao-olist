import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { writeFile } from "node:fs/promises";
import { abrirChromeLocal,ate,chrome } from "./helpers/chrome-local";

test("pedido manual: fluxo completo responsivo, vendedor fixo, carteira e recuperação do aceite",{skip:chrome?false:"Chrome indisponível",timeout:120_000},async t => {
  const {cdp,url} = await abrirChromeLocal(t,"tests/fixtures/pedido-manual-browser.tsx", [{name:"link-local",setup(builder) { builder.onResolve({filter:/^next\/link$/},()=>({path:path.resolve("tests/fixtures/olist-empresa-link.tsx")})); }}]);
  const avaliar = <T,>(code:string) => cdp.avaliar<T>(code);
  const botao = (text:string) => `[...document.querySelectorAll("button")].find(b=>b.textContent.trim()===${JSON.stringify(text)})`;
  const clicar = async (text:string) => { await avaliar(`${botao(text)}.click()`); };
  const etapa = async (nome:string) => ate(()=>avaliar<boolean>(`document.querySelector("section h3")?.textContent===${JSON.stringify(nome)}`),`Etapa ${nome} não abriu`);
  const campo = (label:string) => `[...document.querySelectorAll("label")].find(l=>l.textContent.startsWith(${JSON.stringify(label)}))?.querySelector("input,select,textarea")`;
  const preencher = async (label:string,value:string) => avaliar(`{ const e=${campo(label)}; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)}); e.dispatchEvent(new Event('input',{bubbles:true})); }`);
  async function preparar() {
    await ate(()=>avaliar<boolean>(`Boolean(${botao("Continuar")} && !${botao("Continuar")}.disabled)`),"Conta não carregou").catch(async error=>{ console.error(await avaliar("document.body.innerText"),cdp.erros);throw error; });
    assert.equal(await avaliar('document.querySelector("select").value'),"00000000-0000-0000-0000-000000000002");
    await clicar("Continuar"); await etapa("Vendedor");
    assert.equal(await avaliar('document.body.innerText.includes("Vendedor fixo do usuário")'),true);
    assert.equal(await avaliar('document.querySelectorAll("select").length'),0);
    await clicar("Continuar"); await etapa("Cliente");
    await clicar("Buscar");
    await ate(()=>avaliar<boolean>('document.querySelector("select").options.length===2'),"Clientes não carregaram");
    await avaliar('const s=document.querySelector("select");s.value="30";s.dispatchEvent(new Event("change",{bubbles:true}))');
    await clicar("Continuar"); await etapa("Itens");
    await clicar("Adicionar item");
    await preencher("Tecido","Oxford com nome longo para testar quebra no resumo comercial");
    await preencher("Quantidade de peças","10"); await preencher("Quantidade de tecido","2.5");
    await preencher("Estampa","6861");
    await clicar("Continuar"); await etapa("Dados comerciais");
    await clicar("Continuar"); await etapa("Revisão");
    assert.equal(await avaliar('document.documentElement.scrollWidth<=innerWidth'),true);
  }
  for(const width of [360,390,1440]) for(const theme of ["light","dark"]) await t.test(`${width}px ${theme}`,async () => {
    await cdp.pedir("Emulation.setDeviceMetricsOverride",{width,height:900,deviceScaleFactor:1,mobile:width<768});
    await cdp.pedir("Page.navigate",{url:`${url}?tema=${theme}`});
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
    assert.equal(await avaliar('window.testeManual.envios[0].selecoes.vendedorId'),20);
    assert.equal(await avaliar('window.testeManual.envios[0].itens[0].quantidadeTecido'),2.5);
    assert.equal(await avaliar('document.querySelector("a[href*=fila-pedidos]")===null'),true,"Autor sem gestão não recebe acesso administrativo");
    assert.equal(await avaliar('document.documentElement.scrollWidth<=innerWidth'),true);
  });
  await t.test("falha de rede preserva confirmação após recarregar e repete a mesma chave",async () => {
    await cdp.pedir("Page.navigate",{url}); await preparar();
    await avaliar('window.testeManual.falhar=true'); await clicar("Enviar para fila");
    await ate(()=>avaliar<boolean>('Boolean([...document.querySelectorAll("button")].find(b=>b.textContent==="Confirmar resultado"))'),"Recuperação não apareceu");
    const tentativa=await avaliar('window.testeManual.envios[0]');
    await cdp.pedir("Page.navigate",{url:`${url}?preservar=1`});
    await ate(()=>avaliar<boolean>(`Boolean(${botao("Confirmar resultado")} && !${botao("Confirmar resultado")}.disabled)`),"Confirmação não persistiu");
    await clicar("Confirmar resultado");
    await ate(()=>avaliar<boolean>('document.body.innerText.includes("Pedido registrado na fila")'),"Recuperação falhou");
    assert.deepEqual(await avaliar('window.testeManual.envios[0]'),tentativa);
    await cdp.pedir("Page.navigate",{url:`${url}?pedidoId=00000000-0000-0000-0000-000000000010&preservar=1`});
    await ate(()=>avaliar<boolean>('document.body.innerText.includes("Pedido registrado na fila")'),"Comprovante não persistiu no reload");
    assert.equal(await avaliar('window.testeManual.envios.length'),0);
  });
  await t.test("conta sem vínculo bloqueia avanço e permite escolher outra",async () => {
    await cdp.pedir("Page.navigate",{url});
    await ate(()=>avaliar<boolean>(`Boolean(${botao("Continuar")} && !${botao("Continuar")}.disabled)`),"Conta inicial não carregou");
    await avaliar('{window.testeManual.falharCarteira=true;const s=document.querySelector("select");s.value="00000000-0000-0000-0000-000000000003";s.dispatchEvent(new Event("change",{bubbles:true}));}');
    await ate(()=>avaliar<boolean>('document.body.innerText.includes("sem vínculo")'),"Erro de vínculo não apareceu");
    assert.equal(await avaliar(`${botao("Continuar")}.disabled`),true);
    await avaliar('{window.testeManual.falharCarteira=false;const s=document.querySelector("select");s.value="00000000-0000-0000-0000-000000000002";s.dispatchEvent(new Event("change",{bubbles:true}));}');
    await ate(()=>avaliar<boolean>(`!${botao("Continuar")}.disabled`),"Troca para conta válida não recuperou fluxo");
  });
  for (const recuperar of [false,true]) await t.test(`vínculo alterado é atualizado sem perder itens${recuperar ? " após reload" : ""}`,async () => {
    await cdp.pedir("Emulation.setDeviceMetricsOverride",{width:recuperar?1440:360,height:900,deviceScaleFactor:1,mobile:!recuperar});
    await cdp.pedir("Page.navigate",{url:`${url}?contaUnica=1`}); await preparar();
    if(recuperar) {
      await avaliar('window.testeManual.falhar=true');await clicar("Enviar para fila");
      await ate(()=>avaliar<boolean>(`Boolean(${botao("Confirmar resultado")} && !${botao("Confirmar resultado")}.disabled)`),"Tentativa não persistiu");
      await cdp.pedir("Page.navigate",{url:`${url}?preservar=1&contaUnica=1`});
      await ate(()=>avaliar<boolean>(`Boolean(${botao("Confirmar resultado")} && !${botao("Confirmar resultado")}.disabled)`),"Tentativa não foi recuperada");
    }
    await avaliar('window.testeManual.vendedorAtual=21');
    await clicar(recuperar?"Confirmar resultado":"Enviar para fila");
    await etapa("Aplicativo");
    await ate(()=>avaliar<boolean>(`!${botao("Continuar")}.disabled`),"Vínculo não foi reconsultado");
    assert.equal(await avaliar('document.querySelector("select").options.length'),1,"A correção não pode depender de trocar filial");
    await clicar("Continuar");await etapa("Vendedor");
    assert.equal(await avaliar('document.body.innerText.includes("ID 21")'),true);
    assert.equal(await avaliar('document.querySelectorAll("select").length'),0);
    await clicar("Continuar");await etapa("Cliente");
    assert.equal(await avaliar('document.querySelector("select").value'),"","O cliente do vínculo anterior deve ser limpo");
    await clicar("Buscar");
    await ate(()=>avaliar<boolean>('document.querySelector("select").options.length===2'),"Carteira atual não carregou");
    await avaliar('{const s=document.querySelector("select");s.value="30";s.dispatchEvent(new Event("change",{bubbles:true}));}');
    await clicar("Continuar");await etapa("Itens");
    assert.equal(await avaliar(`${campo("Quantidade de peças")}.value`),"10");
    assert.equal(await avaliar(`${campo("Quantidade de tecido")}.value`),"2.5");
    assert.equal(await avaliar(`${campo("Tecido")}.value`),"Oxford com nome longo para testar quebra no resumo comercial");
    await clicar("Continuar");await etapa("Dados comerciais");await clicar("Continuar");await etapa("Revisão");
    await clicar("Enviar para fila");
    await ate(()=>avaliar<boolean>('document.body.innerText.includes("Pedido registrado na fila")'),"Pedido corrigido não foi aceito");
    assert.equal(await avaliar('window.testeManual.envios.at(-1).selecoes.vendedorId'),21);
    assert.equal(await avaliar('document.documentElement.scrollWidth<=innerWidth'),true);
  });
  assert.deepEqual(cdp.erros,[]);
});
