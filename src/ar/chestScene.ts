import * as THREE from 'three';
import { IDENTITY, Quat, Vec3 } from './orientation';

/**
 * The 3D scene for the AR view: one treasure chest, built from shapes and generated textures (no model files), with a
 * beam of light so it can be found from far away. It only knows about drawing: the caller supplies the camera
 * orientation and where to put the chest, and calls `update` every frame.
 *
 * World: x east, y up, z south; the camera sits at the origin and looks along -z (north) when it has no rotation.
 */
export type ChestMood = 'far' | 'near' | 'ready';

export interface ChestScene {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  setView: (q: Quat) => void;
  /** Where to draw the chest (its base) in world metres, and whether to draw it at all. */
  setChest: (position: Vec3, visible: boolean) => void;
  /** Far: cool and dim. Near: warm. Ready: bright gold, with sparkles, because it can be opened. */
  setMood: (mood: ChestMood) => void;
  setSize: (width: number, height: number) => void;
  update: (dtSec: number) => void;
  /** Starts the opening animation (lid, light, coins). */
  open: () => void;
  isOpen: () => boolean;
  /** 0 before opening, 1 once the lid is fully open and the light has burst. */
  openProgress: () => number;
  /** Whether a touch at normalised screen coordinates (-1..1, y up) lands on the chest. */
  hitTest: (ndcX: number, ndcY: number) => boolean;
  dispose: () => void;
}

export const VERTICAL_FOV_DEG = 62;
const OPEN_SECONDS = 1.1;
const LID_OPEN_RAD = -1.95;

// ---- generated textures ----------------------------------------------------------------------------------------

function dataTexture(size: number, pixel: (x: number, y: number) => [number, number, number, number], repeat = false): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y);
      const i = (y * size + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  if (repeat) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
  }
  tex.needsUpdate = true;
  return tex;
}

/** Wood planks with grain: pale and dark stripes, with a darker seam between planks. */
function woodTexture(): THREE.DataTexture {
  const size = 128;
  const hash = (n: number) => {
    const s = Math.sin(n * 127.1) * 43758.5453;
    return s - Math.floor(s);
  };
  return dataTexture(
    size,
    (x, y) => {
      const plank = Math.floor((y / size) * 4);
      const inPlank = ((y / size) * 4) % 1;
      const grain = 0.5 + 0.5 * Math.sin((x / size) * 14 + hash(plank) * 6 + Math.sin(y * 0.4 + plank) * 0.8);
      const fine = hash(x * 0.37 + y * 3.1 + plank * 9) * 0.25;
      const seam = inPlank < 0.05 || inPlank > 0.95 ? 0.55 : 1;
      const v = (0.55 + grain * 0.32 + fine) * seam;
      return [Math.round(150 * v), Math.round(92 * v), Math.round(46 * v), 255];
    },
    true
  );
}

/** A soft round glow, white in the middle fading to nothing. Used for sprites, sparkles and the ground halo. */
function glowTexture(): THREE.DataTexture {
  const size = 64;
  return dataTexture(size, (x, y) => {
    const d = Math.hypot(x - size / 2 + 0.5, y - size / 2 + 0.5) / (size / 2);
    const a = Math.max(0, 1 - d);
    const v = Math.pow(a, 2.2);
    return [255, 255, 255, Math.round(255 * v)];
  });
}

/** A gold coin: a bright rim, a darker inner ring and a shiny centre, on a transparent background. */
function coinTexture(): THREE.DataTexture {
  const size = 64;
  return dataTexture(size, (x, y) => {
    const d = Math.hypot(x - size / 2 + 0.5, y - size / 2 + 0.5) / (size / 2);
    if (d > 1) return [0, 0, 0, 0];
    const rim = d > 0.82 ? 1 : 0;
    const ring = d > 0.58 && d < 0.66 ? 0.55 : 1;
    const shine = Math.max(0, 1 - Math.hypot(x - size * 0.38, y - size * 0.34) / (size * 0.4));
    const base = rim ? 1.0 : 0.82 * ring;
    const v = Math.min(1, base + shine * 0.35);
    return [Math.round(255 * v), Math.round(205 * v), Math.round(70 * v), 255];
  });
}

