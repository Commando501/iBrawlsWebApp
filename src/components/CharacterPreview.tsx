/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { buildVoxelSpartanModel, buildGravityHammerModel, buildKatarSwordModel } from './VoxelModels';

interface CharacterPreviewProps {
  hue: number;
  heldWeapon: 'none' | 'hammer' | 'sword';
}

export const CharacterPreview: React.FC<CharacterPreviewProps> = ({ hue, heldWeapon }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Track reactive state updates inside animation loops securely
  const paramsRef = useRef({ hue, heldWeapon });
  useEffect(() => {
    paramsRef.current = { hue, heldWeapon };
  }, [hue, heldWeapon]);

  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;

    // 1. Scene setup
    const scene = new THREE.Scene();
    
    // Set aspect ratio based on element size
    const width = container.clientWidth || 300;
    const height = container.clientHeight || 320;
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    
    // Position camera to fit the spartan nicely with some breathing room
    camera.position.set(0, 0.9, 3.5);
    camera.lookAt(0, 0.8, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    
    container.appendChild(renderer.domElement);

    // 2. Lighting setup
    const ambientLight = new THREE.AmbientLight('#ffffff', 0.65);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight('#ffffff', 1.3);
    dirLight.position.set(5, 10, 5);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 512;
    dirLight.shadow.mapSize.height = 512;
    scene.add(dirLight);

    // A subtle rim light or spotlight to look premium
    const spotLight = new THREE.SpotLight('#38bdf8', 2.0, 10, Math.PI / 6, 0.5, 1);
    spotLight.position.set(-3, 5, 2);
    scene.add(spotLight);

    // Floor platform (cyberpunk metal pedestal)
    const platformGeo = new THREE.CylinderGeometry(0.8, 0.9, 0.15, 32);
    const platformMat = new THREE.MeshStandardMaterial({
      color: '#0f172a',
      roughness: 0.4,
      metalness: 0.8,
    });
    const platform = new THREE.Mesh(platformGeo, platformMat);
    platform.position.y = -0.075;
    platform.receiveShadow = true;
    scene.add(platform);

    // Subtle neon ring detailing the pedestal
    const ringGeo = new THREE.RingGeometry(0.78, 0.8, 32);
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

    // 3. Voxel Spartan Generation & Weapons References
    let characterGroup: THREE.Group | null = null;
    let currentHue = paramsRef.current.hue;
    let currentWeapon = paramsRef.current.heldWeapon;

    const buildCharacter = (h: number, w: 'none' | 'hammer' | 'sword') => {
      if (characterGroup) {
        scene.remove(characterGroup);
      }

      // Local player spartan (isEnemy = false, customHue = h)
      characterGroup = buildVoxelSpartanModel(false, h);
      characterGroup.position.set(0, 0, 0);
      scene.add(characterGroup);

      // Attach requested weapon to upperTorso relative joints
      if (w === 'hammer') {
        const hammer = buildGravityHammerModel(h);
        hammer.scale.set(0.6, 0.6, 0.6);
        hammer.position.set(0.5, 1.0 - 0.64, -0.4);
        hammer.rotation.set(Math.PI / 2.5, 0, 0); // Cool stance holding hammer
        if (characterGroup.userData.upperTorso) {
          characterGroup.userData.upperTorso.add(hammer);
        } else {
          characterGroup.add(hammer);
        }
      } else if (w === 'sword') {
        const sword = buildKatarSwordModel(h);
        sword.scale.set(0.6, 0.6, 0.6);
        sword.position.set(0.5, 1.0 - 0.64, -0.32);
        sword.rotation.set(Math.PI / 2, 0, -Math.PI / 8);
        if (characterGroup.userData.upperTorso) {
          characterGroup.userData.upperTorso.add(sword);
        } else {
          characterGroup.add(sword);
        }
      }
    };

    // Initial build
    buildCharacter(currentHue, currentWeapon);

    // Track states inside effect scope for responsive updates
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
        
        // Manual rotation along the axis
        const rotationSpeed = 0.008;
        if (characterGroup) {
          characterGroup.rotation.y += deltaX * rotationSpeed;
        }
        platform.rotation.y += deltaX * rotationSpeed;
        platformRing.rotation.y += deltaX * rotationSpeed;
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      if (isDragging) {
        isDragging = false;
        container.releasePointerCapture(e.pointerId);
      }
    };

    const onPointerEnter = () => {
      isHovering = true;
    };

    const onPointerLeave = () => {
      isHovering = false;
    };

    container.addEventListener('pointerdown', onPointerDown);
    container.addEventListener('pointermove', onPointerMove);
    container.addEventListener('pointerup', onPointerUp);
    container.addEventListener('pointercancel', onPointerUp);
    container.addEventListener('pointerenter', onPointerEnter);
    container.addEventListener('pointerleave', onPointerLeave);

    // 4. Animation loop
    const clock = new THREE.Clock();
    let animationFrameId: number;
    const animate = () => {
      // Check if parameters have updated reactively
      const newHue = paramsRef.current.hue;
      const newWeapon = paramsRef.current.heldWeapon;

      if (newHue !== currentHue || newWeapon !== currentWeapon) {
        currentHue = newHue;
        currentWeapon = newWeapon;
        buildCharacter(currentHue, currentWeapon);
        
        // Dynamically update the platform neon ring color as well!
        ringMat.color.set(new THREE.Color(`hsl(${currentHue}, 85%, 60%)`));
      }

      // Rotate character model slowly if not hovered and not manually dragging
      if (!isHovering && !isDragging) {
        if (characterGroup) {
          characterGroup.rotation.y += 0.012;
        }
        platform.rotation.y += 0.012;
        platformRing.rotation.y += 0.012;
      }

      // Dynamic emissive glow pulsing: pulses visor and weapons in sync
      const elapsed = clock.getElapsedTime();
      scene.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material) {
          const materials = Array.isArray(child.material) ? child.material : [child.material];
          materials.forEach((mat) => {
            if (
              'emissive' in mat &&
              mat.emissive &&
              ((mat.emissive as THREE.Color).r > 0 ||
                (mat.emissive as THREE.Color).g > 0 ||
                (mat.emissive as THREE.Color).b > 0)
            ) {
              const standardMat = mat as THREE.MeshStandardMaterial;
              standardMat.emissiveIntensity = 2.0 + Math.sin(elapsed * 4.0) * 0.8;
            }
          });
        }
      });

      renderer.render(scene, camera);
      animationFrameId = requestAnimationFrame(animate);
    };

    animate();

    // 5. Handle resizing
    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    // Clean up
    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', handleResize);
      
      container.removeEventListener('pointerdown', onPointerDown);
      container.removeEventListener('pointermove', onPointerMove);
      container.removeEventListener('pointerup', onPointerUp);
      container.removeEventListener('pointercancel', onPointerUp);
      container.removeEventListener('pointerenter', onPointerEnter);
      container.removeEventListener('pointerleave', onPointerLeave);

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
      {/* Decorative hud corners */}
      <div className="absolute top-3 left-3 w-3 h-3 border-t border-l border-[#38bdf8]/40" />
      <div className="absolute top-3 right-3 w-3 h-3 border-t border-r border-[#38bdf8]/40" />
      <div className="absolute bottom-3 left-3 w-3 h-3 border-b border-l border-[#38bdf8]/40" />
      <div className="absolute bottom-3 right-3 w-3 h-3 border-b border-r border-[#38bdf8]/40" />
      
      {/* Grid crosshair backdrop */}
      <div className="absolute inset-0 pointer-events-none z-0 bg-[radial-gradient(circle_at_center,transparent_45%,rgba(5,11,26,0.5))] opacity-80" />
      <div 
        className="absolute inset-0 pointer-events-none z-0 opacity-15"
        style={{
          backgroundImage: `
            repeating-linear-gradient(0deg, #38bdf8 0px, #38bdf8 1px, transparent 1px, transparent 20px),
            repeating-linear-gradient(90deg, #38bdf8 0px, #38bdf8 1px, transparent 1px, transparent 20px)
          `
        }}
      />
    </div>
  );
};
