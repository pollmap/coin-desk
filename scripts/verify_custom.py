"""Independent Decimal references for configurable TA. No market network calls.
--write explicitly refreshes committed fixtures; default checks reproducibility.
"""
import argparse, decimal, json, pathlib
D=decimal.Decimal
decimal.getcontext().prec=45
ROOT=pathlib.Path(__file__).resolve().parents[1]
def mean(values):return sum(values,D(0))/len(values)
def ema(values,n):
    if len(values)<n:return []
    v=mean(values[:n]);out=[v];a=D(2)/D(n+1)
    for x in values[n:]:v=(D(1)-a)*v+a*x;out.append(v)
    return out
def rsi(values,n):
    diffs=[b-a for a,b in zip(values,values[1:])]
    gains=[max(x,D(0)) for x in diffs];losses=[max(-x,D(0)) for x in diffs]
    if len(diffs)<n:return []
    g=mean(gains[:n]);l=mean(losses[:n]);out=[]
    for i in range(n-1,len(diffs)):
        if i>=n:g=(g*(n-1)+gains[i])/n;l=(l*(n-1)+losses[i])/n
        out.append((D(50) if g==0 else D(100)) if l==0 else D(100)-D(100)/(D(1)+g/l))
    return out
def reference(values):
    expected={}
    for n in [5,21]:expected['ema'+str(n)]=ema(values,n)
    for n in [7,21]:expected['rsi'+str(n)]=rsi(values,n)
    middle=[];upper=[];lower=[]
    for i in range(13,len(values)):
        window=values[i-13:i+1];m=mean(window);sd=mean([(v-m)**2 for v in window]).sqrt();middle.append(m);upper.append(m+D('2.5')*sd);lower.append(m-D('2.5')*sd)
    expected.update(bbMiddle=middle,bbUpper=upper,bbLower=lower)
    fast=ema(values,12)[14:];slow=ema(values,26)
    line=[f-s for f,s in zip(fast,slow)];signal=ema(line,9)
    expected.update(macd=line,signal=signal,histogram=[v-s for v,s in zip(line[8:],signal)])
    custom_fast=ema(values,8)[13:];custom_slow=ema(values,21)
    custom_line=[f-s for f,s in zip(custom_fast,custom_slow)];custom_signal=ema(custom_line,5)
    expected.update(macdCustom=custom_line,signalCustom=custom_signal,histogramCustom=[v-s for v,s in zip(custom_line[4:],custom_signal)])
    return {k:[float(v) for v in seq] for k,seq in expected.items()}
def main():
    p=argparse.ArgumentParser();p.add_argument('--write',action='store_true');a=p.parse_args()
    scenarios={'mixed':[D(100)+D((i*37)%53)/10+D(i)/20 for i in range(100)],'small':[D('0.000002')+D((i*19)%31)/D('100000000') for i in range(100)],'flat':[D(12)]*60}
    data=[{'name':name,'values':[float(v) for v in values],'expected':reference(values)} for name,values in scenarios.items()]
    path=ROOT/'tests/fixtures/custom-reference.json'
    if a.write:path.write_text(json.dumps(data,separators=(',',':')),encoding='utf-8')
    else:assert json.loads(path.read_text(encoding='utf-8'))==data,'Custom indicator references changed'
    print('3 Decimal scenarios; configurable EMA, RSI, Bollinger and MACD references verified')
if __name__=='__main__':main()
