// Abyssal Leviathan — a hundred-metre bioluminescent skeleton coiling through a
// deep trench while the camera hangs in the water and tracks it.
//
// The creature is not keyframed. Its head steers itself around a bounded volume
// and the rest of the body is a follow-the-leader chain, so every coil, turn and
// overtake is emergent — then a serpentine wave is added on top of the chain and
// the skeleton, fins and glow are all rebuilt from the resulting curve each
// frame. Bass drives how hard it swims, onsets fire a bioluminescent pulse that
// travels head to tail, and the jellyfish bloom contracts in time with it.

//
// Ported from vaudio: its state (the spine and its swim, the pulse, the jaw, the jellyfish, the camera) is
// stepped in shared/scenes/leviathan.ts; this only shows it.

import * as THREE from "three";
import { JELLYFISH, SEGMENTS, SPACING, jellyShapes, liveJellies } from "@shared/scenes/leviathan";
import { clamp01, createLightShaft, createMoteCloud, createRibbon, dimTo, mergeParts, smoothstep } from "./kit";
import type { SceneDefinition, SceneSound } from "./types";

/** What the state says at a frame (`LEVIATHAN.view`). */
interface View {
  time: number;
  /** The body as it swims (x, y, z per vertebra), head first. */
  body: number[];
  wave: number;
  pulse: number;
  jawOpen: number;
  camera: number[];
  look: number[];
  fov: number;
  jellies: number[][];
  snow: number[];
}

const SEAFLOOR_Y = -44;
const ROCKS = 110;
const UP = new THREE.Vector3(0, 1, 0);

/** Head (0) to tail (1) body thickness — thin neck, deep chest, whip tail. */
function bodyRadius(t: number): number {
  const swell = Math.sin(Math.PI * Math.pow(t, 0.62));
  return 0.55 + 2.2 * Math.pow(Math.max(0, swell), 0.75) * (1 - t * 0.75);
}

/** Dorsal membrane height: neck crest, long low sail, then the caudal fluke. */
function finHeight(t: number): number {
  const crest = 2.1 * Math.exp(-Math.pow((t - 0.07) / 0.08, 2));
  const sail = 1.9 * Math.sin(Math.PI * Math.pow(t, 0.85));
  const fluke = 5.4 * Math.exp(-Math.pow((t - 0.95) / 0.06, 2));
  // Scalloped trailing edge — a straight-edged fin reads as a folded card.
  const scallop = 1 + Math.sin(t * 42) * 0.11;
  return (crest + sail + fluke) * scallop;
}

/** One vertebra: centrum, neural + haemal spines, transverse processes, ribs. */
function buildVertebraGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  const centrum = new THREE.LatheGeometry(
    [
      new THREE.Vector2(0.001, -0.46),
      new THREE.Vector2(0.4, -0.46),
      new THREE.Vector2(0.29, -0.24),
      new THREE.Vector2(0.25, 0),
      new THREE.Vector2(0.29, 0.24),
      new THREE.Vector2(0.4, 0.46),
      new THREE.Vector2(0.001, 0.46),
    ],
    14,
  );
  centrum.rotateX(Math.PI * 0.5); // spool axis now runs down the spine (+Z)
  parts.push(centrum);

  const neural = new THREE.ConeGeometry(0.26, 1.15, 5);
  neural.scale(0.55, 1, 1);
  neural.translate(0, 0.85, 0);
  parts.push(neural);

  const haemal = new THREE.ConeGeometry(0.2, 0.7, 5);
  haemal.scale(0.55, -1, 1);
  haemal.translate(0, -0.62, 0);
  parts.push(haemal);

  for (const side of [-1, 1]) {
    const process = new THREE.ConeGeometry(0.13, 0.72, 5);
    process.rotateZ(side * Math.PI * 0.5);
    process.translate(side * 0.5, 0.16, 0);
    parts.push(process);

    // The rib sweeps out from the process and curls under the belly; a partial
    // torus rotated into the body plane is the whole shape.
    const rib = new THREE.TorusGeometry(0.95, 0.06, 5, 16, Math.PI * 0.78);
    rib.rotateZ(Math.PI * 0.18);
    rib.rotateY(side * Math.PI * 0.5);
    rib.scale(1, 1, side);
    rib.translate(0, 0.2, 0.05);
    parts.push(rib);
  }

  return mergeParts(parts);
}

