"""Execute a reviewed local Python script through the Cascadeur loopback MCP bridge."""
import argparse,json,urllib.request
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('script',type=Path);p.add_argument('--result',type=Path);args=p.parse_args()
payload={'jsonrpc':'2.0','id':1,'method':'tools/call','params':{'name':'run_script','arguments':{'code':args.script.read_text(encoding='utf-8-sig')}}}
req=urllib.request.Request('http://127.0.0.1:8765/mcp',data=json.dumps(payload).encode(),headers={'Content-Type':'application/json','Accept':'application/json, text/event-stream'})
with urllib.request.urlopen(req,timeout=55) as r:response=json.load(r)
if args.result:args.result.write_text(json.dumps(response,indent=2),encoding='utf-8')
if 'error' in response:raise RuntimeError(response['error'])
result=response.get('result',{})
failed=result.get('isError',False)
for c in result.get('content',[]):
 if c.get('type')=='text':
  try:
   value=json.loads(c['text']);print(json.dumps(value,indent=2));failed=failed or value.get('ok') is False
  except json.JSONDecodeError:print(c['text'])
if failed:raise SystemExit(1)
