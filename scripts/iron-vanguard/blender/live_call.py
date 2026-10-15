"""Call the installed Blender MCP extension's null-delimited execute protocol."""
import argparse,json,socket
from pathlib import Path
ap=argparse.ArgumentParser();ap.add_argument('script',type=Path);ap.add_argument('--result',type=Path);args=ap.parse_args()
request={'type':'execute','code':args.script.read_text(encoding='utf-8-sig'),'strict_json':True}
with socket.create_connection(('127.0.0.1',9876),timeout=5) as sock:
 sock.settimeout(55);sock.sendall(json.dumps(request).encode()+b'\0');data=b''
 while b'\0' not in data:
  chunk=sock.recv(65536)
  if not chunk:raise ConnectionError('Blender closed without a complete response')
  data+=chunk
response=json.loads(data.split(b'\0',1)[0])
if args.result:args.result.write_text(json.dumps(response,indent=2))
print(json.dumps(response))
if response.get('status')!='ok':raise SystemExit(1)
