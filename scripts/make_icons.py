from PIL import Image, ImageDraw, ImageFilter
import math, os

S = 1024
img = Image.new('RGBA', (S,S), (0,0,0,0))
# background gradient (diagonal)
top = (255, 122, 110)      # coral
bottom = (120, 92, 255)    # violet
for y in range(S):
    for_x = y / (S-1)
    # vertical base + horizontal shift
    pass
# faster: draw vertical gradient then overlay horizontal gradient
bg = Image.new('RGBA',(S,S))
d = ImageDraw.Draw(bg)
for y in range(S):
    t = y/(S-1)
    # ease
    tt = t*t*(3-2*t)
    r = int(top[0]*(1-tt)+bottom[0]*tt)
    g = int(top[1]*(1-tt)+bottom[1]*tt)
    b = int(top[2]*(1-tt)+bottom[2]*tt)
    d.line([(0,y),(S,y)], fill=(r,g,b,255))
# radial glows
glow = Image.new('RGBA',(S,S),(0,0,0,0))
gd = ImageDraw.Draw(glow)
gd.ellipse([-S*0.25, -S*0.2, S*0.9, S*0.95], fill=(255, 210, 120, 90))
glow = glow.filter(ImageFilter.GaussianBlur(S*0.12))
bg = Image.alpha_composite(bg, glow)
glow2 = Image.new('RGBA',(S,S),(0,0,0,0))
gd2 = ImageDraw.Draw(glow2)
gd2.ellipse([S*0.35, S*0.35, S*1.25, S*1.25], fill=(90, 220, 255, 80))
glow2 = glow2.filter(ImageFilter.GaussianBlur(S*0.14))
bg = Image.alpha_composite(bg, glow2)
d = ImageDraw.Draw(bg)

# white chat bubble
bw, bh = 560, 430
x0, y0 = (S-bw)//2, S*0.30
r = 130
d.rounded_rectangle([x0,y0,x0+bw,y0+bh], radius=r, fill=(255,255,255,245))
# tail
d.polygon([(x0+120, y0+bh-10),(x0+120, y0+bh+120),(x0+330, y0+bh-10)], fill=(255,255,255,245))
# dots
cy = y0+bh/2
for i,dx in enumerate([-105,0,105]):
    rr = 42
    d.ellipse([x0+bw/2+dx-rr, cy-rr, x0+bw/2+dx+rr, cy+rr], fill=(233, 74, 120, 255) if i==1 else (120, 92, 255, 255))
# sparkle top right
def star(cx, cy, R, r, fill):
    pts=[]
    for i in range(8):
        ang = -math.pi/2 + i*math.pi/4
        rad = R if i%2==0 else r
        pts.append((cx+rad*math.cos(ang), cy+rad*math.sin(ang)))
    d.polygon(pts, fill=fill)
star(S*0.79, S*0.22, 80, 26, (255,255,255,235))
star(S*0.22, S*0.72, 44, 15, (255,255,255,200))
# clip rounded square
mask = Image.new('L',(S,S),0)
md = ImageDraw.Draw(mask)
md.rounded_rectangle([0,0,S,S], radius=int(S*0.225), fill=255)
out = Image.new('RGBA',(S,S),(0,0,0,0))
out.paste(bg,(0,0),mask)
os.makedirs('monet-chat/assets', exist_ok=True)
for size,name in [(512,'icon-512.png'),(192,'icon-192.png'),(180,'apple-touch-icon.png'),(32,'favicon-32.png'),(16,'favicon-16.png')]:
    out.resize((size,size), Image.LANCZOS).save('monet-chat/assets/'+name)
# maskable: safe area 80%, background full square no rounding
maskable = Image.new('RGBA',(S,S),(0,0,0,0))
maskable.paste(bg,(0,0))
maskable.resize((512,512), Image.LANCZOS).save('monet-chat/assets/icon-maskable-512.png')
print('icons ok')
