// Three.js Scene/Camera/Renderer/Lights 셋업
// 2026-08-15 v28: Vibe D 로우폴리 데이라이트 — Bloom/반사/네온 OFF
// - LinearToneMapping (no post)
// - Sun (DirectionalLight) + Ambient + Hemisphere
// - 맵별 skyColor/ambientColor/sunColor 적용

import * as THREE from 'three';
import { SCENE, type MapDef } from '../config';

export interface SceneContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  container: HTMLElement;
  mapDef: MapDef;
  lights: {
    sun: THREE.DirectionalLight;
    ambient: THREE.AmbientLight;
    hemisphere: THREE.HemisphereLight;
  };
  onResize: () => void;
  dispose: () => void;
}

export function createScene(container: HTMLElement, mapDef: MapDef): SceneContext {
  // === Scene ===
  const scene = new THREE.Scene();
  // v34: 그라데이션 하늘 (CanvasTexture) — 카툰 분위기 ↑
  scene.background = makeGradientSky(mapDef.skyColor);
  scene.fog = new THREE.Fog(mapDef.skyColor, mapDef.fogNear, mapDef.fogFar);

  // === Camera (3인칭 사선) ===
  const aspect = container.clientWidth / Math.max(1, container.clientHeight);
  const camera = new THREE.PerspectiveCamera(
    SCENE.cameraFov,
    aspect,
    SCENE.cameraNear,
    SCENE.cameraFar,
  );
  camera.position.set(SCENE.cameraPosition.x, SCENE.cameraPosition.y, SCENE.cameraPosition.z);
  camera.lookAt(SCENE.cameraLookAt.x, SCENE.cameraLookAt.y, SCENE.cameraLookAt.z);

  // === Renderer (포스트프로세싱 없이 직접) ===
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // v28: LinearToneMapping (no ACES) — daylight에 자연스러움
  renderer.toneMapping = THREE.LinearToneMapping;
  renderer.toneMappingExposure = SCENE.toneMappingExposure;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  // === Lights (v28: Sun + Ambient + Hemisphere) ===

  // 햇빛 — 위에서 비스듬히, 그림자 캐스트
  const sun = new THREE.DirectionalLight(mapDef.sunColor, SCENE.sunIntensity);
  sun.position.copy(SCENE.sunDirection).multiplyScalar(20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 80;
  sun.shadow.camera.left = -30;
  sun.shadow.camera.right = 30;
  sun.shadow.camera.top = 30;
  sun.shadow.camera.bottom = -30;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);

  // 환경광 (전반 밝기)
  const ambient = new THREE.AmbientLight(mapDef.ambientColor, SCENE.ambientIntensity);
  scene.add(ambient);

  // Hemisphere (sky/ground 자연스러운 그라데이션)
  const hemisphere = new THREE.HemisphereLight(
    SCENE.hemisphereSky,
    SCENE.hemisphereGround,
    SCENE.hemisphereIntensity,
  );
  hemisphere.position.set(0, 30, 0);
  scene.add(hemisphere);

  // === Resize handler ===
  const onResize = (): void => {
    const w = container.clientWidth;
    const h = Math.max(1, container.clientHeight);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  };
  window.addEventListener('resize', onResize);

  // === Dispose ===
  const dispose = (): void => {
    window.removeEventListener('resize', onResize);
    renderer.dispose();
    sun.shadow.map?.dispose();
    if (renderer.domElement.parentNode) {
      renderer.domElement.parentNode.removeChild(renderer.domElement);
    }
  };

  return {
    scene,
    camera,
    renderer,
    container,
    mapDef,
    lights: { sun, ambient, hemisphere },
    onResize,
    dispose,
  };
}

// === Render loop (v28: 직접 renderer.render, composer 없음) ===
export function startRenderLoop(
  ctx: SceneContext,
  update: (deltaSeconds: number, elapsedSeconds: number) => void,
): () => void {
  const clock = new THREE.Clock();
  let running = true;

  function tick(): void {
    if (!running) return;
    requestAnimationFrame(tick);
    const delta = clock.getDelta();
    const elapsed = clock.getElapsedTime();
    update(delta, elapsed);
    ctx.renderer.render(ctx.scene, ctx.camera);
  }
  tick();

  return () => {
    running = false;
  };
}

// v34: 그라데이션 하늘 텍스처 (위=밝은 하늘, 아래=흐릿한 안개색)
function makeGradientSky(skyColor: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  // skyColor = 위 색, 더 밝게
  const r = (skyColor >> 16) & 0xff;
  const g = (skyColor >> 8) & 0xff;
  const b = skyColor & 0xff;
  // 위에서 아래로: skyColor → 더 밝은 톤 (하늘 빛)
  const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  grad.addColorStop(0, `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`);
  // 아래쪽은 흰색에 가까이 (안개/지평선)
  const r2 = Math.min(255, r + 40);
  const g2 = Math.min(255, g + 40);
  const b2 = Math.min(255, b + 30);
  grad.addColorStop(1, `#${[r2, g2, b2].map((v) => v.toString(16).padStart(2, '0')).join('')}`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
