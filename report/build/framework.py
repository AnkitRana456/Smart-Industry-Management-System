"""Block constructors and the HTML page renderer for the report.

The report is a list of fixed-size pages; each page is a list of blocks. Page numbers in the table of
contents, list of figures and list of tables are derived from where each block actually sits, so they
cannot drift from the finished document.
"""
import html
import re

ROOT = r'C:\Minor Project\Smart Industry Management System\report'
FRONT_LABELS = ['', 'i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii']  # index 0 is the cover


def H1(title, toc=True, cls=''):
    return {'t': 'h1', 'text': title, 'toc': toc, 'cls': cls}


def H2(title, toc=True):
    return {'t': 'h2', 'text': title, 'toc': toc}


def H3(title, toc=False):
    return {'t': 'h3', 'text': title, 'toc': toc}


def P(text, cls=''):
    return {'t': 'p', 'text': text, 'cls': cls}


def UL(items):
    return {'t': 'ul', 'items': items}


def OL(items):
    return {'t': 'ol', 'items': items}


def TABLE(caption, headers, rows, widths=None, size=10, align=None):
    return {'t': 'table', 'caption': caption, 'headers': headers, 'rows': rows, 'widths': widths, 'size': size, 'align': align}


def FIG(img, caption, width=6.6, kind='fig', note=None):
    return {'t': 'fig', 'img': img, 'caption': caption, 'width': width, 'kind': kind, 'note': note}


def FIGTEXT(img, caption, text_blocks, width=3.1):
    """An image on the left with explanatory paragraphs on the right."""
    return {'t': 'figtext', 'img': img, 'caption': caption, 'blocks': text_blocks, 'width': width}


def SP(pt=6):
    return {'t': 'sp', 'pt': pt}


def RAW(html_text):
    return {'t': 'raw', 'html': html_text}


_BOLD = re.compile(r'\*\*(.+?)\*\*')
_ITAL = re.compile(r'(?<![\w*])_(.+?)_(?![\w*])')
_CODE = re.compile(r'`(.+?)`')


def inline(text):
    """Escapes text and applies **bold**, _italic_ and `code`."""
    s = html.escape(text, quote=False)
    s = _CODE.sub(r'<code>\1</code>', s)
    s = _BOLD.sub(r'<b>\1</b>', s)
    s = _ITAL.sub(r'<i>\1</i>', s)
    return s


def plain(text):
    return _CODE.sub(r'\1', _BOLD.sub(r'\1', _ITAL.sub(r'\1', text)))


def img_uri(path):
    return 'file:///' + path.replace('\\', '/')


