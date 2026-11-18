"""Deterministic RSI(14) five-timeframe strategies. CLOSED candles only.

All thresholds are configurable research hypotheses, not investment advice.
1M is a calendar month; unlike other bars, its duration is variable.
"""
from __future__ import annotations
from datetime import datetime, timezone

FRAMES=('15m','1h','4h','1d','1M')
DURATIONS={'15m':900_000,'1h':3_600_000,'4h':14_400_000,'1d':86_400_000}
MIN_CANDLES={'15m':100,'1h':100,'4h':100,'1d':100,'1M':30}
VERSION='RSI14-ADAPTIVE-v3.0'
STRATEGIES=('REVERSAL','MOMENTUM','BREAKOUT')
PRIORITY=('BREAKOUT','REVERSAL','MOMENTUM')


def iso_ms(t):return datetime.fromtimestamp(t/1000,timezone.utc).isoformat()

def period_start_ms(t,tf):
    """Start of the UTC Binance candle CONTAINING instant t (milliseconds)."""
    if tf=='1M':
        d=datetime.fromtimestamp(t/1000,timezone.utc)
        return int(datetime(d.year,d.month,1,tzinfo=timezone.utc).timestamp()*1000)
    if tf not in DURATIONS: raise ValueError('Unsupported interval')
    return (t//DURATIONS[tf])*DURATIONS[tf]

def last_expected_closed_ms(close_ms,tf):
    # 15m close 12:14:59.999, prior closed 1h must end 11:59:59.999.
    return period_start_ms(close_ms+1,tf)-1

def rsi_wilder(vals,n=14):
    out=[None]*len(vals)
    if len(vals)<=n:return out
    diffs=[float(vals[i])-float(vals[i-1]) for i in range(1,len(vals))]
    up=sum(max(0,d) for d in diffs[:n])/n
    down=sum(max(0,-d) for d in diffs[:n])/n
    def value(g,l):
        if l==0:return 100.0 if g>0 else 50.0
        return 100-100/(1+g/l)
    out[n]=value(up,down)
    for i in range(n+1,len(vals)):
        diff=diffs[i-1]
        up=(up*(n-1)+max(0,diff))/n
        down=(down*(n-1)+max(0,-diff))/n
        out[i]=value(up,down)
    return out

def indicators(candles,tf=None):
    minimum=MIN_CANDLES.get(tf,30)
    if len(candles)<minimum:raise ValueError(f'{tf or "RSI"}: cần ít nhất {minimum} nến đã đóng.')
    rsi=rsi_wilder([x['close'] for x in candles])
    return [{
        'time':int(c['open_ms'])//1000,'open_ms':int(c['open_ms']), 'close_ms':int(c['close_ms']),
        'open':float(c['open']),'high':float(c['high']), 'low':float(c['low']),
        'close':float(c['close']),'volume':float(c['volume']), 'rsi':rsi[i],
    } for i,c in enumerate(candles)]

def context_class(r):
    return 'BULL' if r>=55 else 'BEAR' if r<45 else 'NEUTRAL'

def evaluate(series, strategy, side):
    if strategy not in STRATEGIES or side not in ('LONG','SHORT'):
        raise ValueError('Invalid strategy or side')
    r={tf:series[tf][-1]['rsi'] for tf in FRAMES}
    p={tf:series[tf][-2]['rsi'] for tf in FRAMES}
    if any(x is None for x in list(r.values())+list(p.values())):
        raise ValueError('RSI insufficient warmup')
    bull=side=='LONG'; d='tăng' if bull else 'giảm'
    checks=[]
    def rule(tf,name,ok,detail):checks.append({'tf':tf,'name':name,'passed':bool(ok),'detail':detail})
    rev=strategy=='REVERSAL';momentum=strategy=='MOMENTUM'
    if rev:
        rule('1d','Bối cảnh ngày',r['1d']>=25 if bull else r['1d']<=75,f"RSI 1D {r['1d']:.2f}; {'≥25' if bull else '≤75'}")
        lo,hi=(30,55) if bull else (45,70)
        rule('4h','RSI nền',lo<=r['4h']<=hi,f"RSI 4H {r['4h']:.2f}; yêu cầu {lo}–{hi}")
        lo,hi=(30,55) if bull else (45,70)
        rule('1h','RSI xác nhận',lo<=r['1h']<=hi and (r['1h']>p['1h'] if bull else r['1h']<p['1h']),f"RSI 1H {p['1h']:.2f} → {r['1h']:.2f}; vùng {lo}–{hi}, đang {d}")
        trig=p['15m']<30<=r['15m']<=40 if bull else p['15m']>70>=r['15m']>=60
        detail='cắt lên 30; RSI mới ≤40' if bull else 'cắt xuống 70; RSI mới ≥60'
    elif momentum:
        rule('1d','Bối cảnh ngày',r['1d']>=40 if bull else r['1d']<=60,f"RSI 1D {r['1d']:.2f}; {'≥40' if bull else '≤60'}")
        lo,hi=(52,70) if bull else (30,48)
        rule('4h','RSI nền',lo<=r['4h']<=hi,f"RSI 4H {r['4h']:.2f}; vùng {lo}–{hi}")
        lo,hi=(50,68) if bull else (32,50)
        rule('1h','RSI xác nhận',lo<=r['1h']<=hi and (r['1h']>p['1h'] if bull else r['1h']<p['1h']),f"RSI 1H {p['1h']:.2f} → {r['1h']:.2f}; vùng {lo}–{hi}, đang {d}")
        trig=p['15m']<50<=r['15m']<=65 if bull else p['15m']>50>=r['15m']>=35
        detail='cắt lên 50; RSI mới ≤65' if bull else 'cắt xuống 50; RSI mới ≥35'
    else:
        rule('1d','Bối cảnh ngày',r['1d']>=50 if bull else r['1d']<=50,f"RSI 1D {r['1d']:.2f}; {'≥50' if bull else '≤50'}")
        rule('4h','RSI nền',r['4h']>=60 if bull else r['4h']<=40,f"RSI 4H {r['4h']:.2f}; {'≥60' if bull else '≤40'}")
        rule('1h','RSI xác nhận',(r['1h']>=60 and r['1h']>p['1h']) if bull else (r['1h']<=40 and r['1h']<p['1h']),f"RSI 1H {p['1h']:.2f} → {r['1h']:.2f}; {'≥60 và tăng' if bull else '≤40 và giảm'}")
        trig=p['15m']<70<=r['15m']<=85 if bull else p['15m']>30>=r['15m']>=15
        detail='cắt lên 70; RSI mới ≤85' if bull else 'cắt xuống 30; RSI mới ≥15'
    rule('15m','Kích hoạt 15M',trig,f"RSI 15M {p['15m']:.2f} → {r['15m']:.2f}; {detail}")
    favor='BULL' if bull else 'BEAR';oppose='BEAR' if bull else 'BULL'
    env={tf:context_class(r[tf]) for tf in ('1d','1M')}
    supporters=sum(v==favor for v in env.values())
    opponents=sum(v==oppose for v in env.values())
    blocked=opponents==2 and not rev
    budget=.5 if supporters==2 else .15 if opponents==2 else .3
    rule('1M','Adaptive Risk',not blocked,f"RSI tháng {r['1M']:.2f} ({env['1M']}), ngày {r['1d']:.2f} ({env['1d']}); "+('chặn Momentum/Breakout ngược cả hai khung' if blocked else f'rủi ro đề xuất {budget:.2f}% vốn'))
    snapshots={tf:{'open_ms':series[tf][-1]['open_ms'],'close_ms':series[tf][-1]['close_ms'],
                   'close':series[tf][-1]['close'],'rsi':r[tf],'prev_rsi':p[tf]}
               for tf in FRAMES}
    passed=sum(x['passed'] for x in checks)
    allowed=all(x['passed'] for x in checks)
    reason=(f'{strategy} {side}: {passed}/{len(checks)} điều kiện. '
            +'; '.join(f'{x["tf"]} {x["name"]}: '+('ĐẠT' if x['passed'] else 'KHÔNG ĐẠT')+f' [{x["detail"]}]' for x in checks))
    return {'strategy':strategy,'side':side,'allowed':allowed,'passed':passed,'total':len(checks),
            'checks':checks,'snapshots':snapshots,'risk_pct':budget,'cross_open_ms':series['15m'][-1]['open_ms'] if trig else None,
            'reason':reason,'context':env}

def arbitrate(candidates):
    """One winner per 15M candle. Conflicting directions always wait."""
    if len({x['side'] for x in candidates})>1:return None,True
    return (sorted(candidates,key=lambda x:PRIORITY.index(x['strategy']))[0] if candidates else None),False


def analyze(all_closed, enabled=None):
    enabled=set(enabled or STRATEGIES)
    if enabled-set(STRATEGIES):raise ValueError('Unknown RSI strategy')
    series={tf:indicators(all_closed[tf],tf) for tf in FRAMES}
    evaluations={st:{side:evaluate(series,st,side) for side in ('LONG','SHORT')} for st in STRATEGIES}
    candidates=[evaluations[st][side] for st in STRATEGIES for side in ('LONG','SHORT')
                if st in enabled and evaluations[st][side]['allowed']]
    winner,conflict=arbitrate(candidates)
    return {'version':VERSION,'series':series,'evaluations':evaluations,
            'candidates':candidates,'winner':winner,'conflict':conflict,
            'rsi_summary':{tf:{'rsi':series[tf][-1]['rsi'],'prev_rsi':series[tf][-2]['rsi'],
                              'close_ms':series[tf][-1]['close_ms'],
                              'context':context_class(series[tf][-1]['rsi'])} for tf in FRAMES}}
