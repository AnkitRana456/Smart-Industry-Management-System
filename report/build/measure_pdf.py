import pymupdf, sys
d = pymupdf.open(r'..\Smart_Industrial_Management_System_Final_Report.pdf')
out = []
for i, p in enumerate(d):
    if i == 0: continue
    b = 0
    for x0, y0, x1, y1, *_ in p.get_text('blocks'):
        if y0 < 738: b = max(b, y1)
    for im in p.get_image_info():
        b = max(b, im['bbox'][3])
    for dr in p.get_drawings():
        if dr['rect'].y1 < 738: b = max(b, dr['rect'].y1)
    out.append(f'{i+1}:{int(b)}')
print(' '.join(out))
