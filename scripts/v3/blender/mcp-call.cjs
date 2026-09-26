const fs = require('node:fs');
const { spawn } = require('node:child_process');
const request = JSON.parse(fs.readFileSync(process.argv[2], 'utf8').replace(/^\uFEFF/, ''));
const p = spawn(process.env.BLENDER_MCP_UVX || 'uvx', ['mcp-for-blender'], { stdio: ['pipe', 'pipe', 'pipe'] });
let buffer = '';
let completed = false;
const send = value => p.stdin.write(JSON.stringify(value) + '\n');
p.stdout.on('data', chunk => {
  buffer += chunk;
  let end;
  while ((end = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
    let response; try { response = JSON.parse(line); } catch { continue; }
    if (response.id === 1) {
      send({ jsonrpc: '2.0', method: 'notifications/initialized' });
      send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: request });
    }
    if (response.id === 2) {
      completed = true;
      if (process.argv[3]) fs.writeFileSync(process.argv[3], JSON.stringify(response, null, 2));
      for (const item of response.result?.content ?? []) if (item.type === 'text') console.log(item.text);
      const textError = response.result?.content?.some(item => item.type === 'text' && /^Error executing code:/i.test(item.text));
      if (response.error || response.result?.isError || textError) {
        console.error(JSON.stringify(response.error || { error: 'Blender tool reported an error' }));
        process.exitCode = 1;
      }
      p.kill();
    }
  }
});
p.stderr.on('data', chunk => process.stderr.write(chunk));
p.on('error', error => { completed = true; console.error(error.message); process.exitCode = 1; });
p.on('exit', () => { if (!completed) process.exitCode = 1; });
send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'ibrawls-asset-repair', version: '1.0' } } });
setTimeout(() => { if (!completed) { console.error('Blender MCP request timed out'); p.kill(); process.exitCode = 1; } }, Number(process.env.BLENDER_MCP_TIMEOUT_MS || 120000)).unref();
