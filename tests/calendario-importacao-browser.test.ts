import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { abrirChromeLocal, ate, chrome } from "./helpers/chrome-local";

test("importação CSV: prévia, opções, gravação integral e falha atômica em mobile/desktop",{skip:chrome?false:"Chrome indisponível",timeout:60000},async t=>{
  const pasta=await mkdtemp(path.join(tmpdir(),"calendario-csv-"));t.after(()=>rm(pasta,{recursive:true,force:true}));
  const arquivo=path.join(pasta,"associacoes.csv");
  await writeFile(arquivo,'\ufeffSKU;Evento principal ID;Eventos adicionais IDs;Tipo associacao\r\n'+Array.from({length:101},(_,i)=>`SKU-${i};natal;advento;Direta`).join('\r\n')+'\r\nSKU-sugestao;natal;;Sugestão comercial\r\nAUSENTE;natal;;Direta\r\n');
  const {cdp,url}=await abrirChromeLocal(t,"tests/fixtures/calendario-importacao-browser.tsx",[{
    name:"dependencias-importacao",setup(builder){
      builder.onResolve({filter:/^(?:@\/components\/auth-provider|\.\.\/actions)$/},()=>({path:path.resolve("tests/fixtures/calendario-importacao-browser.tsx")}));
      builder.onResolve({filter:/^next\/link$/},()=>({path:"link",namespace:"importacao-teste"}));
      builder.onLoad({filter:/.*/,namespace:"importacao-teste"},()=>({loader:"jsx",resolveDir:process.cwd(),contents:'export default function Link(props){return <a {...props}/>;}'}));
    },
  }]);
  const avaliar=<T,>(codigo:string)=>cdp.avaliar<T>(codigo);
  const clicar=(texto:string)=>avaliar(`[...document.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(texto)}).click()`);
  await cdp.pedir("Page.navigate",{url});
  await ate(()=>avaliar<boolean>("Boolean(document.querySelector('input[type=file]'))"),"Não carregou");
  await cdp.pedir("DOM.enable");const {root}=await cdp.pedir("DOM.getDocument");
  const {nodeId}=await cdp.pedir("DOM.querySelector",{nodeId:(root as {nodeId:number}).nodeId,selector:"input[type=file]"});
  await cdp.pedir("DOM.setFileInputFiles",{nodeId,files:[arquivo]});
  await ate(()=>avaliar<boolean>('document.body.textContent.includes("103 registros lidos")'),"Não leu CSV");
  await avaliar("[...document.querySelectorAll('button')].find(b=>b.textContent==='Validar CSV').focus()");
  await cdp.pedir("Input.dispatchKeyEvent",{type:"keyDown",key:"Enter",code:"Enter",windowsVirtualKeyCode:13,text:"\r",unmodifiedText:"\r"});
  await cdp.pedir("Input.dispatchKeyEvent",{type:"keyUp",key:"Enter",code:"Enter",windowsVirtualKeyCode:13});
  await ate(()=>avaliar<boolean>('document.body.textContent.includes("101 vínculos novos")'),"Prévia incorreta");
  assert.equal(await avaliar('window.importacaoTeste.total()'),0);
  assert.equal(await avaliar('document.querySelectorAll("input[type=checkbox]:checked").length'),0);
  await clicar("Importar 101 vínculos válidos");
  await ate(()=>avaliar<boolean>('document.body.textContent.includes("Falha simulada")'),"Falha parcial não exibida");
  assert.equal(await avaliar('window.importacaoTeste.total()'),0);
  await clicar("Validar CSV");
  await ate(()=>avaliar<boolean>('document.body.textContent.includes("101 vínculos novos")'),"Não revalidou");
  await clicar("Importar 101 vínculos válidos");
  await ate(()=>avaliar<boolean>('document.body.textContent.includes("Importação concluída: 101 vínculos confirmados")'),"Importação integral não concluiu");
  assert.equal(await avaliar('window.importacaoTeste.total()'),101);
  await clicar("Validar CSV");await ate(()=>avaliar<boolean>('document.body.textContent.includes("101 já associados")'),"Não reconciliou vínculos salvos");
  for(const largura of [390,1440])for(const dark of [false,true]){
    await cdp.pedir("Emulation.setDeviceMetricsOverride",{width:largura,height:900,deviceScaleFactor:1,mobile:largura<768});
    await avaliar(`document.documentElement.classList.toggle('dark',${dark})`);
    assert.equal(await avaliar<boolean>('document.documentElement.scrollWidth<=window.innerWidth'),true);
    const destino=process.env.CALENDARIO_IMPORTACAO_SCREENSHOTS;
    if(destino){
      await mkdir(destino,{recursive:true});
      const metrics=await cdp.pedir("Page.getLayoutMetrics");
      const altura=(metrics.cssContentSize as {height:number}).height;
      const captura=await cdp.pedir("Page.captureScreenshot",{format:"png",captureBeyondViewport:true,clip:{x:0,y:0,width:largura,height:Math.min(altura,3500),scale:1}});
      await writeFile(path.join(destino,`importacao-${largura}-${dark?"escuro":"claro"}.png`),Buffer.from(captura.data as string,"base64"));
    }
  }
  await avaliar('document.querySelectorAll("input[type=checkbox]")[1].click()');
  await ate(()=>avaliar<boolean>("![...document.querySelectorAll('section')].some(s=>s.getAttribute('aria-label')==='Prévia da importação')"),"Opções não invalidaram a prévia");
  await clicar("Validar CSV");await ate(()=>avaliar<boolean>('document.body.textContent.includes("101 vínculos novos")'),"Eventos adicionais não entraram na nova prévia");
  assert.deepEqual(cdp.erros,[]);
});
