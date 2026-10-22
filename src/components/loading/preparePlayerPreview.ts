import type * as THREE from 'three';

/** Keep first draw off the synchronous shader-compilation path. */
export function createPlayerPreviewPreparation({ renderer, scene, camera, onReady, onError, dispose }: {
  renderer: Pick<THREE.WebGLRenderer, 'compileAsync'>;
  scene: THREE.Scene;
  camera: THREE.Camera;
  onReady: () => void;
  onError: (error: unknown) => void;
  dispose: () => void;
}) {
  let active = true;
  let compiling = false;
  let disposed = false;
  const disposeOnce = () => { if (!disposed) { disposed = true; dispose(); } };
  return {
    async prepare(character: THREE.Object3D) {
      const assets: Promise<unknown>[] = [];
      character.traverse(object => {
        if (object.userData.assetReady) assets.push(object.userData.assetReady);
      });
      try {
        await Promise.all(assets);
        if (!active) return;
        compiling = true;
        await renderer.compileAsync(scene, camera);
        if (active) onReady();
      } catch (error) {
        if (active) onError(error);
      } finally {
        compiling = false;
        if (!active) disposeOnce();
      }
    },
    stop() {
      active = false;
      // Three's compileAsync still polls its programs. Destroying them before
      // it settles can leave the poll running against deleted GL handles.
      if (!compiling) disposeOnce();
    },
  };
}
