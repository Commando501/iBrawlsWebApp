import { useEffect, useRef, useState } from 'react';
import type { CustomMapData } from '../../types';
import { getRectHalfExtents } from '../../game/arenaDimensions';
import { MAP_BALANCE_PLAYER_INSET, STADIUM_STRUCTURE_HEIGHT, getMapTraversal, mapScaleFactors } from '../../game/mapBalancing';

type Traversal = ReturnType<typeof getMapTraversal>;
const RUN = '#67e8f9';
const SPRINT = '#fbbf24';

function PlayerMarker({ color, moving, markerRef, size }: {
  color: string;
  moving: boolean;
  markerRef: (element: SVGGElement | null) => void;
  size: number;
}) {
  return <g ref={markerRef} data-player-marker="true" aria-hidden="true">
    <circle r={size * 1.1} fill={color} opacity=".16" />
    <g transform={`scale(${size})`} fill={color} stroke="#07101d" strokeWidth=".12">
      <g className="balancer-arm" style={{ animationPlayState: moving ? 'running' : 'paused' }}><rect x="-.64" y="-.6" width=".3" height=".8" rx=".1" /></g>
      <g className="balancer-arm balancer-arm-opposite" style={{ animationPlayState: moving ? 'running' : 'paused' }}><rect x=".34" y="-.6" width=".3" height=".8" rx=".1" /></g>
      <rect x="-.32" y="-.45" width=".64" height=".85" rx=".15" />
      <rect x="-.25" y="-.64" width=".5" height=".43" rx=".15" />
      <path d="M-.18,-.54 H.18" stroke="#fff" strokeWidth=".12" />
      <path d="M-.26,.35 V.7 M.26,.35 V.7" stroke={color} strokeWidth=".25" />
    </g>
  </g>;
}

