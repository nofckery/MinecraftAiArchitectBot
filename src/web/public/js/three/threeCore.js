/**
 * Three.js Scene, Camera, OrbitControls, Lighting, and Lifecycle Management.
 */

import { threeCtx } from './threeContext.js';
import { updateSceneObject } from '../sceneGraph.js';

let resizeCallback = () => {};
let pointerDownCallback = () => {};

export function setThreeCoreDependencies(deps) {
  if (deps.resizeThreeViewport) resizeCallback = deps.resizeThreeViewport;
  if (deps.onThreePointerDown) pointerDownCallback = deps.onThreePointerDown;
}

export function initThree(containerEl = null) {
  const container = containerEl || document.getElementById('threeContainer');
  if (!container || typeof THREE === 'undefined') return;

  threeCtx.scene = new THREE.Scene();
  threeCtx.scene.background = new THREE.Color(0x111722);

  threeCtx.camera = new THREE.PerspectiveCamera(45, container.clientWidth / Math.max(1, container.clientHeight), 0.1, 2000);
  threeCtx.camera.position.set(24, 20, 30);

  threeCtx.renderer = new THREE.WebGLRenderer({ antialias: true });
  const initW = Math.max(100, container.clientWidth || 100);
  const initH = Math.max(100, container.clientHeight || 100);
  threeCtx.renderer.setSize(initW, initH, false);
  threeCtx.renderer.setPixelRatio(window.devicePixelRatio || 1);
  threeCtx.renderer.shadowMap.enabled = true;
  container.appendChild(threeCtx.renderer.domElement);

  // WebGL Context Loss Handling (Graceful degradation & recovery)
  threeCtx.renderer.domElement.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    threeCtx.isContextLost = true;
    console.warn('[ThreeViewport] WebGL Context lost. Waiting for restoration...');
  });
  threeCtx.renderer.domElement.addEventListener('webglcontextrestored', () => {
    threeCtx.isContextLost = false;
    console.info('[ThreeViewport] WebGL Context restored. Reinitializing viewport buffers...');
    resizeCallback();
  });

  threeCtx.controls = new THREE.OrbitControls(threeCtx.camera, threeCtx.renderer.domElement);
  threeCtx.controls.enableDamping = true;
  threeCtx.controls.dampingFactor = 0.05;
  threeCtx.controls.target.set(0, 5, 0);
  threeCtx.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };

  // Studio 3-Punkt-Beleuchtung + Tag/Nacht Sonnen-Simulation
  threeCtx.ambientLightRef = new THREE.AmbientLight(0xffffff, 0.8);
  threeCtx.scene.add(threeCtx.ambientLightRef);

  threeCtx.dirLightRef = new THREE.DirectionalLight(0xffffff, 0.85);
  threeCtx.dirLightRef.position.set(35, 55, 45);
  threeCtx.scene.add(threeCtx.dirLightRef);

  threeCtx.fillLightRef = new THREE.DirectionalLight(0x8aa8c8, 0.45);
  threeCtx.fillLightRef.position.set(-35, 25, -35);
  threeCtx.scene.add(threeCtx.fillLightRef);

  threeCtx.hemiLightRef = new THREE.HemisphereLight(0xffffff, 0x3d4b5c, 0.45);
  threeCtx.scene.add(threeCtx.hemiLightRef);

  threeCtx.gridHelperRef = new THREE.GridHelper(128, 128, 0x00e5ff, 0x1d2a3a);
  threeCtx.gridHelperRef.position.y = -0.01;
  threeCtx.scene.add(threeCtx.gridHelperRef);

  // Separate Layer-Gruppen für Terrain, Multi-Object SceneGraph, Verifier & Legacy VoxelGroup
  threeCtx.terrainGroup = new THREE.Group();
  threeCtx.terrainGroup.name = 'StudioTerrainGroup';
  threeCtx.scene.add(threeCtx.terrainGroup);

  threeCtx.sceneObjectsGroup = new THREE.Group();
  threeCtx.sceneObjectsGroup.name = 'StudioSceneObjectsGroup';
  threeCtx.scene.add(threeCtx.sceneObjectsGroup);

  threeCtx.verifierGroup = new THREE.Group();
  threeCtx.verifierGroup.name = 'StudioVerifierGroup';
  threeCtx.scene.add(threeCtx.verifierGroup);

  threeCtx.measureGroup = new THREE.Group();
  threeCtx.measureGroup.name = 'StudioMeasureGroup';
  threeCtx.scene.add(threeCtx.measureGroup);

  threeCtx.voxelGroup = new THREE.Group();
  threeCtx.voxelGroup.name = 'LegacyVoxelGroup';
  threeCtx.scene.add(threeCtx.voxelGroup);

  // Axiom-Style 3D TransformControls (falls über CDN geladen)
  if (typeof THREE.TransformControls === 'function') {
    threeCtx.transformControls = new THREE.TransformControls(threeCtx.camera, threeCtx.renderer.domElement);
    threeCtx.transformControls.setTranslationSnap(1);
    threeCtx.transformControls.setRotationSnap(Math.PI / 2);
    threeCtx.transformControls.setSize(0.85);
    threeCtx.transformControls.addEventListener('dragging-changed', (evt) => {
      if (threeCtx.controls) threeCtx.controls.enabled = !evt.value;
      if (!evt.value && threeCtx.transformControls.object && !threeCtx.isSyncingTransform) {
        const attachedGroup = threeCtx.transformControls.object;
        const objId = attachedGroup.userData?.sceneObjectId;
        if (objId) {
          const newX = Math.round(attachedGroup.position.x);
          const newY = Math.round(attachedGroup.position.y);
          const newZ = Math.round(attachedGroup.position.z);
          const rawDeg = Math.round((-attachedGroup.rotation.y * 180) / Math.PI);
          const normRot = (((Math.round(rawDeg / 90) * 90) % 360) + 360) % 360;
          updateSceneObject(objId, {
            position: { x: newX, y: newY, z: newZ },
            rotation: normRot
          }, `3D-Gizmo Transformation auf (${newX},${newY},${newZ}), ${normRot}°`);
        }
      }
    });
    threeCtx.scene.add(threeCtx.transformControls);
  }

  threeCtx.raycaster = new THREE.Raycaster();
  threeCtx.mouse = new THREE.Vector2();

  // Container-level dynamic resizing via ResizeObserver
  if (typeof ResizeObserver !== 'undefined') {
    if (threeCtx.containerResizeObserver) {
      try { threeCtx.containerResizeObserver.disconnect(); } catch (_) {}
    }
    threeCtx.containerResizeObserver = new ResizeObserver(() => {
      resizeCallback();
    });
    threeCtx.containerResizeObserver.observe(container);
  }

  window.addEventListener('resize', resizeCallback);

  threeCtx.renderer.domElement.addEventListener('pointerdown', (e) => pointerDownCallback(e));

  function animate() {
    requestAnimationFrame(animate);
    if (threeCtx.controls) threeCtx.controls.update();
    if (threeCtx.renderer && threeCtx.scene && threeCtx.camera && !threeCtx.isContextLost) {
      threeCtx.renderer.render(threeCtx.scene, threeCtx.camera);
    }
  }
  animate();
}

