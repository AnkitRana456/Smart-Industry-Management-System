"""Assembles the report pages, checks fit, prints the PDF."""
import html
import json
import re
import shutil
import subprocess
import sys

sys.path.insert(0, __import__('os').path.dirname(__file__))
from framework import CSS, ROOT, H1, P, RAW, SP, inline, label_for, plain, render_block
import content_front as F
from content_ch3 import chapter3
from content_ch4 import chapter4
from content_ch5 import chapter5
from content_ch678 import bibliography, chapter6, chapter7, chapter8

CHROME = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
HTML = ROOT + r'\build\report.html'
PDF = ROOT + r'\Smart_Industrial_Management_System_Final_Report.pdf'
DEPT = 'Computer Science & Technology'

body_pages = F.chapter1 + F.chapter2 + chapter3 + chapter4 + chapter5 + chapter6 + chapter7 + chapter8 + bibliography
FRONT = 8  # cover + 7 numbered pages


def collect():
    toc, lof, lot = [], [], []
    for i, page in enumerate(body_pages):
        lab = str(i + 1)
        for b in page:
            t = b['t']
            if t in ('h1', 'h2') and b['toc']:
                toc.append((t, b['text'], lab))
            elif t in ('fig', 'figtext') and b['caption'].startswith('Figure'):
                lof.append(b['caption'] + '|' + lab)
            elif t == 'table':
                lot.append(b['caption'] + '|' + lab)
            if t == 'figtext':
                for x in b['blocks']:
                    if x['t'] == 'fig':
                        lof.append(x['caption'] + '|' + lab)
    return toc, lof, lot


def lst_page(title, rows, first, noun):
    body = ''.join(
        f'<tr><td style="width:15%">{html.escape(c.split(":")[0].replace(noun + " ", ""))}</td>'
        f'<td style="text-align:left">{html.escape(c.split(":", 1)[1].strip())}</td><td style="width:12%">{p}</td></tr>'
        for c, p in (r.split('|') for r in rows))
    tbl = (f'<table class="lst"><thead><tr><th>{noun} No.</th><th>Title</th><th>Page No.</th></tr></thead>'
           f'<tbody>{body}</tbody></table>')
    return [H1(title, toc=False, cls='center'), RAW(tbl)]


def toc_page(toc):
    rows = []
    for t, text, lab in toc:
        cls = 'l1' if t == 'h1' else 'l2'
        b = ' style="font-weight:bold"' if t == 'h1' else ''
        rows.append(f'<div class="toc-row {cls}"{b}><span class="a">{inline(text)}</span><span>{lab}</span></div>')
    return [H1('Table of Contents', toc=False, cls='center'), SP(4), RAW(''.join(rows))]


toc, lof, lot = collect()
toc.append(('h1', 'Bibliography', str(len(body_pages)))) if not any(x[1] == 'Bibliography' for x in toc) else None
front = [
    [F.cover],
    F.declaration, F.certificate, F.acknowledgement, F.abstract,
    toc_page(toc),
    lst_page('List of Figures', lof, 0, 'Figure'),
    lst_page('List of Tables', lot, 0, 'Table'),
]
assert len(front) == FRONT
pages = front + body_pages


def render_page(i, blocks):
    if i == 0:
        return '<div class="page">' + ''.join(render_block(b, {}) for b in blocks) + '</div>'
    inner = ''.join(render_block(b, {}) for b in blocks)
    return (f'<div class="page"><div class="pbody">{inner}</div>'
            f'<div class="foot-l">{html.escape(DEPT)}</div><div class="foot-r">{label_for(i)}</div></div>')


CHECK = """
<script>
window.addEventListener('load', () => setTimeout(() => {
  const out = [];
  document.querySelectorAll('.pbody').forEach((pb, i) => {
    const top = pb.getBoundingClientRect().top;
    let used = 0;
    pb.childNodes.forEach(c => { if (c.getBoundingClientRect) used = Math.max(used, c.getBoundingClientRect().bottom - top); });
    const bad = [...pb.querySelectorAll('img')].filter(im => !im.complete || !im.naturalWidth).length;
    out.push({page: i + 2, used: Math.round(used*0.75), over: pb.scrollHeight > pb.clientHeight + 1, badImg: bad});
  });
  const pre = document.createElement('pre'); pre.id = 'chk'; pre.textContent = JSON.stringify(out); document.body.appendChild(pre);
}, 600));
</script>
"""


def main():
    doc = ('<!doctype html><html><head><meta charset="utf-8"><title>SIMS Report</title><style>' + CSS +
           '</style></head><body>' + ''.join(render_page(i, p) for i, p in enumerate(pages)) + CHECK + '</body></html>')
    open(HTML, 'w', encoding='utf-8').write(doc)
    r = subprocess.run([CHROME, '--headless=new', '--disable-gpu', '--allow-file-access-from-files',
                        '--virtual-time-budget=8000', '--dump-dom', 'file:///' + HTML.replace('\\', '/')],
                       capture_output=True, text=True, encoding='utf-8')
    m = re.search(r'<pre id="chk">(.*?)</pre>', r.stdout, re.S)
    res = json.loads(html.unescape(m.group(1)))
    print('pages total:', len(pages))
    overflows = 0
    for x in res:
        flag = 'OVERFLOW' if x['over'] else ''
        if x['over']:
            overflows += 1
        if x['badImg']:
            flag += ' BADIMG'
        print(f"page {x['page']:>2} (label {label_for(x['page'] - 1):>4}) used {x['used']:>3}/700 {flag}")
    print(f'Total overflows: {overflows}')
    if '--pdf' in sys.argv:
        subprocess.run([CHROME, '--headless=new', '--disable-gpu', '--allow-file-access-from-files', '--no-pdf-header-footer',
                        '--virtual-time-budget=8000', f'--print-to-pdf={PDF}', 'file:///' + HTML.replace('\\', '/')],
                       capture_output=True)
        print('PDF written to:', PDF)
        
        # Also copy to project roots
        dest1 = r'C:\Minor Project\Smart Industry Management System\Smart_Industrial_Management_System_Final_Report.pdf'
        dest2 = r'C:\Backend_Projects\Minor Project Rport\Smart_Industrial_Management_System_Final_Report.pdf'
        try:
            shutil.copy2(PDF, dest1)
            print('Copied to:', dest1)
        except Exception as e:
            print('Copy to dest1 failed:', e)
        try:
            shutil.copy2(PDF, dest2)
            print('Copied to:', dest2)
        except Exception as e:
            print('Copy to dest2 failed:', e)


if __name__ == '__main__':
    main()