/** Rays fanning out from the centre, for the burst of light when the chest opens. */
function burstTexture(): THREE.DataTexture {
  const size = 128;
  return dataTexture(size, (x, y) => {
    const dx = x - size / 2 + 0.5;
    const dy = y - size / 2 + 0.5;
    const d = Math.hypot(dx, dy) / (size / 2);
    if (d > 1) return [255, 255, 255, 0];
    const angle = Math.atan2(dy, dx);
    const rays = 0.55 + 0.45 * Math.pow(Math.abs(Math.cos(angle * 6)), 3);
    const falloff = Math.pow(1 - d, 1.6);
    const core = Math.pow(Math.max(0, 1 - d * 2.2), 2);
    return [255, 255, 255, Math.round(255 * Math.min(1, falloff * rays * 0.9 + core))];
  });
}

/** A beam: bright at the bottom, fading up, and soft at the sides. */
function beamTexture(): THREE.DataTexture {
  const w = 32;
  const h = 128;
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const across = 1 - Math.abs((x / (w - 1)) * 2 - 1);
      const up = 1 - y / (h - 1); // texture y runs top to bottom in memory
      const a = Math.pow(across, 1.6) * Math.pow(up, 0.9);
      const i = (y * w + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.round(255 * a);
    }
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.flipY = true;
  tex.needsUpdate = true;
  return tex;
}

// ---- the scene ---------------------------------------------------------------------------------------------------

const MOODS: Record<ChestMood, { glow: number; beam: number; tint: number; sparkle: number }> = {
  far: { glow: 0.45, beam: 0.55, tint: 0x5ec8ff, sparkle: 0.2 },
  near: { glow: 0.8, beam: 0.8, tint: 0xffc15a, sparkle: 0.55 },
  ready: { glow: 1.25, beam: 1, tint: 0xffd36e, sparkle: 1 },
};

