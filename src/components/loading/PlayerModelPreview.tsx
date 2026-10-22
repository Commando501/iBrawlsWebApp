import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { buildVoxelSpartanModel, DEFAULT_LOADOUT, type CharacterLoadout } from '../VoxelModels';
import { buildCombatantRigForModel } from '../grifball/combatantRig';
import { disposePreviewObject, getPreviewLoadoutSignature } from '../previewModelUtils';
import type { VisualModelPolicy } from '../../model/modelSystem';
import { resolveLoadoutForVisualPolicy } from '../../model/modelVisualPolicy';
import { getV3GameplayRenderOptions } from '../v3/v3QualityTiers';
import { createPlayerPreviewPreparation } from './preparePlayerPreview';

interface PlayerModelPreviewProps {
  hue: number;
  loadout?: CharacterLoadout;
  visualModelPolicy?: VisualModelPolicy | null;
  className?: string;
}

const resolvePreviewLoadout = (
  loadout: CharacterLoadout | undefined,
  visualModelPolicy: VisualModelPolicy | null | undefined
): CharacterLoadout => resolveLoadoutForVisualPolicy({ visualModelPolicy, loadout });

const PREVIEW_V3_RENDER_OPTIONS = getV3GameplayRenderOptions();

const getResolvedPreviewLoadoutSignature = ({
  loadout,
  visualModelPolicy,
}: Pick<PlayerModelPreviewProps, 'loadout' | 'visualModelPolicy'>): string => (
  getPreviewLoadoutSignature(resolvePreviewLoadout(loadout, visualModelPolicy))
);

const PlayerModelPreviewComponent: React.FC<PlayerModelPreviewProps> = ({
  hue,
  loadout,
  visualModelPolicy,
  className,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const resolvedLoadout = resolvePreviewLoadout(loadout, visualModelPolicy);
  const loadoutSignature = getPreviewLoadoutSignature(resolvedLoadout);
  const paramsRef = useRef({ hue, loadout: resolvedLoadout, loadoutSignature });

  useEffect(() => {
    paramsRef.current = { hue, loadout: resolvedLoadout, loadoutSignature };
  }, [hue, resolvedLoadout, loadoutSignature]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // The fireteam list scrolls: clipped cards must not keep issuing WebGL work.
    // Retain their assets and clock so scrolling back preserves the same preview.
    let visible = typeof IntersectionObserver === 'undefined';
    const visibilityObserver = typeof IntersectionObserver === 'undefined' ? null
      : new IntersectionObserver(entries => {
          visible = entries.some(entry => entry.isIntersecting);
        });
    visibilityObserver?.observe(container);

    const scene = new THREE.Scene();
    const width = container.clientWidth || 96;
    const height = container.clientHeight || 96;
    const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 50);
    camera.position.set(0, 0.92, 4.0);
    camera.lookAt(0, 0.86, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    container.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight('#ffffff', 0.78));
    const key = new THREE.DirectionalLight('#ffffff', 1.45);
    key.position.set(4, 6, 5);
    scene.add(key);
    const rim = new THREE.PointLight('#38bdf8', 1.4, 8);
    rim.position.set(-2.5, 2.8, 2);
    scene.add(rim);

    let currentHue = paramsRef.current.hue;
    let currentLoadout = paramsRef.current.loadout;
    let currentLoadoutSignature = paramsRef.current.loadoutSignature;
    let character: THREE.Group | null = null;

    const buildCharacter = (nextHue: number, nextLoadout: CharacterLoadout | undefined) => {
      if (character) {
        scene.remove(character);
        disposePreviewObject(character);
      }
      character = buildVoxelSpartanModel(false, nextHue, nextLoadout ?? DEFAULT_LOADOUT, PREVIEW_V3_RENDER_OPTIONS);
      character.position.set(0, -0.05, 0);
      character.rotation.y = -0.35;
      buildCombatantRigForModel(character);
      scene.add(character);
    };

    buildCharacter(currentHue, currentLoadout);

    let animationFrameId = 0;
    const clock = new THREE.Clock();
    const animate = () => {
      const nextHue = paramsRef.current.hue;
      const nextLoadout = paramsRef.current.loadout;
      const nextLoadoutSignature = paramsRef.current.loadoutSignature;
      if (nextHue !== currentHue || nextLoadoutSignature !== currentLoadoutSignature) {
        currentHue = nextHue;
        currentLoadout = nextLoadout;
        currentLoadoutSignature = nextLoadoutSignature;
        buildCharacter(currentHue, currentLoadout);
        void preparation.prepare(character!);
        return;
      }

      const elapsed = clock.getElapsedTime();
      if (character) {
        character.rotation.y = -0.35 + Math.sin(elapsed * 0.9) * 0.12;
      }
      if (visible) renderer.render(scene, camera);
      animationFrameId = requestAnimationFrame(animate);
    };
    const preparation = createPlayerPreviewPreparation({
      renderer, scene, camera,
      onReady: () => { animationFrameId = requestAnimationFrame(animate); },
      onError: error => { console.warn('Player preview preparation failed:', error); },
      dispose: () => {
        if (character) {
          scene.remove(character);
          disposePreviewObject(character);
          character = null;
        }
        renderer.dispose();
        // Each mount owns its canvas; release the context before the match.
        renderer.forceContextLoss();
      },
    });
    void preparation.prepare(character!);

    const handleResize = () => {
      const nextWidth = container.clientWidth || width;
      const nextHeight = container.clientHeight || height;
      camera.aspect = nextWidth / nextHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(nextWidth, nextHeight);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animationFrameId);
      visibilityObserver?.disconnect();
      window.removeEventListener('resize', handleResize);
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
      preparation.stop();
    };
  }, []);

  return (
    <div className={`relative overflow-hidden rounded border border-white/10 bg-slate-950/80 ${className ?? ''}`} ref={containerRef}>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_40%,rgba(15,23,42,0.72))]" />
    </div>
  );
};

export const PlayerModelPreview = React.memo(
  PlayerModelPreviewComponent,
  (prev, next) =>
    prev.hue === next.hue &&
    prev.className === next.className &&
    getResolvedPreviewLoadoutSignature(prev) === getResolvedPreviewLoadoutSignature(next)
);
