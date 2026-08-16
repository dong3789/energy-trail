// 2026-08-15 v30: Fall Guys 젤리빈 캐릭터
// - 캡슐(몸통) + 큰 구(머리) + 큰 눈 2개 + 미소
// - primary 색상 (밝은 핑크/시안/옐로우/퍼플)
// - 카툰 느낌: 둥글둥글, 큰 표정
// - 머리 위 화살표 (WASD 직관성) 유지

import * as THREE from 'three';
import { PLAYER, GAME } from '../config';

export interface CharacterFeaturesOptions {
  isTagger: boolean;
  bodyColor: number;
  hasEyes?: boolean;
}

export function addCharacterFeatures(
  body: THREE.Mesh,
  opts: CharacterFeaturesOptions,
): void {
  const scale = opts.isTagger ? GAME.taggerScale : 1;
  const hasEyes = opts.hasEyes ?? true;

  // 1) 머리 — 큰 구 (Fall Guys 비율)
  const headRadius = 0.34 * scale; // v30: 0.22 → 0.34 (더 큼직)
  const headGeom = new THREE.SphereGeometry(headRadius, 16, 12);
  const headColor = opts.isTagger ? opts.bodyColor : 0xfff5e1; // 도망자: 크림
  const headMat = new THREE.MeshLambertMaterial({
    color: headColor,
  });
  const head = new THREE.Mesh(headGeom, headMat);
  const capsuleTop = (PLAYER.height / 2);
  // 머리 위치를 몸통 위쪽에 부착 (캡슐 안에 살짝 박힘)
  head.position.set(0, capsuleTop - headRadius * 0.3, 0);
  head.castShadow = true;
  body.add(head);

  // 2) 큰 눈 2개 (Fall Guys 컷)
  // - 흰 눈동자 + 검은 동공
  if (hasEyes) {
    const eyeGroup = new THREE.Group();
    const eyeRadius = 0.11 * scale;
    const eyeWhiteMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const eyePupilMat = new THREE.MeshBasicMaterial({ color: 0x1a1a1a });
    const eyeXOffset = headRadius * 0.42;
    const eyeY = headRadius * 0.05;
    const eyeZ = -headRadius * 0.92;
    for (const side of [-1, 1]) {
      // 흰자
      const eyeWhite = new THREE.Mesh(
        new THREE.SphereGeometry(eyeRadius, 12, 8),
        eyeWhiteMat,
      );
      eyeWhite.position.set(side * eyeXOffset, eyeY, eyeZ);
      eyeGroup.add(eyeWhite);
      // 검은 동공
      const pupil = new THREE.Mesh(
        new THREE.SphereGeometry(eyeRadius * 0.5, 10, 6),
        eyePupilMat,
      );
      pupil.position.set(side * eyeXOffset, eyeY - eyeRadius * 0.05, eyeZ - eyeRadius * 0.7);
      eyeGroup.add(pupil);
    }
    body.add(eyeGroup);
  }

  // 3) 미소 (작은 검은 아치)
  const mouthMat = new THREE.MeshBasicMaterial({ color: 0x1a1a1a });
  const mouth = new THREE.Mesh(
    new THREE.TorusGeometry(0.08 * scale, 0.015 * scale, 6, 12, Math.PI),
    mouthMat,
  );
  mouth.position.set(0, -headRadius * 0.45, -headRadius * 0.95);
  mouth.rotation.x = Math.PI / 2;
  body.add(mouth);

  // 4) 정면 화살표 (머리 위 — WASD 직관성)
  const arrowColor = opts.isTagger ? 0x6a4423 : opts.bodyColor;
  const arrowLen = 0.28 * scale;
  const arrowRadius = 0.09 * scale;
  const arrowGeom = new THREE.ConeGeometry(arrowRadius, arrowLen, 6);
  const arrowMat = new THREE.MeshLambertMaterial({ color: arrowColor });
  const arrow = new THREE.Mesh(arrowGeom, arrowMat);
  arrow.position.set(0, capsuleTop + 0.18 * scale, -headRadius * 1.4);
  arrow.rotation.x = -Math.PI / 2;
  body.add(arrow);
}
