/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Maximize2 } from 'lucide-react';
import { 
  CharacterLoadout, 
  DEFAULT_LOADOUT, 
  ArmorPaintJob, 
  VoxelData, 
  getVoxelSegmentData, 
  createBeveledBoxGeometry 
} from './VoxelModels';

interface CharacterPainterProps {
  loadout: CharacterLoadout;
  hue?: number;
  onSave: (paintJob: ArmorPaintJob) => void;
  onCancel: () => void;
}

type PaintablePart = 'helmet' | 'torso' | 'leftArm' | 'rightArm' | 'leftLeg' | 'rightLeg';
type CameraTargetPart = PaintablePart | 'all';
type PaintEditorFrameId = 'viewport' | 'tools';
type PaintEditorFrameScales = Record<PaintEditorFrameId, number>;

const CAMERA_FOV_DEGREES = 40;
const DEFAULT_CAMERA_YAW = 0;
const DEFAULT_CAMERA_PITCH = 0.05;
const PAINT_EDITOR_FRAME_SCALE_STORAGE_KEY = 'ibrawls_paint_editor_frame_scale_v1';
const PAINT_EDITOR_FRAME_SCALE_MIN = 0.75;
const PAINT_EDITOR_FRAME_SCALE_MAX = 1.45;
const DEFAULT_PAINT_EDITOR_FRAME_SCALES: PaintEditorFrameScales = {
  viewport: 1,
  tools: 1,
};

const clampPaintEditorFrameScale = (scale: number) => (
  Math.round(Math.min(PAINT_EDITOR_FRAME_SCALE_MAX, Math.max(PAINT_EDITOR_FRAME_SCALE_MIN, scale)) * 100) / 100
);

const clampPaintEditorFrameScales = (
  scales: Partial<PaintEditorFrameScales> | null | undefined
): PaintEditorFrameScales => ({
  viewport: clampPaintEditorFrameScale(scales?.viewport ?? DEFAULT_PAINT_EDITOR_FRAME_SCALES.viewport),
  tools: clampPaintEditorFrameScale(scales?.tools ?? DEFAULT_PAINT_EDITOR_FRAME_SCALES.tools),
});

const CAMERA_TARGET_FALLBACKS: Record<CameraTargetPart, { lookAt: [number, number, number]; distance: number }> = {
  all: { lookAt: [0, 0.9, 0], distance: 3.2 },
  helmet: { lookAt: [0, 1.8, 0], distance: 1.15 },
  torso: { lookAt: [0, 1.0, 0], distance: 1.4 },
  leftArm: { lookAt: [-0.25, 1.0, 0], distance: 1.15 },
  rightArm: { lookAt: [0.25, 1.0, 0], distance: 1.15 },
  leftLeg: { lookAt: [-0.11, 0.36, 0], distance: 1.15 },
  rightLeg: { lookAt: [0.11, 0.36, 0], distance: 1.15 },
};

