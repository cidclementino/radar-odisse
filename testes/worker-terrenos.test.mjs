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
// cloudflare:workers só existe no Worker: no teste, um WorkerEntrypoint mínimo (guarda ctx e env)
const stubCloudflare = { name: 'cloudflare', setup(b) {
  b.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: 'cf', namespace: 'stub' }));
  b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export class WorkerEntrypoint { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }' }));
} };
await build({ entryPoints: [join(raiz, 'worker/index.js')], bundle: true, format: 'esm', platform: 'neutral', outfile: saida, logLevel: 'warning', plugins: [stubCloudflare] });
const { default: w, Universo } = await import(pathToFileURL(saida).href);

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
const env = { COLLECT_SECRET: 's', RADAR_SENHA: 'p', CONCURSOS: kv(), REVISAO: kv(), OPORTUNIDADES: kv(), CORRETORES: kv(), LICITACOES: kv() };
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
  // categoria: a coleta grava 'terreno' por padrão e o painel pode trocar para imóvel
  eq(op1.categoria,'terreno','categoria padrão');
  await call('POST','/api/collect-terrenos',{oportunidades:[{id:'op2',titulo:'Prédio comercial à venda',local:'RM Recife',categoria:'imovel',status_interno:'monitorando',nivel_maturidade:2}],corretoresCandidatos:[]},'s');
  eq((await env.OPORTUNIDADES.get('op2','json')).categoria,'imovel','imóvel da coleta');
  let [st7,r7]=await call('PATCH','/api/oportunidades/op1',{categoria:'imovel'}); eq(st7,200,'troca categoria'); eq(r7.oportunidade.categoria,'imovel','categoria');
  let [st8]=await call('PATCH','/api/oportunidades/op1',{categoria:'casa'}); eq(st8,400,'categoria inválida');
});