/** SVG overview uses world metres. Animation changes only marker transforms. */
export function MapBalancerPreview({ base, map, traversal, playing, restartKey }: {
  base: CustomMapData;
  map: CustomMapData;
  traversal: Traversal;
  playing: boolean;
  restartKey: number;
}) {
  const markers = useRef<(SVGGElement | null)[]>([]);
  const svg = useRef<SVGSVGElement>(null);
  const [previewWidth, setPreviewWidth] = useState(800);
  const clock = useRef<SVGTextElement>(null);
  const elapsed = useRef(0);
  const half = getRectHalfExtents(map.arenaRadius, map.arenaHalfExtents);
  const original = getRectHalfExtents(base.arenaRadius, base.arenaHalfExtents);
  const factors = mapScaleFactors(map.balanceScale);
  const viewX = Math.max(original.x, half.x) + 22 * Math.max(1, factors.x);
  const viewZ = Math.max(original.z, half.z) + 23 * Math.max(1, factors.z);
  const boundX = half.x - MAP_BALANCE_PLAYER_INSET;
  const boundZ = half.z - MAP_BALANCE_PLAYER_INSET;
  const markerSize = Math.max(1.6, viewX * 2 / previewWidth * 10);
  const laneOffset = Math.max(3, viewX * 2 / previewWidth * 8);

  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    const measure = () => setPreviewWidth(Math.max(1, element.getBoundingClientRect().width));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => { elapsed.current = 0; }, [map, restartKey, traversal.run, traversal.sprint]);
  useEffect(() => {
    let frame = 0;
    let previous: number | null = null;
    const draw = (now: number) => {
      if (playing && previous !== null) elapsed.current += (now - previous) / 1000;
      previous = now;
      for (let index = 0; index < 4; index++) {
        const speed = index % 2 === 0 ? traversal.run : traversal.sprint;
        const horizontal = index < 2;
        const distance = horizontal ? traversal.length : traversal.width;
        const phase = speed && speed > 0 ? (elapsed.current * speed / distance) % 2 : 0;
        const progress = phase <= 1 ? phase : 2 - phase;
        const x = horizontal ? -boundX + progress * distance : (index === 2 ? -laneOffset : laneOffset);
        const z = horizontal ? (index === 0 ? -laneOffset : laneOffset) : -boundZ + progress * distance;
        const rotation = horizontal ? (phase < 1 ? 90 : -90) : (phase < 1 ? 180 : 0);
        markers.current[index]?.setAttribute('transform', `translate(${x} ${z}) rotate(${rotation})`);
      }
      if (clock.current) clock.current.textContent = `${elapsed.current.toFixed(1)}s elapsed`;
      if (playing) frame = requestAnimationFrame(draw);
    };
    draw(performance.now());
    return () => cancelAnimationFrame(frame);
  }, [playing, restartKey, map, traversal.run, traversal.sprint, traversal.length, traversal.width, boundX, boundZ, laneOffset]);

  return <div className="overflow-hidden rounded-xl border border-slate-700 bg-[#080f1c]">
    <style>{`@keyframes balancer-stride{from{transform:translateY(-.2px)}to{transform:translateY(.2px)}} .balancer-arm{animation:balancer-stride .23s infinite alternate linear}.balancer-arm-opposite{animation-delay:-.23s}`}</style>
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-4 py-3 font-mono text-[11px] text-slate-300"><span>Length {(half.x * 2).toFixed(2)} m</span><span>Width {(half.z * 2).toFixed(2)} m</span><span className="text-slate-500">10 m grid</span></div>
    <svg ref={svg} viewBox={`${-viewX} ${-viewZ} ${viewX * 2} ${viewZ * 2}`} role="img" aria-label={`${map.name} top-down preview with running and sprinting players on both axes`} className="block w-full" data-testid="map-balancer-preview">
      <title>{`${map.name} — ${half.x * 2}m long, ${(half.z * 2).toFixed(2)}m wide`}</title>
      <defs><pattern id="balancer-grid" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M 10 0 H 0 V 10" fill="none" stroke="#203247" strokeWidth=".15" /></pattern></defs>
      <rect x={-viewX} y={-viewZ} width={viewX * 2} height={viewZ * 2} fill="url(#balancer-grid)" />
      <g transform={`scale(${factors.x} ${factors.z})`} stroke="#475569" strokeWidth=".3">
        {[-1, 1].flatMap(side => [0, 1, 2, 3].map(tier => <rect key={`${side}-${tier}`} x={-original.x * .9} y={side < 0 ? -original.z - 6 - tier * 2 : original.z + 4 + tier * 2} width={original.x * 1.8} height="1.4" rx=".3" fill="#25364b" />))}
        {[-1, 1].flatMap(side => [0, 1, 2].map(tier => <rect key={`end-${side}-${tier}`} x={side < 0 ? -original.x - 4 - tier * 2 : original.x + 2 + tier * 2} y={-original.z * 1.1} width="1.4" height={original.z * 2.2} rx=".3" fill="#25364b" />))}
        {[-1, 1].flatMap(x => [-1, 1].map(z => <circle key={`${x}-${z}`} cx={x * (original.x + 2)} cy={z * (original.z + 2)} r="1" fill="#e2e8f0" />))}
      </g>
      <rect x={-half.x} y={-half.z} width={half.x * 2} height={half.z * 2} fill="#142436" stroke="#6c8ba7" strokeWidth=".4" />
      <rect x={-half.x} y={-half.z} width={half.x * .23} height={half.z * 2} fill="#2563eb" opacity=".13" />
      <rect x={half.x * .77} y={-half.z} width={half.x * .23} height={half.z * 2} fill="#ef4444" opacity=".13" />
      <path d={`M0 ${-half.z}V${half.z}`} stroke="#62758a" strokeWidth=".2" />
      <ellipse rx={5 * factors.x} ry={5 * factors.z} fill="none" stroke="#62758a" strokeWidth=".2" />
      <rect x={-original.x} y={-original.z} width={original.x * 2} height={original.z * 2} fill="none" stroke="#cbd5e1" strokeDasharray="1 1" strokeWidth=".25" opacity=".5" />
      {map.objects.map(object => <ellipse key={object.id} cx={object.position.x} cy={object.position.z} rx={object.scale.x / 2} ry={object.scale.z / 2} fill={object.emissive || object.color} stroke={object.color} strokeWidth=".15" />)}
      {map.spawnPoints.map((spawn, index) => <path key={index} d={`M${spawn.x - .5},${spawn.z} h1 M${spawn.x},${spawn.z - .5} v1`} stroke={spawn.x < 0 ? '#60a5fa' : '#fb7185'} strokeWidth=".3" />)}
      <g fill="none" strokeWidth=".18" strokeDasharray="1 1" opacity=".7">
        <path d={`M${-boundX},${-laneOffset} H${boundX}`} stroke={RUN} /><path d={`M${-boundX},${laneOffset} H${boundX}`} stroke={SPRINT} />
        <path d={`M${-laneOffset},${-boundZ} V${boundZ}`} stroke={RUN} /><path d={`M${laneOffset},${-boundZ} V${boundZ}`} stroke={SPRINT} />
      </g>
      {[RUN, SPRINT, RUN, SPRINT].map((color, index) => <g key={index}><PlayerMarker color={color} size={markerSize} moving={playing && (index % 2 === 0 ? traversal.run > 0 : (traversal.sprint ?? 0) > 0)} markerRef={element => { markers.current[index] = element; }} /></g>)}
      <g fontSize={viewX * 2 / previewWidth * 11} fontFamily="monospace">
        <text ref={clock} x={viewX - 3} y={-viewZ + viewX * 2 / previewWidth * 17} textAnchor="end" fill={RUN}>0.0s elapsed</text>
      </g>
    </svg>
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 px-4 py-3 text-[11px] text-slate-400">
      <span><span className="text-cyan-300">● Run</span><span className="ml-4 text-amber-300">● Sprint{traversal.sprint === null ? ' (disabled)' : ''}</span></span>
      <span>Dashed outline: original size · + spawn · ● goal</span>
    </div>
    <div className="flex items-center gap-4 border-t border-slate-800 px-4 py-3">
      <svg viewBox="0 0 120 52" className="h-16 w-32 shrink-0" aria-label="Stadium height comparison">
        <path d="M2 48 H118" stroke="#475569" />
        <rect x="12" y="25.6" width="96" height="22.4" fill="none" stroke="#64748b" strokeDasharray="2 2" />
        <path d={`M12 48 V${48 - STADIUM_STRUCTURE_HEIGHT * factors.y} H108 V48 M36 48 V${48 - 16 * factors.y} H84 V48`} fill="none" stroke="#a5b4fc" strokeWidth="2" />
      </svg>
      <div className="text-xs text-slate-300">Structure height <strong className="text-indigo-300">{(STADIUM_STRUCTURE_HEIGHT * factors.y).toFixed(2)} m</strong><p className="mt-1 text-[11px] text-slate-500">Side profile · open sky, no gameplay ceiling</p></div>
    </div>
  </div>;
}
