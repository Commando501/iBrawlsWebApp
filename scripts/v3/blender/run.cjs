// Small stdio MCP bridge for sessions where Blender tools are not exposed directly.
const { resolve, join } = require('node:path');
const { mkdirSync, writeFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const scripts = { 'review-left-arm': 'render-left-arm.py', 'review-runner': 'render-runner.py', ball: 'author-ball.py', runner: 'author.py', throw: 'author.py', punch: 'author.py', 'left-arm': 'author.py', import: 'import-review.py', author: 'author.py', hammer: 'author.py', sword: 'author.py', lunge: 'author.py', melee: 'author.py', slide: 'author.py', 'slide-recovery': 'author.py', carries: 'author.py', export: 'export-bake.py', review: 'render-review.py', weapons: 'author-weapons.py', 'review-hammer': 'render-hammer.py', 'review-sword': 'render-sword.py', 'review-lunge': 'render-lunge.py', 'review-melee': 'render-melee.py', 'review-slide': 'render-slide.py', 'review-carries': 'render-carries.py' };
const action = process.argv[2];
scripts.refine = 'author.py';
scripts['review-crouch'] = 'render-crouch.py';
scripts['audit-motion'] = 'audit-motion.py';
scripts['review-motion'] = 'render-motion.py';
if (!scripts[action]) throw new Error(`Usage: node scripts/v3/blender/run.cjs ${Object.keys(scripts).join('|')}`);
const selectedClips = action === 'refine' ? process.argv[3]?.split(',') : null;
if (action === 'refine' && (!selectedClips?.length || selectedClips.some(id => !/^clean_[a-z_]+$/.test(id)))) {
  throw new Error('refine requires a comma-separated list of clean_* clip IDs');
}
const out = resolve(__dirname, '../../../output/blender-repair');
mkdirSync(out, { recursive: true });
const script = join(__dirname, scripts[action]).replaceAll('\\', '/');
const request = join(out, `${action}-request.json`);
const selection = selectedClips ? `, init_globals={'ONLY_CLIPS': ${JSON.stringify(selectedClips)}, 'SKIP_RENDER': True}` : null;
writeFileSync(request, JSON.stringify({ name: 'execute_blender_code', arguments: {
  user_prompt: `Run the V3 Blender ${action} workflow.`,
  code: `import runpy; runpy.run_path(${JSON.stringify(script)}, run_name='__main__'${selection ?? (action === 'left-arm' ? ", init_globals={'ONLY_CLIPS': 'all', 'SKIP_RENDER': True}" : action === 'punch' ? ", init_globals={'ONLY_CLIPS': ['clean_ball_punch']}" : action === 'throw' ? ", init_globals={'ONLY_CLIPS': ['clean_ball_throw']}" : action === 'runner' ? ", init_globals={'ONLY_CLIPS': ['clean_ball_carry','clean_slide_ball','clean_ball_walk','clean_ball_sprint','clean_ball_punch','clean_ball_throw']}" : action === 'hammer' ? ", init_globals={'ONLY_CLIPS': ['clean_hammer_windup','clean_hammer_strike','clean_hammer_recover']}" : action === 'sword' ? ", init_globals={'ONLY_CLIPS': ['clean_sword_slash','clean_sword_recover']}" : action === 'lunge' ? ", init_globals={'ONLY_CLIPS': ['clean_sword_lunge']}" : action === 'melee' ? ", init_globals={'ONLY_CLIPS': ['clean_hammer_melee','clean_hammer_melee_recover']}" : action === 'slide-recovery' ? ", init_globals={'ONLY_CLIPS': ['clean_slide','clean_slide_hammer','clean_slide_sword','clean_slide_pistol','clean_slide_ball']}" : action === 'slide' ? ", init_globals={'ONLY_CLIPS': ['clean_slide']}" : action === 'carries' ? ", init_globals={'ONLY_CLIPS': ['clean_slide_hammer','clean_slide_sword','clean_slide_pistol','clean_slide_ball','clean_ball_carry']}" : '')})`,
} }));
const result = spawnSync(process.execPath, [join(__dirname, 'mcp-call.cjs'), request, join(out, `${action}-result.json`)], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