test('licitações: coleta mantém a decisão do painel e o resto vem do PNCP', async () => {
  const call=async(m,path,body,tok='p')=>{const r=await w.fetch(new Request('https://x'+path,{method:m,headers:{Authorization:'Bearer '+tok,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined}),env,ctx);return [r.status,await r.json()]};
  const lic={id:'pncp-1-1-000001-2026',objeto:'Elaboração de projeto arquitetônico',encerramento:'2026-12-01T09:00:00',valor_estimado:100000,status_interno:'monitorando',coletado_em:'2026-11-18T00:00:00Z'};
  let [st,r]=await call('POST','/api/collect-licitacoes',{licitacoes:[lic]},'p'); eq(st,401,'coleta exige o segredo da coleta');
  [st,r]=await call('POST','/api/collect-licitacoes',{licitacoes:[lic,{id:'outra',objeto:'x'}]},'s'); eq(st,200,'coleta'); eq([r.recebidas,r.novas],[1,1],'só ids do PNCP');
  [st,r]=await call('PATCH','/api/licitacoes/'+lic.id,{status_interno:'participando',observacoes:'  visitar o terreno  '}); eq(st,200,'patch'); eq(r.observacoes,'visitar o terreno','obs');
  [st]=await call('PATCH','/api/licitacoes/'+lic.id,{status_interno:'ganha'}); eq(st,400,'situação inválida');
  [st,r]=await call('POST','/api/collect-licitacoes',{licitacoes:[{...lic,coletado_em:'2026-11-20T00:00:00Z'}]},'s'); eq([r.novas,r.alteradas,r.iguais],[0,0,1],'igual não regrava');
  [st,r]=await call('POST','/api/collect-licitacoes',{licitacoes:[{...lic,encerramento:'2026-12-10T09:00:00',coletado_em:'2026-11-25T00:00:00Z'}]},'s'); eq([r.novas,r.alteradas],[0,1],'retificação regrava');
  const l=await env.LICITACOES.get(lic.id,'json');
  eq(l.status_interno,'participando','situação mantida'); eq(l.observacoes,'visitar o terreno','obs mantida'); eq(l.coletado_em,'2026-11-18T00:00:00Z','primeira coleta'); eq(l.encerramento,'2026-12-10T09:00:00','prazo retificado vem do PNCP');
  [st,r]=await call('GET','/api/licitacoes'); eq(st,200,'lista'); eq(r.length,1,'um item');
  // contratada: entra com outro id, liga a aberta e tem situações próprias
  const ct={id:'pncpc-9-2-000003-2026',fase:'contratada',licitacao_id:lic.id,objeto:'Construção da creche',vencedor:{cnpj:'1',nome:'Construtora X'},status_interno:'monitorando'};
  [st,r]=await call('POST','/api/collect-licitacoes',{licitacoes:[ct]},'s'); eq(r.novas,1,'contratada nova');
  eq((await env.LICITACOES.get(lic.id,'json')).contrato_id,ct.id,'aberta aponta para o contrato');
  [st]=await call('PATCH','/api/licitacoes/'+ct.id,{status_interno:'participando'}); eq(st,400,'situação de aberta não vale');
  [st,r]=await call('PATCH','/api/licitacoes/'+ct.id,{status_interno:'contatado'}); eq(st,200,'contatado'); eq(r.status_interno,'contatado','ok');
  // lote grande demais
  [st]=await call('POST','/api/collect-licitacoes',{licitacoes:Array.from({length:51},(_,i)=>({id:'pncp-x'+i}))},'s'); eq(st,413,'lote máximo');
  // cópia da lista sem o texto complementar das contratadas
  await call('POST','/api/collect-licitacoes',{licitacoes:[{id:'pncpc-z',fase:'contratada',fonte:'pncp.gov.br',informacao_complementar:'x'.repeat(900),assinatura:'2025-01-10',status_interno:'monitorando'}]},'s');
  const copia=JSON.parse(env.LICITACOES.m.get('_lista'));
  eq('informacao_complementar' in copia.itens['pncpc-z'],false,'cópia enxuta');
  eq(JSON.parse(env.LICITACOES.m.get('pncpc-z')).informacao_complementar.length,900,'registro completo');
  // limpeza: contratada velha sai e deixa lápide; a em contato fica; a coleta não traz a apagada de volta
  [st,r]=await call('POST','/api/manutencao/limpar-licitacoes',{},'s'); eq(r.apagadas,1,'uma apagada');
  eq(env.LICITACOES.m.has('pncpc-z'),false,'apagada'); eq(env.LICITACOES.m.has('_ignorado:pncpc-z'),true,'lápide');
  eq(env.LICITACOES.m.has(ct.id),true,'em contato fica');
  [st,r]=await call('POST','/api/collect-licitacoes',{licitacoes:[{id:'pncpc-z',fase:'contratada',fonte:'pncp.gov.br'}]},'s'); eq(r.ignoradas,1,'não volta');
  eq(JSON.parse(env.LICITACOES.m.get('_lista')).itens['pncpc-z'],undefined,'fora da lista');
});

test('Universo.novidades conta o que entrou no dia (Brasília), com as regras das páginas', async () => {
  const e = { CONCURSOS: kv(), OPORTUNIDADES: kv(), LICITACOES: kv() };
  const p = (k, id, x) => e[k].m.set(id, JSON.stringify({ id, ...x }));
  // 19/11 em Brasília: de 03:00Z do dia 19 até 02:59Z do dia 20
  p('CONCURSOS', 'c1', { coletado_em: '2026-11-19T10:00:00Z' });
  p('CONCURSOS', 'c2', { coletado_em: '2026-11-20T02:30:00Z' });            // 23h30 do dia 19
  p('CONCURSOS', 'c3', { coletado_em: '2026-11-19T02:30:00Z' });            // 23h30 do dia 18
  p('CONCURSOS', 'c4', { coletado_em: '2026-11-19T10:00:00Z', status_interno: 'descartado' });
  p('OPORTUNIDADES', 'o1', { coletado_em: '2026-11-19T12:00:00Z', status_interno: 'monitorando' });
  p('OPORTUNIDADES', 'o2', { coletado_em: '2026-11-19T12:00:00Z', status_interno: 'no_funil' });
  p('LICITACOES', 'l1', { coletado_em: '2026-11-19T12:00:00Z', fase: 'aberta' });
  p('LICITACOES', 'l2', { coletado_em: '2026-11-19T12:00:00Z', fase: 'contratada', tipo_objeto: 'obra' });
  p('LICITACOES', 'l3', { coletado_em: '2026-11-19T12:00:00Z', fase: 'contratada', tipo_objeto: 'projeto' }); // mapa de preços
  p('LICITACOES', 'l4', { coletado_em: '2026-11-18T12:00:00Z', fase: 'aberta' });
  const u = new Universo({ waitUntil() {} }, e);
  eq(await u.novidades('2026-11-19'), { dia: '2026-11-19', concursos: 2, terrenos: 1, licitacoes: 1, contratos: 1 }, 'contagem');
});