const easeOutBack = (t: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

export function createChestScene(): ChestScene {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(VERTICAL_FOV_DEG, 9 / 19.5, 0.1, 400);

  const disposables: { dispose: () => void }[] = [];
  const track = <T extends { dispose: () => void }>(x: T): T => {
    disposables.push(x);
    return x;
  };

  // Lights: a cool sky fill, a warm key from the upper right, and a gold glow from inside the chest.
  scene.add(new THREE.HemisphereLight(0xb8d0ff, 0x4a3a28, 1.5));
  const key = new THREE.DirectionalLight(0xfff1d6, 2.6);
  key.position.set(3, 6, 4);
  scene.add(key);
  // A cool light from behind, so the edges of the chest stand out against the camera picture.
  const rim = new THREE.DirectionalLight(0x9cc8ff, 1.4);
  rim.position.set(-4, 3, -5);
  scene.add(rim);
  const innerLight = new THREE.PointLight(0xffc15a, 0, 6, 1.6);
  scene.add(innerLight);

  const wood = track(woodTexture());
  const glow = track(glowTexture());
  const beam = track(beamTexture());
  const coin = track(coinTexture());
  const burst = track(burstTexture());

  const woodMat = track(new THREE.MeshStandardMaterial({ map: wood, roughness: 0.82, metalness: 0.02 }));
  const darkWoodMat = track(new THREE.MeshStandardMaterial({ map: wood, color: 0x9a7452, roughness: 0.9, metalness: 0.02 }));
  const goldMat = track(new THREE.MeshPhongMaterial({ color: 0xe0b550, specular: 0xfff2c0, shininess: 70 }));
  const ironMat = track(new THREE.MeshPhongMaterial({ color: 0x3a3d4a, specular: 0x8890a8, shininess: 40 }));
  const hitMat = track(new THREE.MeshBasicMaterial({ visible: false }));

  const chest = new THREE.Group();
  scene.add(chest);
  let yawAt: [number, number] | null = null;
  /** A chest is about a metre wide; drawn larger so it reads well on a phone screen. */
  const CHEST_SCALE = 1.9;
  chest.scale.setScalar(CHEST_SCALE);

  const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number) => {
    const g = track(new THREE.BoxGeometry(w, h, d));
    const m = new THREE.Mesh(g, mat);
    m.position.set(x, y, z);
    return m;
  };

  // Body
  const body = new THREE.Group();
  chest.add(body);
  body.add(box(1.0, 0.56, 0.66, woodMat, 0, 0.28, 0));
  body.add(box(1.06, 0.07, 0.72, ironMat, 0, 0.035, 0)); // base band
  body.add(box(1.04, 0.05, 0.7, goldMat, 0, 0.5, 0)); // top rim
  for (const x of [-0.34, 0.34]) {
    body.add(box(0.1, 0.58, 0.7, ironMat, x, 0.29, 0));
    for (const y of [0.1, 0.46]) {
      const rivet = new THREE.Mesh(track(new THREE.SphereGeometry(0.022, 10, 8)), goldMat);
      rivet.position.set(x, y, 0.355);
      body.add(rivet);
    }
  }
  // Gold corner caps and a row of studs under the rim.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      body.add(box(0.1, 0.58, 0.1, goldMat, sx * 0.5, 0.29, sz * 0.33));
    }
  }
  for (let i = -3; i <= 3; i++) {
    const stud = new THREE.Mesh(track(new THREE.SphereGeometry(0.018, 8, 6)), goldMat);
    stud.position.set(i * 0.12, 0.46, 0.335);
    body.add(stud);
  }

  // Lock plate and keyhole
  body.add(box(0.16, 0.2, 0.05, goldMat, 0, 0.44, 0.355));
  const keyhole = new THREE.Mesh(track(new THREE.CircleGeometry(0.022, 12)), new THREE.MeshBasicMaterial({ color: 0x1a1208 }));
  keyhole.position.set(0, 0.44, 0.382);
  body.add(keyhole);

  // Lid: a half-cylinder hinged at the back top edge.
  const lidPivot = new THREE.Group();
  lidPivot.position.set(0, 0.56, -0.33);
  chest.add(lidPivot);
  const lidGeometry = track(new THREE.CylinderGeometry(0.33, 0.33, 1.0, 32, 1, false, 0, Math.PI));
  lidGeometry.rotateZ(Math.PI / 2);
  const lid = new THREE.Mesh(lidGeometry, darkWoodMat);
  lid.position.set(0, 0, 0.33);
  lid.scale.set(1, 0.78, 1);
  lidPivot.add(lid);
  for (const x of [-0.34, 0.34]) {
    const arc = new THREE.Mesh(track(new THREE.TorusGeometry(0.335, 0.03, 8, 28, Math.PI)), ironMat);
    arc.rotation.y = Math.PI / 2;
    arc.position.set(x, 0, 0.33);
    arc.scale.set(1, 0.78, 1);
    lidPivot.add(arc);
  }
  const liningMat = track(new THREE.MeshPhongMaterial({ color: 0x6b1624, specular: 0x553a3e, shininess: 20 }));
  const lining = new THREE.Mesh(track(new THREE.BoxGeometry(0.98, 0.03, 0.64)), liningMat);
  lining.position.set(0, -0.012, 0.33);
  lidPivot.add(lining);
  const clasp = new THREE.Mesh(track(new THREE.BoxGeometry(0.12, 0.09, 0.05)), goldMat);
  clasp.position.set(0, 0.04, 0.66);
  lidPivot.add(clasp);

  // Light that pours out when it opens.
  const inside = new THREE.Mesh(
    track(new THREE.PlaneGeometry(0.9, 0.56)),
    track(new THREE.MeshBasicMaterial({ map: glow, color: 0xffd36e, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }))
  );
  inside.rotation.x = -Math.PI / 2;
  inside.position.set(0, 0.55, 0);
  chest.add(inside);

  // Soft contact shadow under the chest.
  const shadow = new THREE.Mesh(
    track(new THREE.PlaneGeometry(2.1, 1.7)),
    track(new THREE.MeshBasicMaterial({ map: glow, color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false }))
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.01;
  chest.add(shadow);

  // Rings that ripple out across the ground, like a radar ping.
  const pings = [0, 1].map((i) => {
    const m = new THREE.Mesh(
      track(new THREE.RingGeometry(0.95, 1.0, 64)),
      track(new THREE.MeshBasicMaterial({ color: 0xffd36e, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }))
    );
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.03;
    chest.add(m);
    return { mesh: m, offset: i * 0.5 };
  });

  // Ground halo, and a tall beam so it can be found from far away.
  const halo = new THREE.Mesh(
    track(new THREE.PlaneGeometry(3.4, 3.4)),
    track(new THREE.MeshBasicMaterial({ map: glow, color: 0xffd36e, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }))
  );
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = 0.02;
  chest.add(halo);

  const beamMat = track(new THREE.MeshBasicMaterial({ map: beam, color: 0xffd36e, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  const beamMesh = new THREE.Mesh(track(new THREE.CylinderGeometry(0.34, 0.5, 40, 20, 1, true)), beamMat);
  beamMesh.position.y = 20;
  chest.add(beamMesh);

  // A burst of light, always facing the camera, so the opening is visible from any angle.
  const flare = new THREE.Sprite(track(new THREE.SpriteMaterial({ map: burst, color: 0xffe08a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })));
  flare.position.set(0, 0.7, 0);
  flare.scale.setScalar(0.1);
  chest.add(flare);

  // Sparkles drifting up around it.
  const SPARKS = 60;
  const sparkPositions = new Float32Array(SPARKS * 3);
  const sparkSeeds = Array.from({ length: SPARKS }, (_, i) => ({ a: (i * 2.399) % (Math.PI * 2), r: 0.3 + ((i * 37) % 100) / 100 * 0.9, speed: 0.25 + ((i * 53) % 100) / 100 * 0.45, phase: ((i * 71) % 100) / 100 }));
  const sparkGeometry = track(new THREE.BufferGeometry());
  sparkGeometry.setAttribute('position', new THREE.BufferAttribute(sparkPositions, 3));
  const sparkMat = track(new THREE.PointsMaterial({ map: glow, color: 0xffe9a8, size: 0.14, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true }));
  const sparks = new THREE.Points(sparkGeometry, sparkMat);
  sparks.frustumCulled = false;
  chest.add(sparks);

  // Coins that burst out on opening.
  const COINS = 70;
  const coinPositions = new Float32Array(COINS * 3);
  const coinVelocity = Array.from({ length: COINS }, (_, i) => {
    const a = (i * 2.399) % (Math.PI * 2);
    const sp = 1.4 + ((i * 29) % 100) / 100 * 2.2;
    return { vx: Math.cos(a) * sp * 0.55, vy: 2.6 + ((i * 41) % 100) / 100 * 2.6, vz: Math.sin(a) * sp * 0.55 };
  });
  const coinGeometry = track(new THREE.BufferGeometry());
  coinGeometry.setAttribute('position', new THREE.BufferAttribute(coinPositions, 3));
  const coinMat = track(new THREE.PointsMaterial({ map: coin, color: 0xffffff, size: 0.26, transparent: true, opacity: 0, alphaTest: 0.05, depthWrite: false, sizeAttenuation: true }));
  const coins = new THREE.Points(coinGeometry, coinMat);
  coins.frustumCulled = false;
  chest.add(coins);

  // Touch target: generous, so a thumb can find it.
  const hit = new THREE.Mesh(track(new THREE.BoxGeometry(1.6, 1.3, 1.3)), hitMat);
  hit.position.y = 0.6;
  chest.add(hit);

  chest.visible = false;

  // ---- state ----
  let mood: ChestMood = 'near';
  let time = 0;
  let opening = false;
  let openedAt = 0;
  let progress = 0;
  const raycaster = new THREE.Raycaster();

  function applyMood() {
    const m = MOODS[mood];
    halo.material.color.setHex(m.tint);
    beamMat.color.setHex(m.tint);
    for (const p of pings) p.mesh.material.color.setHex(m.tint);
    innerLight.color.setHex(m.tint);
    sparkMat.opacity = 0.9 * m.sparkle;
  }
  applyMood();

  const cameraQuat = new THREE.Quaternion();

  return {
    scene,
    camera,
    setView: (q) => {
      cameraQuat.set(q.x, q.y, q.z, q.w);
      camera.quaternion.copy(cameraQuat);
    },
    setChest: (position, visible) => {
      chest.position.set(position[0], position[1], position[2]);
      chest.visible = visible;
      // Face the chest toward you the first time it is placed, then leave it: a chest on the ground does not turn as you move.
      if (!yawAt || Math.hypot(position[0] - yawAt[0], position[2] - yawAt[1]) > 3) {
        chest.rotation.y = Math.atan2(-position[0], -position[2]);
        yawAt = [position[0], position[2]];
      }
      innerLight.position.set(position[0], position[1] + 0.8, position[2]);
    },
    setMood: (next) => {
      if (mood === next) return;
      mood = next;
      applyMood();
    },
    setSize: (width, height) => {
      camera.aspect = width / Math.max(1, height);
      camera.updateProjectionMatrix();
    },
    update: (dt) => {
      time += dt;
      const m = MOODS[mood];

      if (opening) {
        progress = Math.min(1, (time - openedAt) / OPEN_SECONDS);
        lidPivot.rotation.x = LID_OPEN_RAD * easeOutBack(Math.min(1, progress * 1.15));
      }

      // Idle: the chest sits still on the ground; only the light under it pulses.
      body.position.y = 0;
      lidPivot.position.y = 0.56;
      halo.material.opacity = (0.55 + 0.25 * Math.sin(time * 2.2)) * m.glow * (opening ? 1.4 : 1);
      beamMat.opacity = 0.7 * m.beam * (opening ? 1 + progress : 1);
      inside.material.opacity = opening ? Math.min(1, progress * 2.2) * 0.7 : 0;
      innerLight.intensity = opening ? progress * 2.6 : m.glow * 1.1;

      // Rings ripple outward and fade.
      for (const p of pings) {
        const t = (time * 0.5 + p.offset) % 1;
        p.mesh.scale.setScalar(0.7 + t * 1.9);
        p.mesh.material.opacity = (1 - t) * 0.32 * m.glow;
      }

      // The burst of light: flashes as the lid lifts, then settles to a glow, and slowly turns.
      if (opening) {
        const flash = Math.sin(Math.min(1, progress * 1.4) * Math.PI);
        flare.material.opacity = Math.min(0.85, 0.35 + flash * 0.5) * Math.min(1, progress * 3);
        flare.scale.setScalar(0.4 + progress * 1.8 + flash * 1.2);
        flare.material.rotation = time * 0.35;
      }

      // Sparkles rise and wrap.
      for (let i = 0; i < SPARKS; i++) {
        const s = sparkSeeds[i];
        const rise = (time * s.speed + s.phase) % 1;
        sparkPositions[i * 3] = Math.cos(s.a + time * 0.4) * s.r * (0.6 + rise * 0.5);
        sparkPositions[i * 3 + 1] = 0.1 + rise * 2.4;
        sparkPositions[i * 3 + 2] = Math.sin(s.a + time * 0.4) * s.r * (0.6 + rise * 0.5);
      }
      sparkGeometry.attributes.position.needsUpdate = true;

      // Coins: thrown up when the lid is partway open, then fall.
      if (opening) {
        const t = Math.max(0, time - openedAt - 0.25);
        coinMat.opacity = t > 0 ? Math.max(0, 1 - Math.max(0, t - 1.0) / 0.8) : 0;
        for (let i = 0; i < COINS; i++) {
          const v = coinVelocity[i];
          coinPositions[i * 3] = v.vx * t;
          coinPositions[i * 3 + 1] = 0.6 + v.vy * t - 4.9 * t * t;
          coinPositions[i * 3 + 2] = v.vz * t;
        }
        coinGeometry.attributes.position.needsUpdate = true;
      }
    },
    open: () => {
      if (opening) return;
      opening = true;
      openedAt = time;
    },
    isOpen: () => opening,
    openProgress: () => progress,
    hitTest: (x, y) => {
      if (!chest.visible) return false;
      raycaster.setFromCamera(new THREE.Vector2(x, y), camera);
      chest.updateMatrixWorld(true);
      return raycaster.intersectObject(hit, false).length > 0;
    },
    dispose: () => {
      for (const d of disposables) d.dispose();
    },
  };
}

export { IDENTITY };
