/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { createVanguardSword, attachVanguardSword } from './iron-vanguard/ironVanguardSword';
import { animateIronVanguard, isIronVanguardModel } from './iron-vanguard/ironVanguardModel';
import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { buildVoxelSpartanModel, buildGravityHammerModel, buildKatarSwordModel, CharacterLoadout, DEFAULT_LOADOUT } from './VoxelModels';
import {
  attachToCombatantAttachment,
  buildCombatantRigForModel,
} from './grifball/combatantRig';
import { THIRD_PERSON_RIGHT_HAND_REST_OFFSET } from './grifball/attackAnimationPresets';
import { disposePreviewObject, getPreviewLoadoutSignature } from './previewModelUtils';
import { getV3GameplayRenderOptions } from './v3/v3QualityTiers';

interface CharacterPreviewProps {
  hue: number;
  heldWeapon: 'none' | 'hammer' | 'sword';
  loadout?: CharacterLoadout;
  autoRotate?: boolean;
  rotation?: number;
  onRotationChange?: (rotation: number) => void;
  onReady?: () => void;
  onError?: () => void;
}

const PREVIEW_V3_RENDER_OPTIONS = getV3GameplayRenderOptions();

export function getCharacterPreviewLoadoutSignature(loadout?: CharacterLoadout): string {
  return getPreviewLoadoutSignature(loadout);
}