/** Cranium, snout, brow horns and an upper tooth row. Forward is +Z. */
function buildSkullGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  const cranium = new THREE.SphereGeometry(1, 20, 14);
  cranium.scale(0.82, 0.78, 1.35);
  cranium.translate(0, 0.05, 0.2);
  parts.push(cranium);

  const snout = new THREE.ConeGeometry(0.62, 2.4, 10);
  snout.rotateX(Math.PI * 0.5);
  snout.scale(1, 0.72, 1);
  snout.translate(0, -0.06, 2.1);
  parts.push(snout);

  const crest = new THREE.ConeGeometry(0.42, 1.5, 5);
  crest.scale(0.35, 1, 1.5);
  crest.rotateX(-0.5);
  crest.translate(0, 0.9, -0.1);
  parts.push(crest);

  for (const side of [-1, 1]) {
    const horn = new THREE.ConeGeometry(0.16, 2.1, 6);
    horn.translate(0, 1.05, 0);
    horn.rotateX(2.35); // swept back over the neck
    horn.rotateZ(side * 0.4);
    horn.translate(side * 0.52, 0.5, -0.1);
    parts.push(horn);

    // Eye socket rims: a torus each, so the eye lights sit in a hollow.
    const socket = new THREE.TorusGeometry(0.3, 0.07, 5, 14);
    socket.rotateY(side * Math.PI * 0.42);
    socket.translate(side * 0.68, 0.24, 0.72);
    parts.push(socket);

    for (let i = 0; i < 7; i += 1) {
      const tooth = new THREE.ConeGeometry(0.075, 0.42 - i * 0.03, 4);
      tooth.rotateX(Math.PI);
      tooth.translate(side * (0.5 - i * 0.05), -0.42, 0.9 + i * 0.42);
      parts.push(tooth);
    }
  }

  return mergeParts(parts);
}

/** Lower jaw, hinged at the origin so it can drop open on a hit. */
function buildJawGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    const ramus = new THREE.BoxGeometry(0.17, 0.2, 3.1);
    ramus.translate(side * 0.42, 0, 1.6);
    ramus.rotateY(side * 0.07);
    parts.push(ramus);
    for (let i = 0; i < 7; i += 1) {
      const tooth = new THREE.ConeGeometry(0.07, 0.38 - i * 0.03, 4);
      tooth.translate(side * (0.44 - i * 0.045), 0.24, 0.75 + i * 0.4);
      parts.push(tooth);
    }
  }
  const chin = new THREE.SphereGeometry(0.22, 8, 6);
  chin.scale(1, 0.7, 1.4);
  chin.translate(0, -0.02, 3.15);
  parts.push(chin);
  return mergeParts(parts);
}

/** Jellyfish bell: a lathed dome with a flared, open rim. */
function buildBellGeometry(): THREE.BufferGeometry {
  const bell = new THREE.LatheGeometry(
    [
      new THREE.Vector2(0.001, 0.66),
      new THREE.Vector2(0.2, 0.63),
      new THREE.Vector2(0.42, 0.52),
      new THREE.Vector2(0.6, 0.32),
      new THREE.Vector2(0.71, 0.08),
      new THREE.Vector2(0.74, -0.06),
      new THREE.Vector2(0.68, -0.16),
    ],
    22,
  );
  return bell;
}

/** Eight trailing strands plus four wider oral arms, merged into one buffer. */
function buildTentacleGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 8; i += 1) {
    const angle = (i / 8) * Math.PI * 2;
    const strand = new THREE.CylinderGeometry(0.022, 0.006, 2.6, 4, 8);
    strand.translate(0, -1.3, 0);
    // Curl the strand: a straight tentacle looks like a dropped wire.
    const points = strand.getAttribute("position") as THREE.BufferAttribute;
    for (let v = 0; v < points.count; v += 1) {
      const y = points.getY(v);
      points.setX(v, points.getX(v) + y * y * 0.11 * Math.cos(angle * 2.3));
      points.setZ(v, points.getZ(v) + y * y * 0.09 * Math.sin(angle * 1.7));
    }
    strand.rotateZ(Math.cos(angle) * 0.22);
    strand.rotateX(Math.sin(angle) * 0.22);
    strand.translate(Math.cos(angle) * 0.66, -0.06, Math.sin(angle) * 0.66);
    parts.push(strand);
  }
  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI * 2 + 0.4;
    const arm = new THREE.BoxGeometry(0.16, 1.5, 0.02);
    arm.translate(0, -0.75, 0);
    arm.rotateY(angle);
    arm.rotateX(0.12);
    arm.translate(Math.cos(angle) * 0.2, -0.1, Math.sin(angle) * 0.2);
    parts.push(arm);
  }
  return mergeParts(parts);
}

