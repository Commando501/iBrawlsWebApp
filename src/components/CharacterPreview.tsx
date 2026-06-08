/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { buildVoxelSpartanModel, buildGravityHammerModel, buildKatarSwordModel, CharacterLoadout, DEFAULT_LOADOUT } from './VoxelModels';
import {
  attachToCombatantAttachment,
  buildCombatantRigForModel,
} from './grifball/combatantRig';
import { THIRD_PERSON_RIGHT_HAND_REST_OFFSET } from './grifball/attackAnimationPresets';

interface CharacterPreviewProps {
  hue: number;
  heldWeapon: 'none' | 'hammer' | 'sword';
  loadout?: CharacterLoadout;
}

export const CharacterPreview: React.FC<CharacterPreviewProps> = ({ hue, heldWeapon, loadout }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  const paramsRef = useRef({ hue, heldWeapon, loadout });
  useEffect(() => {
    paramsRef.current = { hue, heldWeapon, loadout };
  }, [hue, heldWeapon, loadout]);

  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;

    const scene = new THREE.Scene();

    const width = container.clientWidth || 300;
    const height = container.clientHeight || 320;
    // Slightly wider FOV and further back camera to frame the broader pauldrons
    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 100);
    camera.position.set(0, 0.95, 4.2);
    camera.lookAt(0, 0.85, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    // Lighting
    const ambientLight = new THREE.AmbientLight('#ffffff', 0.65);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight('#ffffff', 1.3);
    dirLight.position.set(5, 10, 5);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 512;
    dirLight.shadow.mapSize.height = 512;
    scene.add(dirLight);

    const spotLight = new THREE.SpotLight('#38bdf8', 2.0, 10, Math.PI / 6, 0.5, 1);
    spotLight.position.set(-3, 5, 2);
    scene.add(spotLight);

    // Right-side fill light for pauldron highlights
    const fillLight = new THREE.PointLight('#ffffff', 0.5, 8);
    fillLight.position.set(3, 3, 1);
    scene.add(fillLight);

    // Floor platform
    const platformGeo = new THREE.CylinderGeometry(0.9, 1.0, 0.15, 32);
    const platformMat = new THREE.MeshStandardMaterial({ color: '#0f172a', roughness: 0.4, metalness: 0.8 });
    const platform = new THREE.Mesh(platformGeo, platformMat);
    platform.position.y = -0.075;
    platform.receiveShadow = true;
    scene.add(platform);

    const ringGeo = new THREE.RingGeometry(0.88, 0.9, 32);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(`hsl(${hue}, 85%, 60%)`),
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.8,
    });
    const platformRing = new THREE.Mesh(ringGeo, ringMat);
    platformRing.position.y = 0.005;
    scene.add(platformRing);

    let characterGroup: THREE.Group | null = null;
    let currentHue = paramsRef.current.hue;
    let currentWeapon = paramsRef.current.heldWeapon;
    let currentLoadout = paramsRef.current.loadout;

    const buildCharacter = (h: number, w: 'none' | 'hammer' | 'sword', lo: CharacterLoadout | undefined) => {
      if (characterGroup) scene.remove(characterGroup);

      characterGroup = buildVoxelSpartanModel(false, h, lo ?? DEFAULT_LOADOUT);
      characterGroup.position.set(0, 0, 0);
      buildCombatantRigForModel(characterGroup);
      scene.add(characterGroup);

      if (w === 'hammer') {
        const hammer = buildGravityHammerModel(h, lo?.hammerPreset);
        hammer.scale.set(0.6, 0.6, 0.6);
        hammer.position.set(
          0.5 - THIRD_PERSON_RIGHT_HAND_REST_OFFSET[0],
          1.0 - 0.64 - THIRD_PERSON_RIGHT_HAND_REST_OFFSET[1],
          -0.4 - THIRD_PERSON_RIGHT_HAND_REST_OFFSET[2]
        );
        hammer.rotation.set(Math.PI / 2.5, 0, 0);
        attachToCombatantAttachment(characterGroup, 'thirdPersonWeaponGrip', hammer);
      } else if (w === 'sword') {
        const sword = buildKatarSwordModel(h, lo?.swordPreset);
        sword.scale.set(0.6, 0.6, 0.6);
        sword.position.set(
          0.5 - THIRD_PERSON_RIGHT_HAND_REST_OFFSET[0],
          1.0 - 0.64 - THIRD_PERSON_RIGHT_HAND_REST_OFFSET[1],
          -0.32 - THIRD_PERSON_RIGHT_HAND_REST_OFFSET[2]
        );
        // Blade is built along +y; negative X rotation points it toward -z
        // (the character's forward / visor direction). +PI/2 aims it backward.
        sword.rotation.set(-Math.PI / 2, 0, -Math.PI / 8);
        attachToCombatantAttachment(characterGroup, 'thirdPersonWeaponGrip', sword);
      }
    };

    buildCharacter(currentHue, currentWeapon, currentLoadout);

    let isHovering = false;
    let isDragging = false;
    let previousPointerX = 0;

    const onPointerDown = (e: PointerEvent) => {
      isDragging = true;
      previousPointerX = e.clientX;
      container.setPointerCapture(e.pointerId);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (isDragging) {
        const deltaX = e.clientX - previousPointerX;
        previousPointerX = e.clientX;
        if (characterGroup) characterGroup.rotation.y += deltaX * 0.008;
        platform.rotation.y += deltaX * 0.008;
        platformRing.rotation.y += deltaX * 0.008;
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      if (isDragging) {
        isDragging = false;
        container.releasePointerCapture(e.pointerId);
      }
    };

    container.addEventListener('pointerdown', onPointerDown);
    container.addEventListener('pointermove', onPointerMove);
    container.addEventListener('pointerup', onPointerUp);
    container.addEventListener('pointercancel', onPointerUp);
    container.addEventListener('pointerenter', () => { isHovering = true; });
    container.addEventListener('pointerleave', () => { isHovering = false; });

    const clock = new THREE.Clock();
    let animationFrameId: number;

    const animate = () => {
      const newHue = paramsRef.current.hue;
      const newWeapon = paramsRef.current.heldWeapon;
      const newLoadout = paramsRef.current.loadout;

      const loadoutChanged = JSON.stringify(newLoadout) !== JSON.stringify(currentLoadout);
      if (newHue !== currentHue || newWeapon !== currentWeapon || loadoutChanged) {
        currentHue = newHue;
        currentWeapon = newWeapon;
        currentLoadout = newLoadout;
        buildCharacter(currentHue, currentWeapon, currentLoadout);
        ringMat.color.set(new THREE.Color(`hsl(${currentHue}, 85%, 60%)`));
      }

      if (!isHovering && !isDragging) {
        if (characterGroup) characterGroup.rotation.y += 0.012;
        platform.rotation.y += 0.012;
        platformRing.rotation.y += 0.012;
      }

      const elapsed = clock.getElapsedTime();
      scene.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material) {
          const materials = Array.isArray(child.material) ? child.material : [child.material];
          materials.forEach((mat) => {
            if (
              'emissive' in mat &&
              mat.emissive &&
              ((mat.emissive as THREE.Color).r > 0 || (mat.emissive as THREE.Color).g > 0 || (mat.emissive as THREE.Color).b > 0)
            ) {
              (mat as THREE.MeshStandardMaterial).emissiveIntensity = 2.0 + Math.sin(elapsed * 4.0) * 0.8;
            }
          });
        }
      });

      renderer.render(scene, camera);
      animationFrameId = requestAnimationFrame(animate);
    };

    animate();

    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', handleResize);
      container.removeEventListener('pointerdown', onPointerDown);
      container.removeEventListener('pointermove', onPointerMove);
      container.removeEventListener('pointerup', onPointerUp);
      container.removeEventListener('pointercancel', onPointerUp);
      if (container && renderer.domElement && container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      renderer.dispose();
      platformMat.dispose();
      platformGeo.dispose();
      ringMat.dispose();
      ringGeo.dispose();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="w-full h-full rounded-xl border border-white/5 bg-slate-950/40 relative flex items-center justify-center overflow-hidden shadow-inner cursor-grab active:cursor-grabbing select-none"
    >
      <div className="absolute top-3 left-3 w-3 h-3 border-t border-l border-[#38bdf8]/40" />
      <div className="absolute top-3 right-3 w-3 h-3 border-t border-r border-[#38bdf8]/40" />
      <div className="absolute bottom-3 left-3 w-3 h-3 border-b border-l border-[#38bdf8]/40" />
      <div className="absolute bottom-3 right-3 w-3 h-3 border-b border-r border-[#38bdf8]/40" />
      <div className="absolute inset-0 pointer-events-none z-0 bg-[radial-gradient(circle_at_center,transparent_45%,rgba(5,11,26,0.5))] opacity-80" />
      <div
        className="absolute inset-0 pointer-events-none z-0 opacity-15"
        style={{
          backgroundImage: `
            repeating-linear-gradient(0deg, #38bdf8 0px, #38bdf8 1px, transparent 1px, transparent 20px),
            repeating-linear-gradient(90deg, #38bdf8 0px, #38bdf8 1px, transparent 1px, transparent 20px)
          `,
        }}
      />
    </div>
  );
};
