#!/usr/bin/env python3
"""Numera os arquivos do site nas páginas: css/… e js/… viram "arquivo?v=<hash do conteúdo>".

O GitHub Pages manda o navegador guardar cada arquivo por 10 minutos, cada um por conta própria.
Logo depois de uma publicação, o navegador pode juntar um arquivo novo com outro velho (ex.: o
JavaScript novo com o CSS antigo) e a página quebra. Com o número de versão no endereço, uma página
nova sempre pede os arquivos novos. Mesmo esquema do marketing-odisse (tools/versionar.py).

Rodar antes de cada commit que mexe em css/ ou js/:  python3 tools/versionar.py
"""
import hashlib
import pathlib
import re

RAIZ = pathlib.Path(__file__).resolve().parent.parent
PAGINAS = ['index.html', 'terrenos.html', 'revisao.html']


def h(p):
    return hashlib.sha1(p.read_bytes()).hexdigest()[:10]


def versiona(m):
    attr, caminho = m.group(1), m.group(2)
    p = RAIZ / caminho
    return f'{attr}="{caminho}?v={h(p)}"' if p.exists() else m.group(0)


for nome in PAGINAS:
    pag = RAIZ / nome
    s = pag.read_text(encoding='utf-8')
    novo = re.sub(r'(href|src)="((?:css|js)/[^"?]+)(?:\?v=[^"]*)?"', versiona, s)
    if novo != s:
        pag.write_text(novo, encoding='utf-8')
    print(f'{nome}: {len(re.findall(r"\?v=", novo))} arquivos numerados')
