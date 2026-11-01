"""Crops the raw screenshots to the part worth showing and trims empty space below the content."""
import os
import sys

sys.path.insert(0, r'C:\Users\ankit\AppData\Local\Temp\claude\C--Minor-Project-Smart-Industry-Management-System\f239d52d-5a61-489d-bcba-1ca7a27ed3ae\scratchpad\pylib')
from PIL import Image, ImageChops  # noqa: E402

SRC = r'C:\Minor Project\Smart Industry Management System\report\assets\screens'
DST = r'C:\Minor Project\Smart Industry Management System\report\assets\shots'
os.makedirs(DST, exist_ok=True)

# name -> (mode or explicit box)
PLAN = {
    '01-login': (340, 270, 1820, 1080), '02-dashboard-light': 'full', '03-dashboard-dark': 'full',
    '04-machines': 'main', '05-machine-risk': (1620, 340, 2150, 1500), '06-workers': (340, 84, 2160, 860), '07-attendance': 'main',
    '08-production': 'main', '09-order-form': (540, 100, 1620, 1250), '10-inventory': (340, 84, 2160, 1210), '11-purchasing': (340, 84, 2160, 790),
    '12-maintenance': 'main', '13-analytics': 'main', '14-analytics-more': 'main', '15-alerts': 'main', '16-handover': (340, 84, 2160, 880),
    '17-analyst': (340, 84, 2160, 1050), '18-worker-myday': 'main',
}

def trim_bottom(im, x0):
    w, h = im.size
    bg = im.getpixel((min(w - 1, x0 + 20), h - 6))
    strip = im.crop((x0, 0, w, h))
    diff = ImageChops.difference(strip, Image.new('RGB', strip.size, bg)).convert('L').point(lambda v: 255 if v > 14 else 0)
    box = diff.getbbox()
    return min(h, (box[3] if box else h) + 36)

for name, plan in PLAN.items():
    im = Image.open(os.path.join(SRC, name + '.jpg')).convert('RGB')
    w, h = im.size
    if plan == 'full':
        box = (0, 0, w, trim_bottom(im, 340))
    elif plan == 'main':
        box = (340, 84, w, trim_bottom(im, 340))
    else:
        box = plan
    im.crop(box).save(os.path.join(DST, name + '.jpg'), quality=90)
    print(name, box, (box[2] - box[0], box[3] - box[1]))