/** Veined membrane mask: alpha and emissive for the fins. */
function finTexture(): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const c = canvas.getContext("2d");
  if (c) {
    const wash = c.createLinearGradient(0, 0, 0, 128);
    wash.addColorStop(0, "rgba(210,240,255,0.85)");
    wash.addColorStop(0.55, "rgba(120,190,225,0.4)");
    wash.addColorStop(1, "rgba(60,120,160,0.06)");
    c.fillStyle = wash;
    c.fillRect(0, 0, 256, 128);

    // Veins fan from the spine edge (v=0) to the trailing edge, thinning out.
    c.lineCap = "round";
    for (let i = 0; i < 34; i += 1) {
      const x = (i / 34) * 256 + 3;
      c.strokeStyle = `rgba(255,255,255,${0.5 - (i % 3) * 0.12})`;
      c.lineWidth = 2.4 - (i % 3) * 0.7;
      c.beginPath();
      c.moveTo(x, 0);
      c.quadraticCurveTo(x + 16, 60, x + 34, 122);
      c.stroke();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

type Jelly = {
  phase: number;
  rate: number;
  size: number;
  spin: number;
  /** 0 keeps the bloom's own violet, 1 pulls it toward the creature's cyan. */
  hue: number;
};

export const leviathan: SceneDefinition<View> = {
  type: "leviathan",
  environment: {
    top: "#0e2f3a",
    bottom: "#01050a",
    glow: "#063039",
    bar: "#7fe6ff",
    bars: 3,
    blur: 0.09,
  },
  look: {
    exposure: 1.05,
    bloom: { strength: 0.5, radius: 0.75, threshold: 0.62 },
  },

  build(ctx) {
    const { scene, camera, palette } = ctx;

    /* ------------------------------- palette -------------------------------- */

    const bio = palette.shade("#4ff0ff", 0.04);
    const ember = palette.shade("#ff6a3d", 0.94);
    const bone = palette.shade("#c8d4d6", 0.2);
    const membraneColor = palette.shade("#2f7f9e", 0.3);
    const jellyColor = palette.shade("#9a6cff", 0.75);
    const waterColor = dimTo(palette.shade("#04222c", 0.2), 0.032);

    scene.background = waterColor.clone();
    const fog = new THREE.FogExp2(waterColor.getHex(), 0.017);
    scene.fog = fog;

    /* -------------------------------- lights -------------------------------- */

    scene.add(new THREE.HemisphereLight(0x3f7f9c, 0x02060a, 0.55));

    // A cold shaft from the surface, far above, so the water has a "up".
    const surface = new THREE.DirectionalLight(0x86d8ff, 0.5);
    surface.position.set(6, 40, 12);
    scene.add(surface);

    // The body carries its own light. These are physical units, so they get
    // damped hard whenever a coil sweeps close to the lens.
    const bodyLights: THREE.PointLight[] = [];
    for (let i = 0; i < 3; i += 1) {
      const light = new THREE.PointLight(bio.clone(), 0, 70, 1.6);
      bodyLights.push(light);
      scene.add(light);
    }
    const jawLight = new THREE.PointLight(ember.clone(), 0, 40, 1.7);
    scene.add(jawLight);

    /* ------------------------------- skeleton ------------------------------- */

    const boneMaterial = ctx.track(
      new THREE.MeshPhysicalMaterial({
        color: bone,
        metalness: 0.35,
        roughness: 0.5,
        clearcoat: 0.6,
        clearcoatRoughness: 0.45,
        sheen: 0.5,
        sheenColor: bio.clone(),
        envMapIntensity: 1.1,
      }),
    );
    const vertebraGeometry = ctx.track(buildVertebraGeometry());
    const vertebrae = new THREE.InstancedMesh(
      vertebraGeometry,
      boneMaterial,
      SEGMENTS,
    );
    vertebrae.frustumCulled = false;
    scene.add(vertebrae);

    const skull = new THREE.Object3D();
    skull.matrixAutoUpdate = false;
    scene.add(skull);
    const cranium = new THREE.Mesh(ctx.track(buildSkullGeometry()), boneMaterial);
    skull.add(cranium);
    const jaw = new THREE.Mesh(ctx.track(buildJawGeometry()), boneMaterial);
    jaw.position.set(0, -0.34, 0.1);
    skull.add(jaw);

    const eyeMaterial = ctx.track(
      new THREE.MeshBasicMaterial({
        color: ember.clone(),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    const eyes = new THREE.InstancedMesh(
      ctx.track(new THREE.SphereGeometry(0.2, 10, 8)),
      eyeMaterial,
      2,
    );
    eyes.frustumCulled = false;
    for (const [i, side] of [-1, 1].entries()) {
      const dummy = new THREE.Object3D();
      dummy.position.set(side * 0.68, 0.24, 0.74);
      dummy.updateMatrix();
      eyes.setMatrixAt(i, dummy.matrix);
    }
    skull.add(eyes);

    /* --------------------------- bioluminescence ---------------------------- */

    // Two rows of photophores down the flanks. Instanced additive quads read as
    // lamps at any distance, where a point light per node would not.
    const nodeMaterial = ctx.track(
      new THREE.MeshBasicMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        opacity: 0.9,
      }),
    );
    const nodes = new THREE.InstancedMesh(
      ctx.track(new THREE.SphereGeometry(0.16, 8, 6)),
      nodeMaterial,
      SEGMENTS * 2,
    );
    nodes.frustumCulled = false;
    scene.add(nodes);

    /* --------------------------------- fins --------------------------------- */

    const membraneMap = ctx.track(finTexture());
    const membraneMaterial = ctx.track(
      new THREE.MeshPhysicalMaterial({
        color: membraneColor,
        emissive: bio.clone(),
        emissiveMap: membraneMap,
        emissiveIntensity: 0.35,
        alphaMap: membraneMap,
        transparent: true,
        opacity: 0.52,
        roughness: 0.3,
        metalness: 0.1,
        iridescence: 0.8,
        iridescenceIOR: 1.35,
        side: THREE.DoubleSide,
        depthWrite: false,
        envMapIntensity: 1.4,
      }),
    );
    const dorsal = createRibbon(ctx, SEGMENTS, membraneMaterial);
    const ventral = createRibbon(ctx, SEGMENTS, membraneMaterial);
    scene.add(dorsal.mesh, ventral.mesh);

    // Pectorals: one swept wing shape, mirrored, hung off an early vertebra.
    const wingShape = new THREE.Shape();
    wingShape.moveTo(0, 0);
    wingShape.quadraticCurveTo(1.6, 0.9, 4.4, 0.5);
    wingShape.quadraticCurveTo(3.6, -0.6, 2.6, -1.1);
    wingShape.quadraticCurveTo(1.2, -1.5, 0, 0);
    const wingGeometry = ctx.track(new THREE.ShapeGeometry(wingShape, 16));
    const pectorals: THREE.Mesh[] = [];
    for (let i = 0; i < 2; i += 1) {
      const wing = new THREE.Mesh(wingGeometry, membraneMaterial);
      wing.matrixAutoUpdate = false;
      wing.frustumCulled = false;
      pectorals.push(wing);
      scene.add(wing);
    }

    /* ------------------------------ jellyfish ------------------------------- */

    const bellMaterial = ctx.track(
      new THREE.MeshPhysicalMaterial({
        color: jellyColor,
        emissive: jellyColor.clone(),
        emissiveIntensity: 0.45,
        roughness: 0.15,
        metalness: 0,
        transmission: 0.5,
        thickness: 0.6,
        transparent: true,
        opacity: 0.62,
        iridescence: 1,
        iridescenceIOR: 1.3,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    const bells = new THREE.InstancedMesh(
      ctx.track(buildBellGeometry()),
      bellMaterial,
      JELLYFISH,
    );
    bells.frustumCulled = false;
    scene.add(bells);

    const tentacles = new THREE.InstancedMesh(
      ctx.track(buildTentacleGeometry()),
      ctx.track(
        new THREE.MeshBasicMaterial({
          color: jellyColor.clone().multiplyScalar(0.5),
          transparent: true,
          opacity: 0.4,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      ),
      JELLYFISH,
    );
    tentacles.frustumCulled = false;
    scene.add(tentacles);

    // The jellyfish's shapes are the state's (shared/scenes/leviathan.ts), so their swim matches.
    const jellies: Jelly[] = jellyShapes().shapes;
    const jellyPosition = new THREE.Vector3();
    const jellyHue = new THREE.Color();

    /* ------------------------------- seafloor ------------------------------- */

    const floor = new THREE.Mesh(
      ctx.track(new THREE.PlaneGeometry(400, 400)),
      ctx.track(
        new THREE.MeshStandardMaterial({
          color: palette.shade("#0a1a20", 0.25),
          roughness: 0.95,
          metalness: 0.1,
        }),
      ),
    );
    floor.rotation.x = -Math.PI * 0.5;
    floor.position.y = SEAFLOOR_Y;
    scene.add(floor);

    const rockGeometry = ctx.track(new THREE.ConeGeometry(1, 2.4, 6, 1));
    const rocks = new THREE.InstancedMesh(
      rockGeometry,
      ctx.track(
        new THREE.MeshStandardMaterial({
          color: palette.shade("#050d12", 0.25),
          roughness: 0.9,
          metalness: 0.15,
          flatShading: true,
        }),
      ),
      ROCKS,
    );
    rocks.frustumCulled = false;
    const polyps = new THREE.InstancedMesh(
      ctx.track(new THREE.SphereGeometry(0.22, 6, 5)),
      ctx.track(
        new THREE.MeshBasicMaterial({
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      ),
      ROCKS,
    );
    polyps.frustumCulled = false;
    {
      const dummy = new THREE.Object3D();
      const tint = new THREE.Color();
      for (let i = 0; i < ROCKS; i += 1) {
        const angle = ctx.random() * Math.PI * 2;
        const radius = 46 + ctx.random() * 105;
        const height = 8 + ctx.random() * 34;
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;
        dummy.position.set(x, SEAFLOOR_Y + height * 0.5, z);
        dummy.rotation.set(
          (ctx.random() - 0.5) * 0.3,
          ctx.random() * 6.28,
          (ctx.random() - 0.5) * 0.3,
        );
        dummy.scale.set(3 + ctx.random() * 8, height * 0.5, 3 + ctx.random() * 8);
        dummy.updateMatrix();
        rocks.setMatrixAt(i, dummy.matrix);

        dummy.position.y = SEAFLOOR_Y + height * 0.95;
        dummy.rotation.set(0, 0, 0);
        dummy.scale.setScalar(0.6 + ctx.random());
        dummy.updateMatrix();
        polyps.setMatrixAt(i, dummy.matrix);
        tint
          .copy(i % 3 === 0 ? ember : bio)
          .multiplyScalar(0.1 + ctx.random() * 0.35);
        polyps.setColorAt(i, tint);
      }
    }
    scene.add(rocks, polyps);

    /* ------------------------------ atmosphere ------------------------------ */

    const shafts: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>[] = [];
    for (let i = 0; i < 6; i += 1) {
      const shaft = createLightShaft(ctx, {
        length: 78,
        spread: 9,
        color: bio.clone().lerp(new THREE.Color("#ffffff"), 0.4),
      });
      const angle = (i / 6) * Math.PI * 2 + 0.6;
      shaft.position.set(Math.cos(angle) * 34, 46, Math.sin(angle) * 34);
      shaft.rotation.z = Math.cos(angle) * 0.22;
      shaft.rotation.x = -Math.sin(angle) * 0.22;
      shafts.push(shaft);
      scene.add(shaft);
    }

    const snow = createMoteCloud(ctx, {
      count: 1600,
      extent: new THREE.Vector3(46, 40, 46),
      color: "#d7f2ff",
      size: 0.14,
    });
    scene.add(snow.object);

    /* --------------------------------- state -------------------------------- */

    const render: THREE.Vector3[] = [];
    for (let i = 0; i < SEGMENTS; i += 1) render.push(new THREE.Vector3(0, 0, -i * SPACING));
    const tangent = new THREE.Vector3();
    const side = new THREE.Vector3();
    const up = new THREE.Vector3();
    const inner = new THREE.Vector3();
    const outer = new THREE.Vector3();
    const scratch = new THREE.Vector3();
    const axisX = new THREE.Vector3();
    const axisY = new THREE.Vector3();
    const axisZ = new THREE.Vector3();
    const bodyMatrix = new THREE.Matrix4();
    const dummy = new THREE.Object3D();
    const tint = new THREE.Color();
    const lookAt = new THREE.Vector3();
    const snowOffset = new THREE.Vector3();

    return {
      update(view: View & SceneSound) {
        const audio = view;
        const { time, wave, pulse, jawOpen } = view;
        const detail = clamp01(ctx.detail);
        const live = Math.min(liveJellies(detail), view.jellies.length);

        // The camera first: what passes close to it is shrunk out of the way.
        camera.position.set(view.camera[0], view.camera[1], view.camera[2]);
        camera.lookAt(lookAt.set(view.look[0], view.look[1], view.look[2]));
        camera.rotation.z += Math.sin(time * 0.16) * 0.06 + audio.beat * 0.02;
        camera.fov = view.fov;
        camera.updateMatrixWorld();

        for (let i = 0; i < SEGMENTS; i += 1) render[i].fromArray(view.body, i * 3);

        let nodeIndex = 0;
        for (let i = 0; i < SEGMENTS; i += 1) {
          const t = i / (SEGMENTS - 1);
          const ahead = render[Math.max(0, i - 1)];
          const behind = render[Math.min(SEGMENTS - 1, i + 1)];
          tangent.copy(ahead).sub(behind).normalize();
          side.crossVectors(UP, tangent).normalize();
          up.crossVectors(tangent, side).normalize();

          // Bank into the swing so the ribs roll instead of staying upright.
          const bank = Math.cos(i * 0.185 - wave) * 0.34 * Math.pow(t, 0.6);
          side.applyAxisAngle(tangent, bank);
          up.applyAxisAngle(tangent, bank);

          const radius = bodyRadius(t) * (1 + audio.bass * 0.12);
          // A coil passing the lens is a wall of bone; shrink it out of the way.
          const clearance = smoothstep(
            2.5,
            9,
            camera.position.distanceTo(render[i]),
          );
          bodyMatrix.makeBasis(
            axisX.copy(side).multiplyScalar(radius * clearance),
            axisY.copy(up).multiplyScalar(radius * clearance),
            axisZ.copy(tangent).multiplyScalar(SPACING * 1.35),
          );
          bodyMatrix.setPosition(render[i]);
          vertebrae.setMatrixAt(i, bodyMatrix);

          // Photophores: a bright band races the length of the body on each hit
          // and the rest idles with the spectrum.
          const along = Math.max(0, 1 - Math.abs(i - pulse) / 9);
          const glow =
            (0.12 +
              audio.bands[i % audio.bands.length] * 0.5 +
              along * along * 3.4) *
            clearance;
          tint.copy(bio).lerp(ember, along * 0.55).multiplyScalar(glow);
          for (const flank of [-1, 1]) {
            dummy.position
              .copy(render[i])
              .addScaledVector(side, flank * radius * 0.85)
              .addScaledVector(up, -radius * 0.15);
            dummy.scale.setScalar((0.55 + along * 1.5) * clearance * (0.6 + radius * 0.35));
            dummy.rotation.set(0, 0, 0);
            dummy.updateMatrix();
            nodes.setMatrixAt(nodeIndex, dummy.matrix);
            nodes.setColorAt(nodeIndex, tint);
            nodeIndex += 1;
          }

          /* -------------------------------- fins --------------------------- */

          const flutter =
            Math.sin(i * 0.5 - wave * 1.7) * (0.12 + audio.high * 0.35) * t;
          const height = finHeight(t) * (1 + audio.mid * 0.2) * clearance;
          inner.copy(render[i]).addScaledVector(up, radius * 0.85);
          outer
            .copy(inner)
            .addScaledVector(up, height)
            .addScaledVector(tangent, flutter);
          dorsal.set(i, inner, outer, side);

          inner.copy(render[i]).addScaledVector(up, -radius * 0.85);
          outer
            .copy(inner)
            .addScaledVector(up, -height * 0.45)
            .addScaledVector(tangent, -flutter);
          ventral.set(i, inner, outer, side);

          if (i === 0) {
            // The skull hangs off the front of the curve on the same frame.
            bodyMatrix.makeBasis(side, up, tangent);
            bodyMatrix.setPosition(
              scratch.copy(render[0]).addScaledVector(tangent, 1.5),
            );
            skull.matrix.copy(bodyMatrix);
            skull.matrixWorldNeedsUpdate = true;
            jaw.rotation.x = 0.12 + jawOpen * 0.5;
            eyeMaterial.color
              .copy(ember)
              .multiplyScalar(1.6 + audio.beat * 2.2 + audio.level);
            jawLight.position
              .copy(render[0])
              .addScaledVector(tangent, 3.4);
            jawLight.intensity =
              (14 + audio.beat * 60) *
              smoothstep(4, 16, camera.position.distanceTo(jawLight.position));
          }

          if (i === 8) {
            for (const [w, flank] of [-1, 1].entries()) {
              const sweep =
                0.35 + Math.sin(time * (1.2 + audio.level) + w) * 0.28 * (0.4 + audio.mid);
              bodyMatrix.makeBasis(
                axisX.copy(tangent).multiplyScalar(flank),
                axisY.copy(up).multiplyScalar(Math.cos(sweep)),
                axisZ.copy(side).multiplyScalar(flank * Math.sin(sweep) + 0.001),
              );
              bodyMatrix.setPosition(
                scratch.copy(render[i]).addScaledVector(side, flank * radius * 0.7),
              );
              pectorals[w].matrix.copy(bodyMatrix);
              pectorals[w].matrixWorldNeedsUpdate = true;
            }
          }
        }
        vertebrae.instanceMatrix.needsUpdate = true;
        nodes.instanceMatrix.needsUpdate = true;
        if (nodes.instanceColor) nodes.instanceColor.needsUpdate = true;
        dorsal.commit();
        ventral.commit();
        membraneMaterial.emissiveIntensity = 0.25 + audio.level * 0.5 + audio.beat * 0.45;

        for (const [i, light] of bodyLights.entries()) {
          const at = render[Math.min(SEGMENTS - 1, 4 + i * 34)];
          light.position.copy(at);
          light.intensity =
            (30 + audio.level * 70 + audio.beat * 50) *
            smoothstep(4, 20, camera.position.distanceTo(at));
        }

        /* ------------------------------ jellyfish -------------------------- */

        bells.count = live;
        tentacles.count = live;
        for (let i = 0; i < live; i += 1) {
          const jelly = jellies[i];
          // Jets on the contraction, coasts on the recovery.
          const beatPhase = time * jelly.rate * (1 + audio.level * 0.8) + jelly.phase;
          const contract = Math.pow(Math.max(0, Math.sin(beatPhase)), 3);
          jellyPosition.fromArray(view.jellies[i]);

          const clearance = smoothstep(
            2,
            7,
            camera.position.distanceTo(jellyPosition),
          );
          const size = jelly.size * clearance;
          dummy.position.copy(jellyPosition);
          dummy.rotation.set(
            Math.sin(beatPhase * 0.3) * 0.2,
            time * jelly.spin,
            Math.cos(beatPhase * 0.27) * 0.2,
          );
          dummy.scale.set(
            size * (1 - contract * 0.22),
            size * (1 + contract * 0.4),
            size * (1 - contract * 0.22),
          );
          dummy.updateMatrix();
          bells.setMatrixAt(i, dummy.matrix);
          tint
            .copy(jellyColor)
            .lerp(jellyHue.copy(bio), jelly.hue * 0.55)
            .multiplyScalar(0.5 + contract * 1.4 + audio.beat * 0.7);
          bells.setColorAt(i, tint);

          dummy.scale.set(size, size * (1 + contract * 0.8), size);
          dummy.updateMatrix();
          tentacles.setMatrixAt(i, dummy.matrix);
        }
        bells.instanceMatrix.needsUpdate = true;
        tentacles.instanceMatrix.needsUpdate = true;
        if (bells.instanceColor) bells.instanceColor.needsUpdate = true;

        /* ------------------------------ water ------------------------------ */

        for (const [i, shaft] of shafts.entries()) {
          shaft.rotation.y = Math.sin(time * 0.14 + i) * 0.25;
          shaft.material.uniforms.uIntensity.value =
            0.09 + audio.mid * 0.11 + audio.beat * 0.07;
        }

        snow.setVisible(500 + detail * 1100);
        snow.update(snowOffset.set(view.snow[0], view.snow[1], view.snow[2]), camera.position);
        snow.material.opacity = 0.25 + audio.high * 0.4;

        fog.density = 0.017 - clamp01(audio.level) * 0.004;

        ctx.post.bloom = 0.38 + audio.level * 0.3 + audio.beat * 0.35;
        ctx.post.exposure = 1.0 + audio.beat * 0.1;
      },
    };
  },
};
