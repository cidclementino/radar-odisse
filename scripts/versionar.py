#!/usr/bin/env python3
"""Atualiza os ?v=<hash> dos CSS/JS nas páginas (e no carregamento sob demanda em js/comum.js).

Rode da raiz do repositório depois de mudar qualquer arquivo em css/ ou js/:  python3 scripts/versionar.py
O hash muda só quando o arquivo muda, então o navegador baixa de novo apenas o que mudou.
"""
import hashlib, pathlib, re

raiz = pathlib.Path(__file__).resolve().parent.parent
h = lambda caminho: hashlib.sha1((raiz / caminho).read_bytes()).hexdigest()[:10]
troca = lambda texto: re.sub(r'((?:css|js)/[\w.-]+\.(?:css|js))\?v=[0-9a-f]+', lambda m: f'{m.group(1)}?v={h(m.group(1))}', texto)

# comum.js primeiro: ele cita extrair-site.js e site-oficial.js, e o hash dele depende disso
for alvo in ['js/comum.js', *sorted(p.name for p in raiz.glob('*.html'))]:
    arq = raiz / alvo
    antes = arq.read_text(encoding='utf-8')
    depois = troca(antes)
    if depois != antes:
        arq.write_text(depois, encoding='utf-8')
        print('atualizado:', alvo)
