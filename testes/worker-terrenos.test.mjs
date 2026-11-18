// Testes das rotas de edição manual de Terrenos no Worker (empacotado com esbuild, KV em memória).
// Rodar: npm test

import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const saida = join(mkdtempSync(join(tmpdir(), 'radar-')), 'worker.mjs');
await build({ entryPoints: [join(raiz, 'worker/index.js')], bundle: true, format: 'esm', platform: 'neutral', outfile: saida, logLevel: 'warning' });
const { default: w } = await import(pathToFileURL(saida).href);

const kv = () => {
  const m = new Map();
  return {
    m,
    async get(k, t) { const v = m.get(k); return v == null ? null : (t === 'json' ? JSON.parse(v) : v); },
    async put(k, v) { m.set(k, v); },
    async delete(k) { m.delete(k); },
    async list() { return { keys: [...m.keys()].map(name => ({ name })), list_complete: true }; },
  };
};
const env = { COLLECT_SECRET: 's', RADAR_SENHA: 'p', CONCURSOS: kv(), REVISAO: kv(), OPORTUNIDADES: kv(), CORRETORES: kv() };
const ctx = { waitUntil() {} };
const eq = (a, b, nome) => assert.deepEqual(a, b, nome);

test('edição manual de corretores e terrenos convive com a coleta', async () => {
  const call=async(m,path,body,tok='p')=>{const r=await w.fetch(new Request('https://x'+path,{method:m,headers:{Authorization:'Bearer '+tok,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined}),env,ctx);return [r.status,await r.json()]};
  
  // coleta inicial
  await call('POST','/api/collect-terrenos',{oportunidades:[{id:'op1',titulo:'T1',local:'Bessa',status_interno:'monitorando',nivel_maturidade:1}],corretoresCandidatos:[{nome:'Canal RV',empresa:'Canal RV',fonte:'youtube.com',regiao:'RM',canal_id:'UC1',oportunidade_id:'op1',nivel:1,whatsapp:'+5583999887766',instagram:'rv'}]},'s');
  const cid=JSON.parse([...env.CORRETORES.m.entries()].find(([k])=>!k.startsWith('_'))[1]).id;
  // editar corretor
  let [st,c]=await call('PATCH','/api/corretores/'+cid,{nome:'Ricardo Vieira',whatsapp:'(83) 98888-1111',instagram:'https://instagram.com/ricardo.v/',creci:'pb 1234 j',email:'',regioes_atuacao:'João Pessoa, Cabedelo'});
  eq(st,200,'patch corretor'); eq(c.whatsapp,'+5583988881111','wpp'); eq(c.instagram,'ricardo.v','ig'); eq(c.creci,'PB-1234-J','creci'); eq(c.regioes_atuacao,['João Pessoa','Cabedelo'],'reg');
  eq(c.campos_manuais.sort(),['creci','email','instagram','nome','regioes_atuacao','whatsapp'],'manuais');
  [st]=await call('PATCH','/api/corretores/'+cid,{whatsapp:'12'}); eq(st,400,'tel invalido');
  // corretor manual + terreno manual ligado
  let [st2,c2]=await call('POST','/api/corretores',{nome:'Ana Lins',whatsapp:'83 99111-2222'}); eq(st2,201,'novo corretor'); eq(c2.descoberto_via,['manual'],'via');
  let [st3,r3]=await call('POST','/api/oportunidades',{titulo:'Terreno Altiplano indicação',local:'Altiplano, João Pessoa',corretor_vinculado_id:c2.id,nivel_maturidade:3});
  eq(st3,201,'nova op'); eq(r3.corretores[0].oportunidades_vinculadas,[r3.oportunidade.id],'vinc manual');
  // editar op1: titulo, trocar corretor para Ana, descartar
  let [st4,r4]=await call('PATCH','/api/oportunidades/op1',{titulo:'Terreno Bessa 600m²',corretor_vinculado_id:c2.id,status_interno:'descartado'});
  eq(st4,200,'patch op'); eq(r4.corretores.length,2,'ajusta dois lados');
  eq(r4.corretores.find(x=>x.id===cid).oportunidades_vinculadas,[],'saiu do antigo');
  // recoleta: não pode desfazer nada
  await call('POST','/api/collect-terrenos',{oportunidades:[{id:'op1',titulo:'T1',local:'Bessa',status_interno:'monitorando',nivel_maturidade:2}],corretoresCandidatos:[{nome:'Canal RV',empresa:'Canal RV',fonte:'youtube.com',regiao:'Natal',canal_id:'UC1',oportunidade_id:'op1',nivel:2,whatsapp:'+5583999887766',email:'x@y.com'}]},'s');
  const op1=await env.OPORTUNIDADES.get('op1','json');
  eq(op1.titulo,'Terreno Bessa 600m²','titulo mantido'); eq(op1.status_interno,'descartado','status mantido'); eq(op1.corretor_vinculado_id,c2.id,'corretor manual mantido'); eq(op1.nivel_maturidade,2,'nivel coleta atualiza');
  const rv=await env.CORRETORES.get(cid,'json');
  eq(rv.nome,'Ricardo Vieira','nome'); eq(rv.whatsapp,'+5583988881111','wpp mantido'); eq(rv.email,null,'email esvaziado à mão fica vazio'); eq(rv.regioes_atuacao,['João Pessoa','Cabedelo'],'regioes manuais'); eq(rv.oportunidades_vinculadas,[],'não religa op ligada à mão');
  let [st5]=await call('PATCH','/api/oportunidades/op1',{corretor_vinculado_id:'nao-existe'}); eq(st5,400,'corretor inexistente');
  let [st6]=await call('PATCH','/api/oportunidades/op1',{titulo:'x'},'errada'); eq(st6,401,'sem senha');
  
  
});
