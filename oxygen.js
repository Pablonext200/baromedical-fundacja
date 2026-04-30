import * as THREE from 'three';

const canvas = document.getElementById('oxygen-canvas');
if (canvas && !matchMedia('(prefers-reduced-motion: reduce)').matches) {

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0a2342, 22, 55);

  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 200);
  camera.position.z = 32;

  function resize() {
    const w = canvas.parentElement.clientWidth;
    const h = canvas.parentElement.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);

  // turquoise / navy / cyan palette
  const PALETTE = [
    new THREE.Color('#5dd9ec'),
    new THREE.Color('#00b8d4'),
    new THREE.Color('#0a8ca8'),
    new THREE.Color('#0a2342'),
    new THREE.Color('#7af0ff'),
  ];

  const sphereGeo = new THREE.SphereGeometry(0.55, 24, 24);
  const bondGeo = new THREE.CylinderGeometry(0.08, 0.08, 1.4, 12);

  const COUNT = window.innerWidth < 700 ? 40 : 90;
  const molecules = [];

  for (let i = 0; i < COUNT; i++) {
    const cA = PALETTE[Math.floor(Math.random() * PALETTE.length)].clone();
    const cB = PALETTE[Math.floor(Math.random() * PALETTE.length)].clone();

    const matA = new THREE.MeshBasicMaterial({ color: cA, transparent: true, opacity: 0.92 });
    const matB = new THREE.MeshBasicMaterial({ color: cB, transparent: true, opacity: 0.92 });
    const bondMat = new THREE.MeshBasicMaterial({
      color: cA.clone().lerp(cB, 0.5),
      transparent: true, opacity: 0.55
    });

    const group = new THREE.Group();
    const a1 = new THREE.Mesh(sphereGeo, matA);
    a1.position.x = -0.7;
    const a2 = new THREE.Mesh(sphereGeo, matB);
    a2.position.x = 0.7;
    const bond = new THREE.Mesh(bondGeo, bondMat);
    bond.rotation.z = Math.PI / 2;
    group.add(a1, a2, bond);

    // Glow halo
    const haloMat = new THREE.MeshBasicMaterial({
      color: cA.clone().lerp(cB, 0.5),
      transparent: true, opacity: 0.08, depthWrite: false
    });
    const halo = new THREE.Mesh(new THREE.SphereGeometry(1.6, 16, 16), haloMat);
    halo.position.x = 0;
    group.add(halo);

    const r = 6 + Math.random() * 18;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const basePos = new THREE.Vector3(
      Math.sin(phi) * Math.cos(theta) * r,
      Math.sin(phi) * Math.sin(theta) * r * 0.85,
      Math.cos(phi) * r * 0.5 - 5
    );
    group.position.copy(basePos);
    group.rotation.x = Math.random() * Math.PI * 2;
    group.rotation.y = Math.random() * Math.PI * 2;

    const scale = 0.55 + Math.random() * 0.55;
    group.scale.setScalar(scale);

    scene.add(group);

    molecules.push({
      group, basePos: basePos.clone(),
      matA, matB, bondMat, haloMat, cA, cB,
      phase: Math.random() * Math.PI * 2,
      speed: 0.25 + Math.random() * 0.5,
      driftRadius: 1.5 + Math.random() * 2.5,
      rotSpeed: new THREE.Vector3(
        (Math.random() - 0.5) * 0.012,
        (Math.random() - 0.5) * 0.012,
        (Math.random() - 0.5) * 0.006
      ),
      colorPhase: Math.random() * Math.PI * 2,
      colorSpeed: 0.15 + Math.random() * 0.25,
    });
  }

  // Periodic reformation: gently shuffle base positions
  function reform() {
    molecules.forEach((m) => {
      const r = 6 + Math.random() * 18;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      m.basePos.set(
        Math.sin(phi) * Math.cos(theta) * r,
        Math.sin(phi) * Math.sin(theta) * r * 0.85,
        Math.cos(phi) * r * 0.5 - 5
      );
    });
  }
  setInterval(reform, 12000);

  // Mouse parallax + repel
  let mx = 0, my = 0, tmx = 0, tmy = 0;
  let mouseWorld = new THREE.Vector3(999, 999, 0);
  window.addEventListener('pointermove', (e) => {
    tmx = (e.clientX / window.innerWidth - 0.5) * 2;
    tmy = (e.clientY / window.innerHeight - 0.5) * 2;
    mouseWorld.set(tmx * 22, -tmy * 14, 0);
  });

  const tmpVec = new THREE.Vector3();
  const tmpColor = new THREE.Color();
  const colorMid = new THREE.Color('#00b8d4');

  const clock = new THREE.Clock();
  function animate() {
    const t = clock.getElapsedTime();

    mx += (tmx - mx) * 0.04;
    my += (tmy - my) * 0.04;
    camera.position.x = mx * 4;
    camera.position.y = -my * 4;
    camera.lookAt(0, 0, 0);

    molecules.forEach((m) => {
      const sx = Math.sin(t * m.speed + m.phase) * m.driftRadius;
      const sy = Math.cos(t * m.speed * 0.85 + m.phase * 1.3) * m.driftRadius;
      const sz = Math.sin(t * m.speed * 0.6 + m.phase * 0.8) * m.driftRadius * 0.7;

      m.group.position.set(
        m.basePos.x + sx,
        m.basePos.y + sy,
        m.basePos.z + sz
      );

      // Mouse repel
      tmpVec.copy(m.group.position).sub(mouseWorld);
      const dist = tmpVec.length();
      if (dist < 8) {
        const force = (8 - dist) * 0.25;
        tmpVec.normalize().multiplyScalar(force);
        m.group.position.add(tmpVec);
      }

      // Smoothly lerp basePos toward target (reform)
      m.basePos.lerp(m.basePos, 0); // no-op kept for clarity

      m.group.rotation.x += m.rotSpeed.x;
      m.group.rotation.y += m.rotSpeed.y;
      m.group.rotation.z += m.rotSpeed.z;

      // Color cycle: lerp between cA and colorMid
      const tt = (Math.sin(t * m.colorSpeed + m.colorPhase) + 1) / 2;
      tmpColor.copy(m.cA).lerp(colorMid, tt);
      m.matA.color.copy(tmpColor);
      tmpColor.copy(m.cB).lerp(colorMid, 1 - tt);
      m.matB.color.copy(tmpColor);
      tmpColor.copy(m.matA.color).lerp(m.matB.color, 0.5);
      m.bondMat.color.copy(tmpColor);
      m.haloMat.color.copy(tmpColor);
    });

    // Pause when not visible
    if (!document.hidden) renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }
  animate();
}