CSS = """
@page { size: 8.5in 11in; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; }
body { font-family: 'Times New Roman', Times, serif; font-size: 12pt; color: #000; }
.page { width: 8.5in; height: 11in; position: relative; overflow: hidden; page-break-after: always; break-after: page; background: #fff; }
.page:last-child { page-break-after: auto; break-after: auto; }
.pbody { position: absolute; left: 42.6pt; right: 25pt; top: 29pt; height: 700pt; overflow: hidden; display: flex; flex-direction: column; }
.pbody > * { flex: none; }
.pbody > :last-child { margin-bottom: 0 !important; }
#chk { display: none; }
.foot-l { position: absolute; left: 42.6pt; top: 741pt; font-size: 10pt; }
.foot-r { position: absolute; right: 25pt; top: 752pt; font-size: 10.5pt; font-family: Arial, Helvetica, sans-serif; }
h1 { font-size: 16pt; font-weight: bold; margin: 0 0 6pt; line-height: 22pt; text-transform: uppercase; text-align: center; }
h1.center { text-align: center; }
h2 { font-size: 14pt; font-weight: bold; margin: 7pt 0 1pt; line-height: 20.7pt; }
h3 { font-size: 12pt; font-weight: bold; margin: 5pt 0 0; line-height: 20.7pt; }
p { margin: 0 0 3.4pt; text-align: justify; line-height: 20.7pt; }
p.tight { line-height: 17pt; }
ul, ol { margin: 0 0 3.4pt; padding-left: 36pt; }
li { text-align: justify; line-height: 20.7pt; padding-left: 0; }
ul.tight li, ol.tight li { line-height: 17pt; }
code { font-family: Consolas, 'Courier New', monospace; font-size: 10.5pt; }
table.t { border-collapse: collapse; width: 100%; margin: 2pt 0 8pt; font-size: 10pt; table-layout: fixed; }
table.t th, table.t td { border: 0.8pt solid #666; padding: 2.5pt 5pt; vertical-align: top; text-align: left; line-height: 12.8pt; overflow-wrap: anywhere; }
table.t th { font-weight: bold; }
.cap { font-size: 11pt; font-weight: bold; text-align: center; margin: 3pt 0 8pt; line-height: 14pt; }
.cap.tcap { margin: 6pt 0 3pt; }
.fig { text-align: center; margin: 4pt 0 0; }
.fig img { display: block; margin: 0 auto; }
.note { font-size: 10.5pt; text-align: center; margin: -5pt 0 8pt; line-height: 13pt; }
.shot img { border: 0.6pt solid #888; }
.figtext { display: flex; gap: 14pt; align-items: flex-start; margin-top: 4pt; }
.figtext .l { flex: none; }
.figtext .r { flex: 1; }
.cover { position: absolute; inset: 0; text-align: center; }
.toc-row { display: flex; line-height: 11pt; font-size: 10.5pt; }
.toc-row .a { flex: 1; }
.toc-row.l1 { font-weight: normal; }
.toc-row.l2 { padding-left: 13pt; }
.sig { display: flex; justify-content: space-between; margin-top: 56pt; font-size: 12pt; line-height: 20pt; }
table.lst { border-collapse: collapse; width: 100%; margin: 8pt 0 0; font-size: 10.5pt; }
table.lst th, table.lst td { border: 0.8pt solid #666; padding: 2pt 5pt; text-align: center; line-height: 12.6pt; }
table.lst td.ttl { text-align: center; }
.ref { margin: 0 0 9pt; padding-left: 30pt; text-indent: -30pt; text-align: justify; line-height: 20.7pt; font-size: 12pt; }
"""


def render_block(b, ctx):
    t = b['t']
    if t == 'h1':
        cls_attr = f' class="{b["cls"]}"' if b.get('cls') else ''
        return f'<h1{cls_attr}>{inline(b["text"])}</h1>'
    if t == 'h2':
        return f'<h2>{inline(b["text"])}</h2>'
    if t == 'h3':
        return f'<h3>{inline(b["text"])}</h3>'
    if t == 'p':
        return f'<p class="{b["cls"]}">{inline(b["text"])}</p>'
    if t in ('ul', 'ol'):
        cls = ' class="tight"' if False else ''
        return f'<{t}{cls}>' + ''.join(f'<li>{inline(i)}</li>' for i in b['items']) + f'</{t}>'
    if t == 'sp':
        return f'<div style="height:{b["pt"]}pt"></div>'
    if t == 'raw':
        return b['html']
    if t == 'table':
        widths = b['widths']
        cg = '<colgroup>' + ''.join(f'<col style="width:{w}%">' for w in widths) + '</colgroup>' if widths else ''
        head = '<tr>' + ''.join(f'<th>{inline(h)}</th>' for h in b['headers']) + '</tr>'
        body = ''.join('<tr>' + ''.join(f'<td>{inline(str(c))}</td>' for c in r) + '</tr>' for r in b['rows'])
        size = f'font-size:{b["size"]}pt' if b['size'] != 10 else ''
        return f'<div class="cap tcap">{inline(b["caption"])}</div><table class="t" style="{size}">{cg}<thead>{head}</thead><tbody>{body}</tbody></table>'
    if t == 'fig':
        cls = 'fig shot' if b['kind'] == 'shot' else 'fig'
        note = f'<div class="note">{inline(b["note"])}</div>' if b.get('note') else ''
        return f'<div class="{cls}"><img src="{img_uri(b["img"])}" style="width:{b["width"]}in"></div><div class="cap">{inline(b["caption"])}</div>{note}'
    if t == 'figtext':
        inner = ''.join(render_block(x, ctx) for x in b['blocks'])
        return (f'<div class="figtext"><div class="l" style="width:{b["width"]}in"><div class="fig shot"><img src="{img_uri(b["img"])}" style="width:{b["width"]}in"></div>'
                f'<div class="cap">{inline(b["caption"])}</div></div><div class="r">{inner}</div></div>')
    raise ValueError(t)


def label_for(index):
    return FRONT_LABELS[index] if index < len(FRONT_LABELS) else str(index - len(FRONT_LABELS) + 1)