export const CharacterPreview: React.FC<CharacterPreviewProps> = ({ hue, heldWeapon, loadout, autoRotate = true, rotation, onRotationChange, onReady, onError }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const loadoutSignature = getCharacterPreviewLoadoutSignature(loadout);

  const paramsRef = useRef({ hue, heldWeapon, loadout, loadoutSignature, autoRotate, rotation, onRotationChange, onReady, onError });
  useEffect(() => {
    paramsRef.current = { hue, heldWeapon, loadout, loadoutSignature, autoRotate, rotation, onRotationChange, onReady, onError };
  }, [hue, heldWeapon, loadout, loadoutSignature, autoRotate, rotation, onRotationChange, onReady, onError]);

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

    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); }
    catch { paramsRef.current.onError?.(); return; }
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    container.appendChild(renderer.domElement);

    // Lighting
    const ambientLight = new THREE.HemisphereLight(0xdceeff, 0x2e3a4a, 0.8);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffeee0, 2.2);
    dirLight.position.set(-3, 6, 4);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 512;
    dirLight.shadow.mapSize.height = 512;
    dirLight.shadow.normalBias = 0.025;
    scene.add(dirLight);

    const spotLight = new THREE.DirectionalLight(0x54c7eb, 2.5);
    spotLight.position.set(3, 3, -3);
    scene.add(spotLight);

    // Right-side fill light for pauldron highlights
    const fillLight = new THREE.DirectionalLight(0x99baff, 0.65);
    fillLight.position.set(3, 1, 4);
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
    let currentLoadoutSignature = paramsRef.current.loadoutSignature;

    const buildCharacter = (h: number, w: 'none' | 'hammer' | 'sword', lo: CharacterLoadout | undefined) => {
      if (characterGroup) {
        scene.remove(characterGroup);
        disposePreviewObject(characterGroup);
      }

      characterGroup = buildVoxelSpartanModel(false, h, lo ?? DEFAULT_LOADOUT, PREVIEW_V3_RENDER_OPTIONS);
      characterGroup.position.set(0, 0, 0);
      characterGroup.rotation.y = paramsRef.current.rotation ?? 0;
      // Iron Vanguard faces -Z, matching the production gameplay rig.
      const isVanguard = isIronVanguardModel(characterGroup);
      const facing = isVanguard ? -1 : 1;
      camera.fov = isVanguard ? 33 : 42;
      camera.position.set(0, isVanguard ? 1.15 : 0.95, (isVanguard ? 4.5 : 4.2) * facing);
      camera.updateProjectionMatrix();
      dirLight.position.z = 4 * facing;
      spotLight.position.z = -3 * facing;
      fillLight.position.z = 4 * facing;
      camera.lookAt(0, isVanguard ? 1.03 : 0.85, 0);
      buildCombatantRigForModel(characterGroup);
      scene.add(characterGroup);

      const importedHammer = characterGroup.userData.ironVanguardHammer as THREE.Group | undefined;
      if (importedHammer) importedHammer.visible = w === 'hammer';
      if (w === 'hammer' && !importedHammer) {
        const hammer = buildGravityHammerModel(h, lo?.hammerPreset);
        hammer.scale.set(0.6, 0.6, 0.6);
        hammer.position.set(
          0.5 - THIRD_PERSON_RIGHT_HAND_REST_OFFSET[0],
          1.0 - 0.64 - THIRD_PERSON_RIGHT_HAND_REST_OFFSET[1],
          -0.4 - THIRD_PERSON_RIGHT_HAND_REST_OFFSET[2]
        );
        hammer.rotation.set(Math.PI / 2.5, 0, 0);
        attachToCombatantAttachment(characterGroup, 'thirdPersonWeaponGrip', hammer);
      } else if (w === 'sword' && importedHammer) {
        attachVanguardSword(characterGroup, createVanguardSword());
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
    let isFocused = false;
    let currentRotation = paramsRef.current.rotation;
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
        if (characterGroup) {
          characterGroup.rotation.y += deltaX * 0.008;
          paramsRef.current.onRotationChange?.(characterGroup.rotation.y);
        }
        platform.rotation.y += deltaX * 0.008;
        platformRing.rotation.y += deltaX * 0.008;
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      if (isDragging) {
        isDragging = false;
        if (container.hasPointerCapture(e.pointerId)) container.releasePointerCapture(e.pointerId);
      }
    };

    container.addEventListener('pointerdown', onPointerDown);
    container.addEventListener('pointermove', onPointerMove);
    container.addEventListener('pointerup', onPointerUp);
    container.addEventListener('pointercancel', onPointerUp);
    const onPointerEnter = () => { isHovering = true; };
    const onPointerLeave = () => { isHovering = false; };
    const onFocus = () => { isFocused = true; };
    const onBlur = () => { isFocused = false; };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key) || !characterGroup) return;
      event.preventDefault();
      event.stopPropagation();
      characterGroup.rotation.y = event.key === 'Home' ? 0.22 : characterGroup.rotation.y + (event.key === 'ArrowLeft' ? -Math.PI / 12 : Math.PI / 12);
      paramsRef.current.onRotationChange?.(characterGroup.rotation.y);
    };
    container.addEventListener('pointerenter', onPointerEnter);
    container.addEventListener('pointerleave', onPointerLeave);
    container.addEventListener('focus', onFocus);
    container.addEventListener('blur', onBlur);
    container.addEventListener('keydown', onKeyDown);

    const startedAt = performance.now();
    let animationFrameId: number;

    const animate = () => {
      const newHue = paramsRef.current.hue;
      const newWeapon = paramsRef.current.heldWeapon;
      const newLoadout = paramsRef.current.loadout;
      const newLoadoutSignature = paramsRef.current.loadoutSignature;

      const loadoutChanged = newLoadoutSignature !== currentLoadoutSignature;
      if (newHue !== currentHue || newWeapon !== currentWeapon || loadoutChanged) {
        currentHue = newHue;
        currentWeapon = newWeapon;
        currentLoadout = newLoadout;
        currentLoadoutSignature = newLoadoutSignature;
        buildCharacter(currentHue, currentWeapon, currentLoadout);
        ringMat.color.set(new THREE.Color(`hsl(${currentHue}, 85%, 60%)`));
      }

      if (paramsRef.current.rotation !== currentRotation) {
        currentRotation = paramsRef.current.rotation;
        if (characterGroup && currentRotation !== undefined) characterGroup.rotation.y = currentRotation;
      }
      if (paramsRef.current.autoRotate && !reducedMotion.matches && !isHovering && !isDragging && !isFocused && !document.hidden) {
        if (characterGroup) characterGroup.rotation.y += 0.012;
        platform.rotation.y += 0.012;
        platformRing.rotation.y += 0.012;
      }

      const elapsed = reducedMotion.matches ? 0 : (performance.now() - startedAt) / 1000;
      if (characterGroup && isIronVanguardModel(characterGroup)) {
        animateIronVanguard(characterGroup, {
          activeWeapon: currentWeapon, weaponState: 'ready', weaponTimer: 0,
          dt: 0, yaw: characterGroup.rotation.y, previewClip: 'idle', previewTime: elapsed,
        });
      }
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

      if (!document.hidden) renderer.render(scene, camera);
      animationFrameId = requestAnimationFrame(animate);
    };

    animate();
    paramsRef.current.onReady?.();

    const handleResize = () => {
      if (!container) return;
      const w = Math.max(1, container.clientWidth);
      const h = Math.max(1, container.clientHeight);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);
    const onContextLost = (event: Event) => { event.preventDefault(); paramsRef.current.onError?.(); };
    renderer.domElement.addEventListener('webglcontextlost', onContextLost);

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', handleResize);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      container.removeEventListener('pointerenter', onPointerEnter);
      container.removeEventListener('pointerleave', onPointerLeave);
      container.removeEventListener('focus', onFocus);
      container.removeEventListener('blur', onBlur);
      container.removeEventListener('keydown', onKeyDown);
      container.removeEventListener('pointerdown', onPointerDown);
      container.removeEventListener('pointermove', onPointerMove);
      container.removeEventListener('pointerup', onPointerUp);
      container.removeEventListener('pointercancel', onPointerUp);
      if (characterGroup) {
        scene.remove(characterGroup);
        disposePreviewObject(characterGroup);
        characterGroup = null;
      }
      if (container && renderer.domElement && container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      renderer.dispose();
      renderer.forceContextLoss();
      platformMat.dispose();
      platformGeo.dispose();
      ringMat.dispose();
      ringGeo.dispose();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      role="group"
      aria-label="Character preview. Drag or use left and right arrows to rotate. Home resets the view."
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
