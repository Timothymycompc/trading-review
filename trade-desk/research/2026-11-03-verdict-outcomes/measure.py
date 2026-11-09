import json,urllib.request,time,collections
rows=[l.split(' | ') for l in open('checks.txt').read().splitlines()[1:] if ' | ' in l]
rows=[dict(mint=r[0].strip(),verdict=r[1].strip(),at=r[2].strip(),price=float(r[3]) if r[3].strip() else None,liq=float(r[4]) if r[4].strip() else None,rug=r[5].strip()) for r in rows]
now={}
mints=[r['mint'] for r in rows]
for i in range(0,len(mints),50):
    u="https://lite-api.jup.ag/price/v3?ids="+",".join(mints[i:i+50])
    d=json.load(urllib.request.urlopen(urllib.request.Request(u,headers={'user-agent':'desk-measure'}),timeout=30))
    now.update(d); time.sleep(4)
g=collections.defaultdict(lambda: collections.Counter())
for r in rows:
    n=now.get(r['mint']); v=r['verdict']; c=g[v]; c['n']+=1
    if not r['price']: c['no_price_then']+=1; continue
    c['priced']+=1
    if not n or not n.get('usdPrice'): c['dead']+=1; c['gone']+=1; continue
    ch=n['usdPrice']/r['price']-1
    if ch<=-0.9: c['dead']+=1
    elif ch<=-0.5: c['down50']+=1
    elif ch>=0: c['up']+=1
    else: c['down0_50']+=1
for v,c in g.items():
    p=c['priced'] or 1
    print(v,"unpriced-now",c["gone"]);print(f"{v:8} coins {c['n']:3}  priced then {c['priced']:3}  dead(-90%+ or unpriced) {c['dead']:3} ({100*c['dead']/p:.0f}%)  -50..-90% {c['down50']:3} ({100*c['down50']/p:.0f}%)  -0..-50% {c['down0_50']:3}  up {c['up']:3} ({100*c['up']/p:.0f}%)")