export function destroyThreeViewport() {
  if (threeCtx.containerResizeObserver) {
    try {
      threeCtx.containerResizeObserver.disconnect();
    } catch (_) {}
    threeCtx.containerResizeObserver = null;
  }
  if (typeof window !== 'undefined') {
    window.removeEventListener('resize', resizeCallback);
  }
  if (threeCtx.renderer && threeCtx.renderer.domElement) {
    try {
      if (threeCtx.renderer.domElement.parentNode) {
        threeCtx.renderer.domElement.parentNode.removeChild(threeCtx.renderer.domElement);
      }
      if (typeof threeCtx.renderer.dispose === 'function') {
        threeCtx.renderer.dispose();
      }
    } catch (_) {}
  }
}

/**
 * Adjusts sun angle, directional shadow lighting, and sky background color based on time of day (0..24h).
 */
export function setSunTimeOfDay(hour = 12) {
  threeCtx.sunTimeOfDay = Math.max(0, Math.min(24, parseFloat(hour) || 12));
  if (!threeCtx.scene || typeof THREE === 'undefined') return threeCtx.sunTimeOfDay;

  const angle = ((threeCtx.sunTimeOfDay - 6) / 24) * Math.PI * 2;
  const sunY = Math.sin(angle);
  const sunX = Math.cos(angle);

  if (threeCtx.dirLightRef) {
    threeCtx.dirLightRef.position.set(sunX * 65, Math.max(8, sunY * 75), 35);
    threeCtx.dirLightRef.intensity = Math.max(0.18, Math.min(1.05, (sunY + 0.35) * 0.85));
  }
  if (threeCtx.ambientLightRef) {
    threeCtx.ambientLightRef.intensity = Math.max(0.28, Math.min(0.85, (sunY + 0.6) * 0.65));
  }

  if (sunY > 0.25) {
    threeCtx.scene.background = new THREE.Color(0x111722); // Crisp CAD Day Studio Slate
  } else if (sunY > -0.1) {
    threeCtx.scene.background = new THREE.Color(0x231829); // Dusk / Dawn Warm Twilight
  } else {
    threeCtx.scene.background = new THREE.Color(0x070a12); // Deep Midnight
  }

  return threeCtx.sunTimeOfDay;
}
