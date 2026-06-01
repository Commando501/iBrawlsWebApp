import * as THREE from 'three';

export const whiteBlinkMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });

export const updateInvulnerabilityBlinking = ({
  group,
  active,
  skipMeshes = [],
  blinkMaterial = whiteBlinkMaterial,
  blinkCycle = Math.floor(performance.now() / 120) % 2 === 0,
}: {
  group: THREE.Group | null;
  active: boolean;
  skipMeshes?: readonly (THREE.Mesh | null | undefined)[];
  blinkMaterial?: THREE.Material;
  blinkCycle?: boolean;
}) => {
  if (!group) return;

  const isAlreadyBlinking = group.userData.isBlinking === true;
  const shouldShowBlink = active && blinkCycle;

  if (!active && !isAlreadyBlinking) {
    return;
  }

  group.userData.isBlinking = active;

  group.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      if (skipMeshes.includes(child)) {
        return;
      }

      if (!child.userData.originalMaterial) {
        child.userData.originalMaterial = child.material;
      }

      if (shouldShowBlink) {
        child.material = blinkMaterial;
      } else {
        child.material = child.userData.originalMaterial;
      }
    }
  });
};