export const CharacterPainter: React.FC<CharacterPainterProps> = ({ 
  loadout, 
  hue = 200, 
  onSave, 
  onCancel 
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const paintFrameScalesRef = useRef<PaintEditorFrameScales>(DEFAULT_PAINT_EDITOR_FRAME_SCALES);
  const [paintFrameScales, setPaintFrameScales] = useState<PaintEditorFrameScales>(() => {
    try {
      const saved = localStorage.getItem(PAINT_EDITOR_FRAME_SCALE_STORAGE_KEY);
      const initial = saved ? clampPaintEditorFrameScales(JSON.parse(saved)) : DEFAULT_PAINT_EDITOR_FRAME_SCALES;
      paintFrameScalesRef.current = initial;
      return initial;
    } catch (error) {
      console.error('Failed to load paint editor frame scales:', error);
      return DEFAULT_PAINT_EDITOR_FRAME_SCALES;
    }
  });

  // --- UI Tools State ---
  const [activeColor, setActiveColor] = useState<string>('#38bdf8');
  const [activeTool, setActiveTool] = useState<'brush' | 'eraser' | 'fill' | 'move'>('brush');
  const [brushSize, setBrushSize] = useState<number>(1);
  const [isNeon, setIsNeon] = useState<boolean>(false);
  const [mirrorEnabled, setMirrorEnabled] = useState<boolean>(true);
  const [selectedPart, setSelectedPart] = useState<CameraTargetPart>('all');

  useEffect(() => {
    paintFrameScalesRef.current = paintFrameScales;
  }, [paintFrameScales]);

  const persistPaintFrameScales = useCallback((scales: PaintEditorFrameScales) => {
    try {
      localStorage.setItem(PAINT_EDITOR_FRAME_SCALE_STORAGE_KEY, JSON.stringify(scales));
    } catch (error) {
      console.error('Failed to save paint editor frame scales:', error);
    }
  }, []);

  const applyPaintFrameScales = useCallback((scales: PaintEditorFrameScales, shouldPersist = true) => {
    const next = clampPaintEditorFrameScales(scales);
    paintFrameScalesRef.current = next;
    setPaintFrameScales(next);
    if (shouldPersist) {
      persistPaintFrameScales(next);
    }
  }, [persistPaintFrameScales]);

  const handlePaintFrameScalePointerDown = useCallback((
    frameId: PaintEditorFrameId,
    event: React.PointerEvent<HTMLButtonElement>
  ) => {
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    const startScale = paintFrameScalesRef.current[frameId];
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;

    event.preventDefault();
    event.stopPropagation();
    document.body.style.cursor = 'nwse-resize';
    document.body.style.userSelect = 'none';

    const handleWindowPointerMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      const dragDelta = (moveEvent.clientX - startX + moveEvent.clientY - startY) / 520;
      applyPaintFrameScales({
        ...paintFrameScalesRef.current,
        [frameId]: clampPaintEditorFrameScale(startScale + dragDelta),
      }, false);
    };

    const handleWindowPointerUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      persistPaintFrameScales(paintFrameScalesRef.current);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener('pointermove', handleWindowPointerMove);
      window.removeEventListener('pointerup', handleWindowPointerUp);
      window.removeEventListener('pointercancel', handleWindowPointerUp);
    };

    window.addEventListener('pointermove', handleWindowPointerMove);
    window.addEventListener('pointerup', handleWindowPointerUp);
    window.addEventListener('pointercancel', handleWindowPointerUp);
  }, [applyPaintFrameScales, persistPaintFrameScales]);

  // Top level camera zoom state refs (so they can be reset when pan/zoom is reset)
  const zoomDistanceRef = useRef<number>(3.2);
  const targetZoomDistanceRef = useRef<number>(3.2);

  // --- Active Paint Job State ---
  const [paintJob, setPaintJob] = useState<ArmorPaintJob>(() => {
    return loadout.paintJob ? JSON.parse(JSON.stringify(loadout.paintJob)) : {
      helmet: {}, torso: {}, leftArm: {}, rightArm: {}, leftLeg: {}, rightLeg: {},
      emissive: { helmet: {}, torso: {}, leftArm: {}, rightArm: {}, leftLeg: {}, rightLeg: {} },
      baseColors: {}
    };
  });

  // Keep state refs in sync for WebGL loop
  const stateRef = useRef({ 
    activeColor, 
    activeTool, 
    brushSize, 
    isNeon, 
    mirrorEnabled, 
    selectedPart, 
    paintJob 
  });
  useEffect(() => {
    stateRef.current = { 
      activeColor, 
      activeTool, 
      brushSize, 
      isNeon, 
      mirrorEnabled, 
      selectedPart, 
      paintJob 
    };
  }, [activeColor, activeTool, brushSize, isNeon, mirrorEnabled, selectedPart, paintJob]);

  // --- Sci-Fi Themes ---
  const curatedThemes = [
    { name: 'Master Chief', primary: '#344e41', description: 'Spartan green' },
    { name: 'Covenant', primary: '#5b3256', description: 'Elite plasma' },
    { name: 'Synthwave', primary: '#ff007f', description: 'Retro neon pink' },
    { name: 'Cyberpunk', primary: '#ffe600', description: 'Industrial yellow' },
    { name: 'N7', primary: '#1c1c1c', description: 'Carbon black' },
    { name: 'Blue Angel', primary: '#38bdf8', description: 'Cyan accent' }
  ];

  // --- Three.js Refs & Setup ---
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const characterContainerRef = useRef<THREE.Group | null>(null);
  
  // Track camera target lookAt
  const cameraLookAtRef = useRef<THREE.Vector3>(new THREE.Vector3(0, 0.9, 0));
  const targetCameraLookAtRef = useRef<THREE.Vector3>(new THREE.Vector3(0, 0.9, 0));
  const cameraYawRef = useRef<number>(0);
  const targetCameraYawRef = useRef<number>(0);
  const cameraPitchRef = useRef<number>(0.05);
  const targetCameraPitchRef = useRef<number>(0.05);

  // Voxel meshes group for raycasting
  const voxelMeshesRef = useRef<THREE.Mesh[]>([]);

  // Pivot configurations matching VoxelModels.ts
  const PIVOTS: Record<PaintablePart, { x: number, y: number, z: number, px: number, py: number, pz: number, parent: 'upper' | 'lower' | 'root' }> = {
    helmet:   { x: 0,    y: 35, z: 0, px: 0,    py: 35, pz: 0, parent: 'upper' },
    torso:    { x: 0,    y: 11, z: 0, px: 0,    py: 11, pz: 0, parent: 'upper' },
    leftArm:  { x: -5.5, y: 25, z: 0, px: -5.5, py: 25, pz: 0, parent: 'upper' },
    rightArm: { x: 5.5,  y: 25, z: 0, px: 5.5,  py: 25, pz: 0, parent: 'upper' },
    leftLeg:  { x: -2.5, y: 17, z: 0, px: -2.5, py: 17, pz: 0, parent: 'lower' },
    rightLeg: { x: 2.5,  y: 17, z: 0, px: 2.5,  py: 17, pz: 0, parent: 'lower' },
  };

  // Preset slots in loadout
  const presetSlots: Record<PaintablePart, string> = {
    helmet: loadout.helmet ?? 'mark-vi',
    torso: loadout.torso ?? 'mark-vi',
    leftArm: loadout.arm ?? 'mark-vi',
    rightArm: loadout.arm ?? 'mark-vi',
    leftLeg: loadout.leg ?? 'mark-vi',
    rightLeg: loadout.leg ?? 'mark-vi',
  };

  // --- Reset Actions ---
  const handleReset = () => {
    const active = stateRef.current.selectedPart;
    setPaintJob(prev => {
      const next = { ...prev };
      if (active === 'all') {
        // Full Reset
        next.helmet = {};
        next.torso = {};
        next.leftArm = {};
        next.rightArm = {};
        next.leftLeg = {};
        next.rightLeg = {};
        next.baseColors = {};
        next.emissive = { helmet: {}, torso: {}, leftArm: {}, rightArm: {}, leftLeg: {}, rightLeg: {} };
      } else {
        // Part Reset
        const slot = active as keyof ArmorPaintJob;
        if (next[slot]) {
          next[slot] = {};
        }
        if (next.baseColors && next.baseColors[slot]) {
          delete next.baseColors[slot];
        }
        if (next.emissive && next.emissive[slot]) {
          next.emissive[slot] = {};
        }
      }
      return next;
    });

    // Reset material colors of meshes back to original presets
    voxelMeshesRef.current.forEach(mesh => {
      const { slot } = mesh.userData;
      if (active === 'all' || active === slot) {
        mesh.userData.colorOverride = null;
        mesh.userData.emissiveOverride = null;
        const colorVal = mesh.userData.originalColor;
        const isEmissive = mesh.userData.originalEmissive;
        
        if (isEmissive) {
          (mesh.material as THREE.MeshStandardMaterial).color.set(colorVal);
          (mesh.material as THREE.MeshStandardMaterial).emissive.set(colorVal);
          (mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 2.5;
        } else {
          (mesh.material as THREE.MeshStandardMaterial).color.set(colorVal);
          (mesh.material as THREE.MeshStandardMaterial).emissive.setHex(0x000000);
          (mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0;
        }
      }
    });
  };

  // --- Save / Cancel Action ---
  const handleSave = () => {
    onSave(paintJob);
  };

  const renderPaintFrameScaleHandle = (
    frameId: PaintEditorFrameId,
    label: string,
    scale: number
  ) => (
    <button
      type="button"
      aria-label={`Scale ${label} frame`}
      title={`Drag to scale ${label} frame`}
      onPointerDown={(event) => handlePaintFrameScalePointerDown(frameId, event)}
      onPointerUp={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      className="absolute right-2 bottom-2 z-30 h-8 min-w-16 px-2 rounded-lg border border-cyan-400/45 bg-slate-950/85 text-cyan-200 shadow-[0_0_12px_rgba(34,211,238,0.22)] hover:border-cyan-300 hover:text-white cursor-nwse-resize flex items-center justify-center gap-1.5 text-[9px] font-mono font-black tabular-nums transition-colors"
    >
      <Maximize2 className="w-3 h-3" />
      {Math.round(scale * 100)}%
    </button>
  );

  const viewportFrameStyle: React.CSSProperties = {
    flexGrow: paintFrameScales.viewport,
    height: `clamp(380px, ${Math.round(600 * paintFrameScales.viewport)}px, 870px)`,
    minWidth: 0,
  };

  const toolsFrameStyle: React.CSSProperties = {
    width: `min(100%, ${Math.round(310 * paintFrameScales.tools)}px)`,
    height: `clamp(420px, ${Math.round(600 * paintFrameScales.tools)}px, 870px)`,
    overflowY: 'auto',
  };

  const getCameraTargetFrame = (part: CameraTargetPart) => {
    const fallback = CAMERA_TARGET_FALLBACKS[part];
    const fallbackFrame = {
      lookAt: new THREE.Vector3(...fallback.lookAt),
      distance: fallback.distance,
    };
    const meshes = part === 'all'
      ? voxelMeshesRef.current
      : voxelMeshesRef.current.filter(mesh => mesh.userData.slot === part);

    if (!characterContainerRef.current || meshes.length === 0) {
      return fallbackFrame;
    }

    characterContainerRef.current.updateWorldMatrix(true, true);
    const bounds = new THREE.Box3();
    meshes.forEach(mesh => bounds.expandByObject(mesh));

    if (bounds.isEmpty()) {
      return fallbackFrame;
    }

    const size = bounds.getSize(new THREE.Vector3());
    const lookAt = bounds.getCenter(new THREE.Vector3());
    const maxDimension = Math.max(size.x, size.y, size.z);
    const padding = part === 'all' ? 1.36 : 1.48;
    const fitDistance = (maxDimension * padding) / (2 * Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV_DEGREES / 2)));
    const minDistance = part === 'all' ? 2.85 : 0.95;
    const maxDistance = part === 'all' ? 3.7 : 2.45;

    return {
      lookAt,
      distance: THREE.MathUtils.clamp(fitDistance, minDistance, maxDistance),
    };
  };

  // --- Camera focus navigation skeleton handler ---
  const navigateToPart = (part: CameraTargetPart) => {
    setSelectedPart(part);
    targetCameraYawRef.current = DEFAULT_CAMERA_YAW;
    targetCameraPitchRef.current = DEFAULT_CAMERA_PITCH;
    if (characterContainerRef.current) {
      characterContainerRef.current.position.set(0, 0, 0); // Reset translation panned position
      characterContainerRef.current.rotation.set(0, 0, 0);
    }

    const frame = getCameraTargetFrame(part);
    targetCameraLookAtRef.current.copy(frame.lookAt);
    targetZoomDistanceRef.current = frame.distance;
  };

  // --- Paint Can Segment Flood ---
  const floodFillSegment = (slot: string, color: string, emissive: boolean) => {
    setPaintJob(prev => {
      const next = { ...prev };
      next.baseColors = next.baseColors || {};
      next.baseColors[slot as keyof typeof next.baseColors] = color;
      
      // Clear individual overrides for this segment to keep storage light
      const slotKey = slot as keyof ArmorPaintJob;
      if (next[slotKey]) {
        next[slotKey] = {};
      }
      if (next.emissive && next.emissive[slotKey]) {
        next.emissive[slotKey] = {};
      }
      return next;
    });

    // Color all meshes in this slot
    voxelMeshesRef.current.forEach(mesh => {
      if (mesh.userData.slot === slot) {
        mesh.userData.colorOverride = color;
        mesh.userData.emissiveOverride = emissive;
        
        const mat = mesh.material as THREE.MeshStandardMaterial;
        mat.color.set(color);
        if (emissive) {
          mat.emissive.set(color);
          mat.emissiveIntensity = 2.5;
        } else {
          mat.emissive.setHex(0x000000);
          mat.emissiveIntensity = 0;
        }
      }
    });
  };

  // --- Three.js Mounting & Raycasting Logic ---
  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;

    const width = container.clientWidth || 300;
    const height = container.clientHeight || 380;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
    camera.position.set(0, 1.0, 3.2);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Lighting
    const ambientLight = new THREE.AmbientLight('#ffffff', 0.7);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight('#ffffff', 1.4);
    dirLight.position.set(5, 10, 5);
    dirLight.castShadow = true;
    scene.add(dirLight);

    const spotLight = new THREE.SpotLight('#38bdf8', 1.8, 10, Math.PI / 6, 0.5, 1);
    spotLight.position.set(-3, 6, 3);
    scene.add(spotLight);

    const fillLight = new THREE.PointLight('#ffffff', 0.6, 8);
    fillLight.position.set(3, 3, 2);
    scene.add(fillLight);




    // Spartan Character Container
    const characterContainer = new THREE.Group();
    scene.add(characterContainer);
    characterContainerRef.current = characterContainer;

    const lowerTorsoGroup = new THREE.Group();
    const upperTorsoGroup = new THREE.Group();
    characterContainer.add(lowerTorsoGroup);
    characterContainer.add(upperTorsoGroup);

    const scale = 0.045;
    const bevelRadius = scale * 0.15;
    const baseBeveledGeo = createBeveledBoxGeometry(scale, scale, scale, bevelRadius);

    voxelMeshesRef.current = [];

    // --- Instantiate Voxel Meshes Individually ---
    (Object.keys(PIVOTS) as PaintablePart[]).forEach(slot => {
      const preset = presetSlots[slot];
      const voxels = getVoxelSegmentData(slot, preset, hue);
      const pivot = PIVOTS[slot];

      // Load paint job custom colors / emissives
      const customColors = paintJob[slot as keyof ArmorPaintJob] as { [key: string]: string } | undefined;
      const customEmissives = paintJob.emissive?.[slot as keyof typeof paintJob.emissive] as { [key: string]: boolean } | undefined;
      const baseColor = paintJob.baseColors?.[slot as keyof typeof paintJob.baseColors];

      // Segment offset position
      const segmentGroup = new THREE.Group();
      if (pivot.parent === 'upper') {
        segmentGroup.position.set(pivot.x * scale, (pivot.y - 11) * scale, 0);
        upperTorsoGroup.add(segmentGroup);
      } else {
        segmentGroup.position.set(pivot.x * scale, pivot.y * scale, 0);
        lowerTorsoGroup.add(segmentGroup);
      }

      voxels.forEach(v => {
        // Compute active paint state
        let colorStr = v.color;
        let isEmissive = v.emissive || false;

        if (baseColor && !v.emissive) {
          colorStr = baseColor;
        }
        if (customColors && customColors[`${v.x},${v.y},${v.z}`] !== undefined) {
          colorStr = customColors[`${v.x},${v.y},${v.z}`];
        }
        if (customEmissives && customEmissives[`${v.x},${v.y},${v.z}`] !== undefined) {
          isEmissive = customEmissives[`${v.x},${v.y},${v.z}`];
        }

        const material = new THREE.MeshStandardMaterial({
          roughness: isEmissive ? 0.15 : 0.35,
          metalness: isEmissive ? 0.1 : 0.65,
          color: new THREE.Color(colorStr),
          emissive: isEmissive ? new THREE.Color(colorStr) : new THREE.Color(0x000000),
          emissiveIntensity: isEmissive ? 2.5 : 0
        });

        const mesh = new THREE.Mesh(baseBeveledGeo, material);
        mesh.position.set(
          (v.x - pivot.px) * scale,
          (v.y - pivot.py) * scale,
          (v.z - pivot.pz) * scale
        );
        mesh.castShadow = true;
        mesh.receiveShadow = true;

        // Custom metadata mapping
        mesh.userData = {
          slot,
          x: v.x,
          y: v.y,
          z: v.z,
          originalColor: v.color,
          originalEmissive: v.emissive || false,
          colorOverride: customColors?.[`${v.x},${v.y},${v.z}`] || (baseColor && !v.emissive ? baseColor : null),
          emissiveOverride: customEmissives?.[`${v.x},${v.y},${v.z}`] || null
        };

        segmentGroup.add(mesh);
        voxelMeshesRef.current.push(mesh);
      });
    });

    upperTorsoGroup.position.set(0, 11 * scale, 0);

    // --- Hover Highlighter Grid Voxel Outline ---
    const hoverGeo = new THREE.BoxGeometry(scale * 1.05, scale * 1.05, scale * 1.05);
    const hoverMat = new THREE.MeshBasicMaterial({ color: 0x00f3ff, wireframe: true, transparent: true, opacity: 0.6 });
    const hoverHighlight = new THREE.Mesh(hoverGeo, hoverMat);
    hoverHighlight.visible = false;
    scene.add(hoverHighlight);

    // --- Mouse & Touch Controls Logic ---
    type CameraDragMode = 'orbit' | 'pan';
    let isDragging = false;
    let pointerMoved = false;
    let dragMode: CameraDragMode = 'orbit';
    let activeButton = 0;
    let startPointerX = 0;
    let startPointerY = 0;
    let previousPointerX = 0;
    let previousPointerY = 0;
    const clickMoveThreshold = 5;

    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    const getRaycastIntersect = (e: MouseEvent | PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObjects(voxelMeshesRef.current);
      return intersects.length > 0 ? intersects[0] : null;
    };

    // Apply color paint to mesh
    const paintSingleVoxelMesh = (
      mesh: THREE.Mesh, 
      color: string, 
      emissive: boolean, 
      tool: 'brush' | 'eraser'
    ) => {
      const { slot, x, y, z, originalColor, originalEmissive } = mesh.userData;
      
      let finalColor = color;
      let finalEmissive = emissive;

      if (tool === 'eraser') {
        finalColor = originalColor;
        finalEmissive = originalEmissive;
      }

      mesh.userData.colorOverride = tool === 'eraser' ? null : finalColor;
      mesh.userData.emissiveOverride = tool === 'eraser' ? null : finalEmissive;

      const mat = mesh.material as THREE.MeshStandardMaterial;
      mat.color.set(finalColor);
      if (finalEmissive) {
        mat.emissive.set(finalColor);
        mat.emissiveIntensity = 2.5;
        mat.roughness = 0.15;
        mat.metalness = 0.1;
      } else {
        mat.emissive.setHex(0x000000);
        mat.emissiveIntensity = 0;
        mat.roughness = 0.35;
        mat.metalness = 0.65;
      }

      // Update State Dicts
      setPaintJob(prev => {
        const next = { ...prev };
        next[slot as keyof ArmorPaintJob] = next[slot as keyof ArmorPaintJob] || {};
        next.emissive = next.emissive || {};
        next.emissive[slot as keyof typeof next.emissive] = next.emissive[slot as keyof typeof next.emissive] || {};

        const key = `${x},${y},${z}`;

        if (tool === 'eraser') {
          const dict = next[slot as keyof ArmorPaintJob] as Record<string, string>;
          delete dict[key];
          
          const emDict = next.emissive[slot as keyof typeof next.emissive] as Record<string, boolean>;
          delete emDict[key];
        } else {
          const dict = next[slot as keyof ArmorPaintJob] as Record<string, string>;
          dict[key] = finalColor;

          const emDict = next.emissive[slot as keyof typeof next.emissive] as Record<string, boolean>;
          emDict[key] = finalEmissive;
        }

        return next;
      });

      // Mirror paint option (only for arms and legs)
      const mirror = stateRef.current.mirrorEnabled;
      if (mirror && (slot === 'leftArm' || slot === 'rightArm' || slot === 'leftLeg' || slot === 'rightLeg')) {
        const mirroredSlot = slot.startsWith('left') 
          ? slot.replace('left', 'right') 
          : slot.replace('right', 'left');
          
        const targetMirrorX = -x;
        
        // Find mirrored mesh in Scene
        const mirroredMesh = voxelMeshesRef.current.find(m => 
          m.userData.slot === mirroredSlot && 
          m.userData.x === targetMirrorX && 
          m.userData.y === y && 
          m.userData.z === z
        );

        if (mirroredMesh) {
          mirroredMesh.userData.colorOverride = tool === 'eraser' ? null : finalColor;
          mirroredMesh.userData.emissiveOverride = tool === 'eraser' ? null : finalEmissive;

          const mirroredMat = mirroredMesh.material as THREE.MeshStandardMaterial;
          mirroredMat.color.set(finalColor);
          if (finalEmissive) {
            mirroredMat.emissive.set(finalColor);
            mirroredMat.emissiveIntensity = 2.5;
            mirroredMat.roughness = 0.15;
            mirroredMat.metalness = 0.1;
          } else {
            mirroredMat.emissive.setHex(0x000000);
            mirroredMat.emissiveIntensity = 0;
            mirroredMat.roughness = 0.35;
            mirroredMat.metalness = 0.65;
          }

          setPaintJob(prev => {
            const next = { ...prev };
            next[mirroredSlot as keyof ArmorPaintJob] = next[mirroredSlot as keyof ArmorPaintJob] || {};
            next.emissive = next.emissive || {};
            next.emissive[mirroredSlot as keyof typeof next.emissive] = next.emissive[mirroredSlot as keyof typeof next.emissive] || {};

            const mirrorKey = `${targetMirrorX},${y},${z}`;

            if (tool === 'eraser') {
              const dict = next[mirroredSlot as keyof ArmorPaintJob] as Record<string, string>;
              delete dict[mirrorKey];
              
              const emDict = next.emissive[mirroredSlot as keyof typeof next.emissive] as Record<string, boolean>;
              delete emDict[mirrorKey];
            } else {
              const dict = next[mirroredSlot as keyof ArmorPaintJob] as Record<string, string>;
              dict[mirrorKey] = finalColor;

              const emDict = next.emissive[mirroredSlot as keyof typeof next.emissive] as Record<string, boolean>;
              emDict[mirrorKey] = finalEmissive;
            }

            return next;
          });
        }
      }
    };

    const applyPaintClick = (e: PointerEvent) => {
      const intersect = getRaycastIntersect(e);
      const tool = stateRef.current.activeTool;

      if (tool === 'fill') {
        if (intersect) {
          floodFillSegment(intersect.object.userData.slot, stateRef.current.activeColor, stateRef.current.isNeon);
        }
        return;
      }

      if ((tool === 'brush' || tool === 'eraser') && intersect) {
        paintSingleVoxelMesh(
          intersect.object as THREE.Mesh,
          stateRef.current.activeColor,
          stateRef.current.isNeon,
          tool
        );
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      isDragging = true;
      pointerMoved = false;
      activeButton = e.button;
      startPointerX = e.clientX;
      startPointerY = e.clientY;
      previousPointerX = e.clientX;
      previousPointerY = e.clientY;

      const tool = stateRef.current.activeTool;
      dragMode = e.button === 1 || e.button === 2 || e.shiftKey || tool === 'move' ? 'pan' : 'orbit';
      renderer.domElement.style.cursor = dragMode === 'pan' ? 'grabbing' : 'move';
      e.preventDefault();

      renderer.domElement.setPointerCapture(e.pointerId);
    };

    const onPointerMove = (e: PointerEvent) => {
      const intersect = getRaycastIntersect(e);
      
      // Update Hover Highlight wireframe box (skip when in Mover tool)
      if (intersect && stateRef.current.activeTool !== 'fill' && stateRef.current.activeTool !== 'move') {
        const mesh = intersect.object as THREE.Mesh;
        hoverHighlight.position.copy(mesh.getWorldPosition(new THREE.Vector3()));
        hoverHighlight.quaternion.copy(mesh.getWorldQuaternion(new THREE.Quaternion()));
        hoverHighlight.visible = true;
      } else {
        hoverHighlight.visible = false;
      }

      if (isDragging) {
        const deltaX = e.clientX - previousPointerX;
        const deltaY = e.clientY - previousPointerY;
        previousPointerX = e.clientX;
        previousPointerY = e.clientY;
        if (Math.hypot(e.clientX - startPointerX, e.clientY - startPointerY) > clickMoveThreshold) {
          pointerMoved = true;
        }

        if (dragMode === 'pan') {
          const forward = new THREE.Vector3();
          const right = new THREE.Vector3();
          const up = new THREE.Vector3();
          camera.getWorldDirection(forward);
          right.crossVectors(forward, camera.up).normalize();
          up.crossVectors(right, forward).normalize();
          const panScale = zoomDistanceRef.current * 0.0014;
          targetCameraLookAtRef.current.addScaledVector(right, -deltaX * panScale);
          targetCameraLookAtRef.current.addScaledVector(up, deltaY * panScale);
          return;
        }

        if (dragMode === 'orbit') {
          targetCameraYawRef.current -= deltaX * 0.006;
          targetCameraPitchRef.current = THREE.MathUtils.clamp(
            targetCameraPitchRef.current - deltaY * 0.006,
            -1.25,
            1.25
          );
          return;
        }

      }
    };

    const onPointerUp = (e: PointerEvent) => {
      if (isDragging) {
        isDragging = false;
        renderer.domElement.style.cursor = 'grab';
        if (
          activeButton === 0 &&
          !pointerMoved &&
          Math.hypot(e.clientX - startPointerX, e.clientY - startPointerY) <= clickMoveThreshold
        ) {
          applyPaintClick(e);
        }
        try { renderer.domElement.releasePointerCapture(e.pointerId); } catch {}
      }
    };

    // Zoom mouse wheel zoom handler
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      targetZoomDistanceRef.current = THREE.MathUtils.clamp(
        targetZoomDistanceRef.current * Math.exp(e.deltaY * 0.001),
        0.6,
        4.5
      );
    };

    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    renderer.domElement.style.touchAction = 'none';
    renderer.domElement.style.cursor = 'grab';
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('pointercancel', onPointerUp);
    renderer.domElement.addEventListener('wheel', onWheel, { passive: false });
    renderer.domElement.addEventListener('contextmenu', onContextMenu);

    // --- WebGL Animation & Camera Lerp Loop ---
    const clock = new THREE.Clock();
    let animationFrameId: number;

    const animate = () => {
      // 1. Smoothly Zoom Camera
      zoomDistanceRef.current = THREE.MathUtils.lerp(zoomDistanceRef.current, targetZoomDistanceRef.current, 0.08);

      // Compute targeted camera look at position
      cameraLookAtRef.current.lerp(targetCameraLookAtRef.current, 0.08);
      cameraYawRef.current = THREE.MathUtils.lerp(cameraYawRef.current, targetCameraYawRef.current, 0.16);
      cameraPitchRef.current = THREE.MathUtils.lerp(cameraPitchRef.current, targetCameraPitchRef.current, 0.16);

      const cosPitch = Math.cos(cameraPitchRef.current);
      const camPos = new THREE.Vector3(
        cameraLookAtRef.current.x + Math.sin(cameraYawRef.current) * cosPitch * zoomDistanceRef.current,
        cameraLookAtRef.current.y + Math.sin(cameraPitchRef.current) * zoomDistanceRef.current,
        cameraLookAtRef.current.z + Math.cos(cameraYawRef.current) * cosPitch * zoomDistanceRef.current
      );

      camera.position.lerp(camPos, 0.18);
      camera.lookAt(cameraLookAtRef.current);

      // 2. Pulse emissive neon glowing voxels
      const elapsed = clock.getElapsedTime();
      voxelMeshesRef.current.forEach(mesh => {
        const mat = mesh.material as THREE.MeshStandardMaterial;
        const isEmissive = mesh.userData.emissiveOverride !== null 
          ? mesh.userData.emissiveOverride 
          : mesh.userData.originalEmissive;
          
        if (isEmissive) {
          mat.emissiveIntensity = 2.0 + Math.sin(elapsed * 4.0) * 0.8;
        }
      });

      renderer.render(scene, camera);
      animationFrameId = requestAnimationFrame(animate);
    };

    animate();

    // Resize Handler
    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);
    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(handleResize)
      : null;
    resizeObserver?.observe(container);
    handleResize();

    // --- Cleanup Engine ---
    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', handleResize);
      resizeObserver?.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('pointercancel', onPointerUp);
      renderer.domElement.removeEventListener('wheel', onWheel);
      renderer.domElement.removeEventListener('contextmenu', onContextMenu);
      
      if (container && renderer.domElement && container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      
      renderer.dispose();
      baseBeveledGeo.dispose();
      hoverGeo.dispose();
      hoverMat.dispose();
    };
  }, [hue]);

  return (
    <div className="w-full h-full flex flex-col md:flex-row gap-4 text-white p-3 font-sans relative">
      
      {/* 3D Viewport Area */}
      <div 
        ref={containerRef}
        className="flex-1 h-[500px] md:h-[600px] rounded-xl border border-white/10 bg-slate-950/70 relative overflow-hidden shadow-2xl cursor-crosshair select-none"
        style={viewportFrameStyle}
      >
        {/* Glowing cyber grid decoration */}
        <div className="absolute inset-0 pointer-events-none z-0 bg-[radial-gradient(circle_at_center,transparent_40%,rgba(3,7,18,0.7))] opacity-80" />
        <div
          className="absolute inset-0 pointer-events-none z-0 opacity-10"
          style={{
            backgroundImage: `
              repeating-linear-gradient(0deg, #38bdf8 0px, #38bdf8 1px, transparent 1px, transparent 15px),
              repeating-linear-gradient(90deg, #38bdf8 0px, #38bdf8 1px, transparent 1px, transparent 15px)
            `,
          }}
        />

        {/* Viewport Floating Diagnostics Indicators */}
        <div className="absolute top-3 right-3 pointer-events-none font-mono text-[9px] text-[#38bdf8]/60 bg-black/40 border border-white/5 rounded px-2.5 py-1 flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span>PAINT_SESSION_ACTIVE (3D)</span>
        </div>

        {/* HIGH-TECH VECTOR SVG NAVIGATION SKELETON (TOP LEFT) */}
        <div 
          className="absolute top-3 left-3 bg-black/60 border border-white/10 rounded-xl p-3 shadow-lg flex flex-col items-center gap-2 z-10"
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <span className="text-[8px] font-mono font-bold tracking-wider text-[#38bdf8] uppercase">CAM TARGET</span>
          
          <svg width="65" height="110" viewBox="0 0 100 160" className="drop-shadow-[0_0_8px_rgba(56,189,248,0.4)]">
            {/* Outline Glow Skeleton */}
            
            {/* Helmet (Head Zone) */}
            <circle 
              cx="50" cy="20" r="13" 
              data-cam-target="helmet"
              data-selected={selectedPart === 'helmet'}
              fill={selectedPart === 'helmet' ? 'rgba(56, 189, 248, 0.3)' : 'rgba(0, 0, 0, 0.4)'} 
              stroke={selectedPart === 'helmet' ? '#38bdf8' : 'rgba(255,255,255,0.2)'} 
              strokeWidth="1.5"
              className="cursor-pointer transition-all hover:stroke-[#38bdf8]"
              onClick={() => navigateToPart('helmet')}
            />
            {/* Visor slit line */}
            <line x1="43" y1="20" x2="57" y2="20" stroke={selectedPart === 'helmet' ? '#00f3ff' : 'rgba(255,255,255,0.4)'} strokeWidth="1" pointerEvents="none" />

            {/* Torso (Chest Zone) */}
            <rect 
              x="32" y="38" width="36" height="42" rx="3"
              data-cam-target="torso"
              data-selected={selectedPart === 'torso'}
              fill={selectedPart === 'torso' ? 'rgba(56, 189, 248, 0.3)' : 'rgba(0, 0, 0, 0.4)'} 
              stroke={selectedPart === 'torso' ? '#38bdf8' : 'rgba(255,255,255,0.2)'} 
              strokeWidth="1.5"
              className="cursor-pointer transition-all hover:stroke-[#38bdf8]"
              onClick={() => navigateToPart('torso')}
            />

            {/* Left Arm Zone */}
            <rect 
              x="14" y="38" width="14" height="45" rx="2"
              data-cam-target="leftArm"
              data-selected={selectedPart === 'leftArm'}
              fill={selectedPart === 'leftArm' ? 'rgba(56, 189, 248, 0.3)' : 'rgba(0, 0, 0, 0.4)'} 
              stroke={selectedPart === 'leftArm' ? '#38bdf8' : 'rgba(255,255,255,0.2)'} 
              strokeWidth="1.5"
              className="cursor-pointer transition-all hover:stroke-[#38bdf8]"
              onClick={() => navigateToPart('leftArm')}
            />

            {/* Right Arm Zone */}
            <rect 
              x="72" y="38" width="14" height="45" rx="2"
              data-cam-target="rightArm"
              data-selected={selectedPart === 'rightArm'}
              fill={selectedPart === 'rightArm' ? 'rgba(56, 189, 248, 0.3)' : 'rgba(0, 0, 0, 0.4)'} 
              stroke={selectedPart === 'rightArm' ? '#38bdf8' : 'rgba(255,255,255,0.2)'} 
              strokeWidth="1.5"
              className="cursor-pointer transition-all hover:stroke-[#38bdf8]"
              onClick={() => navigateToPart('rightArm')}
            />

            {/* Left Leg Zone */}
            <rect 
              x="33" y="85" width="14" height="60" rx="2"
              data-cam-target="leftLeg"
              data-selected={selectedPart === 'leftLeg'}
              fill={selectedPart === 'leftLeg' ? 'rgba(56, 189, 248, 0.3)' : 'rgba(0, 0, 0, 0.4)'} 
              stroke={selectedPart === 'leftLeg' ? '#38bdf8' : 'rgba(255,255,255,0.2)'} 
              strokeWidth="1.5"
              className="cursor-pointer transition-all hover:stroke-[#38bdf8]"
              onClick={() => navigateToPart('leftLeg')}
            />

            {/* Right Leg Zone */}
            <rect 
              x="53" y="85" width="14" height="60" rx="2"
              data-cam-target="rightLeg"
              data-selected={selectedPart === 'rightLeg'}
              fill={selectedPart === 'rightLeg' ? 'rgba(56, 189, 248, 0.3)' : 'rgba(0, 0, 0, 0.4)'} 
              stroke={selectedPart === 'rightLeg' ? '#38bdf8' : 'rgba(255,255,255,0.2)'} 
              strokeWidth="1.5"
              className="cursor-pointer transition-all hover:stroke-[#38bdf8]"
              onClick={() => navigateToPart('rightLeg')}
            />
          </svg>

          {/* Reset Focus Fit */}
          <button 
            onClick={() => navigateToPart('all')}
            data-cam-target="all"
            data-selected={selectedPart === 'all'}
            className={`w-full py-1 rounded text-[9px] font-mono uppercase tracking-widest border transition-all active:scale-95 cursor-pointer ${
              selectedPart === 'all' 
                ? 'bg-[#38bdf8]/20 border-[#38bdf8] text-[#38bdf8]' 
                : 'bg-black/30 border-white/10 text-white/50 hover:text-white'
            }`}
          >
            🔎 Fit Spartan
          </button>
        </div>

        {/* Floating Quick Navigation Hints */}
        <div className="absolute bottom-3 left-3 pointer-events-none z-10 text-[9px] font-mono text-white/40 bg-black/55 border border-white/5 p-2.5 rounded-lg leading-relaxed max-w-[220px]">
          <div><strong className="text-white/70">Left Click:</strong> Paint voxel</div>
          <div><strong className="text-white/70">Left Drag:</strong> Orbit camera</div>
          <div><strong className="text-white/70">Right/Middle Drag:</strong> Pan camera</div>
          <div><strong className="text-white/70">Shift Drag:</strong> Pan camera</div>
          <div><strong className="text-white/70">Scroll:</strong> Zoom view</div>
        </div>
        {renderPaintFrameScaleHandle('viewport', '3D viewport', paintFrameScales.viewport)}
      </div>

      {/* Stylized Glassmorphic Controls Panel */}
      <div
        className="w-full md:w-[310px] shrink-0 bg-slate-950/60 border border-white/10 rounded-xl p-4 flex flex-col gap-3.5 shadow-xl h-[500px] md:h-[600px] text-xs select-none relative"
        style={toolsFrameStyle}
      >
        
        {/* Editor Title */}
        <div className="flex justify-between items-center border-b border-white/5 pb-2">
          <span className="font-bold text-sm tracking-wider text-[#38bdf8] uppercase flex items-center gap-1.5">
            🎨 Spartan Voxel Painter
          </span>
          <span className="text-[10px] font-mono text-amber-400 bg-amber-950/40 border border-amber-500/25 px-2 py-0.5 rounded">
            EDIT_MODE
          </span>
        </div>

        {/* Tools Selection Grid */}
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] font-bold text-[#38bdf8] uppercase tracking-wider block">1. Brush Tool Select</span>
          <div className="grid grid-cols-2 gap-2">
            {[
              { id: 'brush', label: '🖌️ Brush', desc: 'Single voxel/Marquee draw' },
              { id: 'eraser', label: '🧽 Eraser', desc: 'Revert voxel HSL' },
              { id: 'fill', label: '🪣 Fill Can', desc: 'Flood fill piece' },
              { id: 'move', label: '✋ Mover', desc: 'Drag to translate model' }
            ].map(tool => (
              <button
                key={tool.id}
                onClick={() => setActiveTool(tool.id as any)}
                title={tool.desc}
                className={`py-2 text-[10px] font-black uppercase tracking-wider border rounded cursor-pointer transition-all active:scale-95 ${
                  activeTool === tool.id
                    ? 'bg-[#38bdf8]/15 border-[#38bdf8] text-[#38bdf8] shadow-[0_0_10px_rgba(56,189,248,0.25)]'
                    : 'bg-black/40 border-white/10 text-white/50 hover:text-white hover:border-white/20'
                }`}
              >
                {tool.label}
              </button>
            ))}
          </div>
        </div>

        {/* Emissive / Emissive glow selector */}
        <div className="bg-white/5 border border-white/5 rounded-lg p-2.5 flex justify-between items-center">
          <div>
            <p className="font-bold text-[10px] text-[#38bdf8] uppercase tracking-wider">⚡ Neon Glow Paint</p>
            <p className="text-[9px] text-white/40">Apply glowing cybernetic overlays</p>
          </div>
          <button
            onClick={() => setIsNeon(prev => !prev)}
            className={`w-11 h-6 rounded-full p-1 cursor-pointer transition-all flex ${
              isNeon ? 'bg-cyan-400 justify-end' : 'bg-black/60 justify-start border border-white/10'
            }`}
          >
            <span className="w-4 h-4 rounded-full bg-slate-950 shadow-inner" />
          </button>
        </div>

        {/* Mirrored arm/leg check */}
        <div className="bg-white/5 border border-white/5 rounded-lg p-2.5 flex justify-between items-center">
          <div>
            <p className="font-bold text-[10px] text-[#38bdf8] uppercase tracking-wider">🪞 Mirror Arms & Legs</p>
            <p className="text-[9px] text-white/40">Auto-mirror paint across limbs</p>
          </div>
          <button
            onClick={() => setMirrorEnabled(prev => !prev)}
            className={`w-11 h-6 rounded-full p-1 cursor-pointer transition-all flex ${
              mirrorEnabled ? 'bg-cyan-400 justify-end' : 'bg-black/60 justify-start border border-white/10'
            }`}
          >
            <span className="w-4 h-4 rounded-full bg-slate-950 shadow-inner" />
          </button>
        </div>

        {/* Color Palette and Advanced Selectors */}
        <div className="flex flex-col gap-2 bg-white/5 border border-white/5 rounded-lg p-2.5">
          <div className="flex justify-between items-center">
            <span className="text-[10px] font-bold text-[#38bdf8] uppercase tracking-wider">2. Color Picker & Hex</span>
            <input 
              type="color" 
              value={activeColor}
              onChange={(e) => setActiveColor(e.target.value)}
              className="w-5 h-5 rounded cursor-pointer border border-white/10 bg-transparent"
            />
          </div>

          {/* Preset Swatches */}
          <div className="flex flex-wrap gap-1.5 justify-between">
            {curatedThemes.map(theme => (
              <button
                key={theme.name}
                onClick={() => {
                  setActiveColor(theme.primary);
                  setIsNeon(theme.name === 'Synthwave' || theme.name === 'Cyberpunk');
                }}
                title={`${theme.name} Preset color`}
                className={`w-6 h-6 rounded-full cursor-pointer border border-transparent transition-all hover:scale-105 active:scale-90 ${
                  activeColor === theme.primary ? 'ring-1 ring-cyan-400 ring-offset-1 ring-offset-slate-950 scale-110 shadow-lg' : ''
                }`}
                style={{ backgroundColor: theme.primary }}
              />
            ))}
          </div>

          {/* Advanced Hex Input */}
          <div className="flex items-center gap-1.5 border border-white/10 bg-black/40 rounded px-2 py-1 mt-1">
            <span className="text-[10px] font-mono text-white/30">HEX:</span>
            <input 
              type="text" 
              maxLength={7}
              value={activeColor}
              onChange={(e) => setActiveColor(e.target.value)}
              className="flex-1 bg-transparent border-none text-white focus:outline-none text-[11px] font-mono tracking-wider"
              placeholder="#000000"
            />
          </div>
        </div>

        {/* Smart Reset button */}
        <div className="grid grid-cols-2 gap-2 mt-1">
          <button
            onClick={handleReset}
            className="py-2 bg-red-950/20 border border-red-500/20 hover:border-red-500/40 text-red-400 hover:bg-red-500/10 font-bold uppercase tracking-wider rounded transition-all active:scale-95 cursor-pointer text-[10px] text-center"
          >
            ↻ Reset {selectedPart === 'all' ? 'Spartan' : 'Piece'}
          </button>
          
          <button
            onClick={onCancel}
            className="py-2 bg-slate-950/40 border border-white/10 hover:border-white/20 text-white/70 hover:text-white font-bold uppercase tracking-wider rounded transition-all active:scale-95 cursor-pointer text-[10px] text-center"
          >
            Cancel
          </button>
        </div>

        {/* Save Button */}
        <button
          onClick={handleSave}
          className="w-full py-2.5 bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-400 hover:to-blue-400 text-slate-950 font-black uppercase tracking-widest rounded-lg shadow-lg shadow-cyan-500/10 transition-all active:scale-[0.98] cursor-pointer text-center text-xs mt-1"
        >
          💾 Apply & Save Paint Job
        </button>
        {renderPaintFrameScaleHandle('tools', 'tools', paintFrameScales.tools)}
      </div>

    </div>
  );
};
