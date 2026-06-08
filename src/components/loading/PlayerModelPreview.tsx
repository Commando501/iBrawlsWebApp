import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { buildVoxelSpartanModel, DEFAULT_LOADOUT, type CharacterLoadout } from '../VoxelModels';
import { buildCombatantRigForModel } from '../grifball/combatantRig';

interface PlayerModelPreviewProps {
  hue: number;
  loadout?: CharacterLoadout;
  className?: string;
}

export const PlayerModelPreview: React.FC<PlayerModelPreviewProps> = ({ hue, loadout, className }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

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

    const character = buildVoxelSpartanModel(false, hue, loadout ?? DEFAULT_LOADOUT);
    character.position.set(0, -0.05, 0);
    character.rotation.y = -0.35;
    buildCombatantRigForModel(character);
    scene.add(character);

    let animationFrameId = 0;
    const clock = new THREE.Clock();
    const animate = () => {
      const elapsed = clock.getElapsedTime();
      character.rotation.y = -0.35 + Math.sin(elapsed * 0.9) * 0.12;
      renderer.render(scene, camera);
      animationFrameId = requestAnimationFrame(animate);
    };
    animate();

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
      window.removeEventListener('resize', handleResize);
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
      scene.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry?.dispose();
          const materials = Array.isArray(child.material) ? child.material : [child.material];
          materials.forEach((material) => material.dispose());
        }
      });
      renderer.dispose();
    };
  }, [hue, loadout]);

  return (
    <div className={`relative overflow-hidden rounded border border-white/10 bg-slate-950/80 ${className ?? ''}`} ref={containerRef}>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_40%,rgba(15,23,42,0.72))]" />
    </div>
  );
};
