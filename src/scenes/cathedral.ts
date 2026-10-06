// Chrome Cathedral — an endless flight down a corridor of polished arches.
//
// Everything is procedural: instanced arches and light rings recycle past the
// camera forever, hex-panel cores bloom open as you pass through them, gold
// moths swarm the nave, and the whole world is lit by the runtime's procedural
// reflection environment. Bass drives the flight speed, onsets fire light
// pulses that race toward the camera.

// Ported from vaudio: its state (how far it's flown and how fast, the roll and lens, the pulses, the moths'
// orbits) is stepped in shared/scenes/cathedral.ts; this only shows it.

import * as THREE from "three";
import { AHEAD, ARCHES, ARCH_SPACING, MOTHS, SPAN, liveMoths, mothShapes } from "@shared/scenes/cathedral";
import { clamp01, createDustField, createLightShaft, dimTo, fibonacciDirections, mergeParts, smoothstep, wrap } from "./kit";
import type { SceneDefinition, SceneSound } from "./types";

/** What the state says at a frame (`CATHEDRAL.view`). */
interface View {
  time: number;
  travel: number;
  speed: number;
  roll: number;
  fov: number;
  pulses: number[];
  angle: number[];
  radius: number[];
  z: number[];
}
const HALF_WIDTH = 4.7;
/** Just under the column plinths, so the arches sit on the floor. */
const FLOOR_Y = -6.62;
const SHAFTS = 5;
const CORES = 2;
const UP = new THREE.Vector3(0, 1, 0);

/** One arch: barrel ribs, columns, plinths, keystone — merged into one buffer. */
function buildArchGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  const outer = new THREE.TorusGeometry(HALF_WIDTH, 0.44, 8, 30, Math.PI);
  parts.push(outer);
  const trim = new THREE.TorusGeometry(HALF_WIDTH - 0.5, 0.13, 6, 34, Math.PI);
  trim.translate(0, 0, 0.34);
  parts.push(trim);
  const trimBack = trim.clone();
  trimBack.translate(0, 0, -0.68);
  parts.push(trimBack);

  // Outer band + spandrel spokes: fills the upper corners of a wide frame and
  // makes the vault read as built rather than as a bare hoop.
  const band = new THREE.TorusGeometry(HALF_WIDTH + 0.9, 0.26, 6, 30, Math.PI);
  parts.push(band);
  for (let k = 0; k < 5; k += 1) {
    const spoke = new THREE.BoxGeometry(0.95, 0.2, 0.8);
    spoke.translate(HALF_WIDTH + 0.45, 0, 0);
    spoke.rotateZ(Math.PI * (0.14 + 0.18 * k));
    parts.push(spoke);
  }

  for (const side of [-1, 1]) {
    const column = new THREE.BoxGeometry(1, 6.1, 1.1);
    column.translate(side * HALF_WIDTH, -3.05, 0);
    parts.push(column);

    const plinth = new THREE.BoxGeometry(1.75, 0.55, 1.85);
    plinth.translate(side * HALF_WIDTH, -6.35, 0);
    parts.push(plinth);

    // Longitudinal rib bridging the gap to the next arch — reads as one nave
    // instead of a row of loose gates.
    const rib = new THREE.BoxGeometry(0.3, 0.3, ARCH_SPACING);
    rib.translate(side * (HALF_WIDTH - 0.15), 1.9, -ARCH_SPACING * 0.5);
    parts.push(rib);
  }

  const keystone = new THREE.BoxGeometry(0.95, 0.95, 1.25);
  keystone.rotateZ(Math.PI * 0.25);
  keystone.translate(0, HALF_WIDTH + 0.16, 0);
  parts.push(keystone);

  return mergeParts(parts);
}

/** Emissive strip inset in each column — the rhythm of lights down the nave. */
function buildColumnGlowGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    const strip = new THREE.BoxGeometry(0.15, 3.7, 0.15);
    strip.translate(side * (HALF_WIDTH - 0.5), -2.6, 0);
    parts.push(strip);
  }
  return mergeParts(parts);
}

type Moth = {
  angleRate: number;
  speed: number;
  hover: number;
  phase: number;
  size: number;
};

type Shaft = {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  offset: number;
  phase: number;
};

export const cathedral: SceneDefinition<View> = {
  type: "cathedral",
  environment: {
    top: "#1b2634",
    bottom: "#030407",
    glow: "#0a1826",
    bar: "#93aecb",
    bars: 6,
    blur: 0.03,
  },
  look: {
    exposure: 0.95,
    bloom: { strength: 0.34, radius: 0.55, threshold: 0.9 },
  },

  build(ctx) {
    const { scene, camera, palette } = ctx;

    /* ------------------------------- palette -------------------------------- */

    const coolLight = palette.shade("#67dcff", 0.05);
    const warmLight = palette.shade("#ffb45c", 0.95);
    const metalColor = palette.shade("#2b3446", 0.12);
    const panelCool = palette.shade("#2f6dff", 0.2);
    const panelWarm = palette.shade("#ffb245", 0.9);
    const mothColor = palette.shade("#ffb14a", 0.85);
    const fogColor = dimTo(palette.shade("#070a12", 0.1), 0.012);

    scene.background = fogColor.clone();
    const fog = new THREE.FogExp2(fogColor.getHex(), 0.0135);
    scene.fog = fog;

    /* -------------------------------- lights -------------------------------- */

    scene.add(new THREE.HemisphereLight(0x93b8ff, 0x1a0f08, 0.5));

    // Both travelling lights sit *ahead* of the camera: the surfaces we look at
    // are the ones that need lighting, and their moving highlights are what
    // sell the metal as you fly.
    const travelLight = new THREE.PointLight(warmLight.clone(), 40, 44, 1.3);
    travelLight.position.set(0, 2.2, -7);
    scene.add(travelLight);

    const fillLight = new THREE.PointLight(coolLight.clone(), 70, 90, 1.25);
    fillLight.position.set(0, -1.4, -28);
    scene.add(fillLight);

    const coreLights: THREE.PointLight[] = [];
    for (let i = 0; i < CORES; i += 1) {
      const light = new THREE.PointLight(coolLight.clone(), 40, 70, 1.5);
      coreLights.push(light);
      scene.add(light);
    }

    /* ------------------------------- the nave ------------------------------- */

    const archGeometry = ctx.track(buildArchGeometry());
    const archMaterial = ctx.track(
      // Not a perfect mirror: a little diffuse response is what lets the lights
      // model the columns instead of leaving them as silhouettes.
      new THREE.MeshPhysicalMaterial({
        color: metalColor,
        metalness: 0.9,
        roughness: 0.42,
        clearcoat: 0.22,
        clearcoatRoughness: 0.4,
        envMapIntensity: 1.7,
      }),
    );
    const arches = new THREE.InstancedMesh(archGeometry, archMaterial, ARCHES);
    arches.frustumCulled = false;
    scene.add(arches);

    // No mirror pass: the reflection is the same geometry drawn upside down
    // under the floor, dimmed, and dissolved by the fog. Rotating 180° about X
    // (instead of scaling by -1) keeps winding and normals valid.
    const reflectionMaterial = ctx.track(
      new THREE.MeshPhysicalMaterial({
        color: metalColor.clone().multiplyScalar(0.5),
        metalness: 1,
        roughness: 0.34,
        envMapIntensity: 0.7,
      }),
    );
    const archReflections = new THREE.InstancedMesh(
      archGeometry,
      reflectionMaterial,
      ARCHES,
    );
    archReflections.frustumCulled = false;
    scene.add(archReflections);

    const ringGeometry = ctx.track(
      new THREE.TorusGeometry(HALF_WIDTH - 0.08, 0.05, 6, 84),
    );
    const ringMaterial = ctx.track(new THREE.MeshBasicMaterial({ color: 0xffffff }));
    const rings = new THREE.InstancedMesh(ringGeometry, ringMaterial, ARCHES);
    rings.frustumCulled = false;
    scene.add(rings);
    const ringReflections = new THREE.InstancedMesh(
      ringGeometry,
      ringMaterial,
      ARCHES,
    );
    ringReflections.frustumCulled = false;
    scene.add(ringReflections);

    const columnGlowGeometry = ctx.track(buildColumnGlowGeometry());
    const columnGlows = new THREE.InstancedMesh(
      columnGlowGeometry,
      ringMaterial,
      ARCHES,
    );
    columnGlows.frustumCulled = false;
    scene.add(columnGlows);
    const columnGlowReflections = new THREE.InstancedMesh(
      columnGlowGeometry,
      ringMaterial,
      ARCHES,
    );
    columnGlowReflections.frustumCulled = false;
    scene.add(columnGlowReflections);

    // Semi-transparent polished floor over the reflected copies: it adds its
    // own environment reflection while letting them show through.
    const floorGeometry = ctx.track(new THREE.PlaneGeometry(16, 460));
    const floorMaterial = ctx.track(
      new THREE.MeshPhysicalMaterial({
        color: 0x03040a,
        metalness: 1,
        roughness: 0.36,
        envMapIntensity: 0.32,
        transparent: true,
        opacity: 0.5,
      }),
    );
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI * 0.5;
    floor.position.set(0, FLOOR_Y, -SPAN * 0.5 + AHEAD);
    scene.add(floor);

    /* ------------------------------ hex cores ------------------------------- */

    // Instance counts are allocated at the maximum and drawn partially, so the
    // Detail slider stays live without rebuilding the scene.
    const panelsPerCore = 440;
    const panelDirections = fibonacciDirections(panelsPerCore);
    const panelGeometry = ctx.track(new THREE.CylinderGeometry(0.6, 0.66, 0.13, 6));
    panelGeometry.rotateX(Math.PI * 0.5); // hex faces now look down +Z
    const panelMaterial = ctx.track(
      new THREE.MeshPhysicalMaterial({
        metalness: 0.88,
        roughness: 0.28,
        clearcoat: 1,
        clearcoatRoughness: 0.12,
        envMapIntensity: 1.6,
        // A trace of self-lit color keeps the shell reading as a lantern from
        // far away, where point lights have fallen off to nothing.
        emissive: panelCool,
        emissiveIntensity: 0.32,
        side: THREE.DoubleSide,
      }),
    );
    // A glowing shell inside the panels: light leaks through the gaps, which is
    // what makes the cage read as a cage.
    const glowGeometry = ctx.track(new THREE.SphereGeometry(1, 28, 18));
    const cores: THREE.InstancedMesh[] = [];
    const coreGlows: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[] = [];
    for (let c = 0; c < CORES; c += 1) {
      const core = new THREE.InstancedMesh(
        panelGeometry,
        panelMaterial,
        panelsPerCore,
      );
      core.frustumCulled = false;
      const tint = new THREE.Color();
      for (let i = 0; i < panelsPerCore; i += 1) {
        const gold = i % 7 === 0;
        tint.copy(gold ? panelWarm : panelCool);
        tint.multiplyScalar(0.75 + ctx.random() * 0.5);
        core.setColorAt(i, tint);
      }
      cores.push(core);
      scene.add(core);

      const glow = new THREE.Mesh(
        glowGeometry,
        ctx.track(
          new THREE.MeshBasicMaterial({
            color: coolLight.clone(),
            transparent: true,
            opacity: 0.5,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          }),
        ),
      );
      glow.frustumCulled = false;
      coreGlows.push(glow);
      scene.add(glow);
    }

    /* -------------------------------- moths --------------------------------- */

    const mothCount = MOTHS;
    // Forewing with a swept tip, then a scalloped hindwing lobe.
    const wingShape = new THREE.Shape();
    wingShape.moveTo(0, -0.08);
    wingShape.quadraticCurveTo(0.3, 0.92, 1.02, 0.74);
    wingShape.quadraticCurveTo(0.74, 0.3, 0.6, 0.14);
    wingShape.quadraticCurveTo(0.94, -0.16, 0.7, -0.54);
    wingShape.quadraticCurveTo(0.4, -0.74, 0.16, -0.34);
    wingShape.quadraticCurveTo(0.06, -0.2, 0, -0.08);
    const wingGeometry = ctx.track(new THREE.ShapeGeometry(wingShape, 14));
    wingGeometry.rotateX(-Math.PI * 0.5); // lay the wing flat, tip along +X
    const wingMaterial = ctx.track(
      new THREE.MeshPhysicalMaterial({
        color: mothColor,
        metalness: 0.7,
        roughness: 0.42,
        iridescence: 0.65,
        iridescenceIOR: 1.4,
        envMapIntensity: 0.9,
        side: THREE.DoubleSide,
      }),
    );
    const wings = new THREE.InstancedMesh(
      wingGeometry,
      wingMaterial,
      mothCount * 2,
    );
    wings.frustumCulled = false;
    scene.add(wings);

    // A body: without it two hinged wings read as two unrelated shapes.
    const bodyGeometry = ctx.track(new THREE.SphereGeometry(0.1, 8, 6));
    bodyGeometry.scale(0.55, 0.55, 3.4);
    const bodies = new THREE.InstancedMesh(
      bodyGeometry,
      ctx.track(
        new THREE.MeshPhysicalMaterial({
          color: palette.shade("#3a2a1c", 0.7),
          metalness: 0.7,
          roughness: 0.45,
          envMapIntensity: 0.8,
        }),
      ),
      mothCount,
    );
    bodies.frustumCulled = false;
    scene.add(bodies);

    // The moths' shapes are the state's (shared/scenes/cathedral.ts), so their flight matches.
    const moths: Moth[] = mothShapes().shapes;

    /* ------------------------------ god rays -------------------------------- */

    const shafts: Shaft[] = [];
    for (let i = 0; i < SHAFTS; i += 1) {
      const shaft = createLightShaft(ctx, {
        length: 13,
        spread: 1.5,
        color: i % 2 === 0 ? coolLight : warmLight,
      });
      // Kept out along the walls so they rake the columns instead of crossing
      // the middle of the frame.
      shaft.position.set(
        (i % 2 === 0 ? -1 : 1) * (2.9 + ctx.random() * 0.8),
        HALF_WIDTH + 0.4,
        0,
      );
      shaft.rotation.z = (i % 2 === 0 ? 1 : -1) * 0.3;
      shafts.push({ mesh: shaft, offset: (i / SHAFTS) * SPAN, phase: ctx.random() * 6.28 });
      scene.add(shaft);
    }

    const dust = createDustField(ctx, {
      count: 1200,
      width: 22,
      height: 14,
      depth: SPAN,
      color: "#d8e8ff",
      size: 0.12,
    });
    scene.add(dust.object);

    /* -------------------------------- state --------------------------------- */

    const dummy = new THREE.Object3D();
    const mirror = new THREE.Object3D();
    const tint = new THREE.Color();
    const lookTarget = new THREE.Vector3();
    const mBody = new THREE.Matrix4();
    const mWing = new THREE.Matrix4();
    const mFlip = new THREE.Matrix4().makeScale(-1, 1, 1);
    const mOut = new THREE.Matrix4();
    const bodyQuaternion = new THREE.Quaternion();
    const bodyPosition = new THREE.Vector3();
    const bodyScale = new THREE.Vector3();
    const facing = new THREE.Vector3();
    const orientation = new THREE.Object3D();

    camera.position.set(0, 0, 0);

    return {
      update(view: View & SceneSound) {
        const audio = view;
        const { time, travel, pulses } = view;
        const detail = clamp01(ctx.detail);
        const livePanels = Math.round(180 + detail * (panelsPerCore - 180));
        const live = Math.min(liveMoths(detail), view.z.length);

        /* ------------------------------ camera ----------------------------- */

        camera.position.x = Math.sin(time * 0.23) * 1.1;
        camera.position.y = Math.sin(time * 0.31) * 0.45 + audio.punch * 0.3;
        lookTarget.set(Math.sin(time * 0.17) * 1.4, Math.sin(time * 0.13) * 0.7, -30);
        camera.lookAt(lookTarget);
        camera.rotation.z += view.roll;
        camera.fov = view.fov;
        camera.updateMatrixWorld();

        travelLight.position.set(camera.position.x, camera.position.y + 2, -7);
        travelLight.intensity = 17 + audio.level * 16 + audio.beat * 22;
        fillLight.intensity = 34 + audio.level * 30;

        /* --------------------------- nave + rings -------------------------- */

        for (let i = 0; i < ARCHES; i += 1) {
          const z = wrap(-i * ARCH_SPACING + travel, AHEAD - SPAN, SPAN);
          const sway = Math.sin(time * 0.6 + i * 0.5) * 0.03;

          dummy.position.set(0, 0, z);
          dummy.rotation.set(0, 0, sway);
          dummy.scale.setScalar(1 + Math.sin(i * 1.7) * 0.02);
          dummy.updateMatrix();
          arches.setMatrixAt(i, dummy.matrix);
          columnGlows.setMatrixAt(i, dummy.matrix);

          mirror.position.set(0, FLOOR_Y * 2, z);
          mirror.rotation.set(Math.PI, 0, -sway);
          mirror.scale.copy(dummy.scale);
          mirror.updateMatrix();
          archReflections.setMatrixAt(i, mirror.matrix);
          columnGlowReflections.setMatrixAt(i, mirror.matrix);

          // Strips brighten as a pulse sweeps past their bay.
          tint
            .copy(coolLight)
            .multiplyScalar(
              (0.14 + audio.bass * 0.24 + audio.beat * 0.16) *
                smoothstep(2, -9, z),
            );
          columnGlows.setColorAt(i, tint);
          columnGlowReflections.setColorAt(i, tint.multiplyScalar(0.35));

          // Rings sit halfway between arches so the corridor reads as bays.
          const ringZ = wrap(
            -i * ARCH_SPACING + travel + ARCH_SPACING * 0.5,
            AHEAD - SPAN,
            SPAN,
          );
          const depth = -ringZ;
          let flash = 0;
          for (const pulse of pulses) {
            flash += Math.max(0, 1 - Math.abs(depth - pulse) / 10);
          }
          // Fade the ring that is about to swallow the camera, or it becomes a
          // wall of bloom.
          const nearFade = smoothstep(1.5, -8, ringZ);
          const intensity =
            (0.12 +
              audio.bass * 0.55 +
              audio.bands[i % audio.bands.length] * 0.4 +
              flash * flash * 2.4 +
              Math.sin(time * 1.6 + i * 0.7) * 0.06) *
            nearFade;

          const pulseScale = 1 + flash * 0.035 + audio.punch * 0.02;
          dummy.position.set(0, 0, ringZ);
          dummy.rotation.set(0, 0, time * 0.05 + i);
          dummy.scale.setScalar(pulseScale);
          dummy.updateMatrix();
          rings.setMatrixAt(i, dummy.matrix);

          mirror.position.set(0, FLOOR_Y * 2, ringZ);
          mirror.rotation.set(Math.PI, 0, -(time * 0.05 + i));
          mirror.scale.setScalar(pulseScale);
          mirror.updateMatrix();
          ringReflections.setMatrixAt(i, mirror.matrix);

          tint.copy(i % 4 === 0 ? warmLight : coolLight).multiplyScalar(intensity);
          rings.setColorAt(i, tint);
          ringReflections.setColorAt(i, tint.multiplyScalar(0.3));
        }
        arches.instanceMatrix.needsUpdate = true;
        archReflections.instanceMatrix.needsUpdate = true;
        rings.instanceMatrix.needsUpdate = true;
        ringReflections.instanceMatrix.needsUpdate = true;
        columnGlows.instanceMatrix.needsUpdate = true;
        columnGlowReflections.instanceMatrix.needsUpdate = true;
        if (columnGlows.instanceColor) columnGlows.instanceColor.needsUpdate = true;
        if (columnGlowReflections.instanceColor)
          columnGlowReflections.instanceColor.needsUpdate = true;
        if (rings.instanceColor) rings.instanceColor.needsUpdate = true;
        if (ringReflections.instanceColor)
          ringReflections.instanceColor.needsUpdate = true;

        /* ------------------------------- cores ----------------------------- */

        const coreSpacing = SPAN / CORES;
        for (let c = 0; c < CORES; c += 1) {
          const core = cores[c];
          const z = wrap(
            -c * coreSpacing + travel * 0.92,
            AHEAD - SPAN,
            SPAN,
          );
          // The shell blooms open and thins out as the camera passes through it.
          const distance = Math.abs(z - camera.position.z);
          const nearness = smoothstep(40, 3, distance);
          const open = nearness * nearness;
          const radius = 3.3 + open * 2.4 + audio.bass * 0.5;
          // Keep the gaps between panels constant as Detail changes the count.
          const coverage = Math.sqrt(310 / livePanels) * (radius / 3.3);
          const panelScale =
            0.58 * coverage * (0.9 + audio.mid * 0.25) * (1 - open * 0.45);
          const spin = time * (0.22 + audio.level * 0.3) + c * 2.1;

          coreLights[c].position.set(0, 0, z);
          // Strong enough to read across the nave, damped right down once the
          // shell opens around the camera.
          coreLights[c].intensity =
            (12 + audio.level * 34) * (0.35 + nearness * 0.5) * (1 - open * 0.8);
          // The glow only exists at a distance, where it reads as a lit orb.
          // Up close it would just be a white wall in front of the lens.
          const glowFade = (1 - open) * smoothstep(6, 22, distance);
          coreGlows[c].position.set(0, 0, z);
          coreGlows[c].scale.setScalar((3.3 + audio.bass * 0.5) * 0.9);
          coreGlows[c].material.color
            .copy(coolLight)
            .multiplyScalar(
              (0.35 + audio.level * 1.1 + audio.beat * 0.7) * glowFade,
            );
          core.count = livePanels;

          for (let i = 0; i < livePanels; i += 1) {
            const direction = panelDirections[i];
            const wave =
              Math.sin(direction.y * 5.5 + time * 2.4 + i * 0.11) * 0.5 + 0.5;
            const push =
              radius +
              wave * (0.25 + audio.punch * 1.5) +
              audio.bands[i % audio.bands.length] * 0.6;

            dummy.position
              .set(direction.x, direction.y, direction.z)
              .applyAxisAngle(UP, spin)
              .multiplyScalar(push);
            dummy.position.z += z;
            dummy.lookAt(0, 0, z);
            dummy.rotateZ(i * 1.7 + time * (0.4 + audio.high * 1.6));
            dummy.scale.setScalar(panelScale);
            dummy.updateMatrix();
            core.setMatrixAt(i, dummy.matrix);
          }
          core.instanceMatrix.needsUpdate = true;
        }

        /* ------------------------------- moths ----------------------------- */

        const flapRate = 7 + audio.high * 16 + audio.punch * 9;
        wings.count = live * 2;
        for (let i = 0; i < live; i += 1) {
          const moth = moths[i];
          const angle = view.angle[i];
          const radius = view.radius[i];

          const bob = Math.sin(time * 1.3 + moth.phase) * 0.5;
          bodyPosition.set(
            Math.cos(angle) * radius,
            moth.hover + Math.sin(angle * 1.3) * 0.8 + bob,
            view.z[i],
          );
          // Face along the flight path: forward through the nave plus the
          // tangent of the orbit.
          facing
            .set(
              -Math.sin(angle) * moth.angleRate * radius,
              bob * 0.2,
              1.6,
            )
            .normalize()
            .add(bodyPosition);
          orientation.position.copy(bodyPosition);
          orientation.lookAt(facing);
          orientation.updateMatrix();
          orientation.matrix.decompose(bodyPosition, bodyQuaternion, bodyScale);

          const flap = 0.32 + Math.sin(time * flapRate + moth.phase) * 0.78;
          // Moths orbit the same axis the camera flies down, so without this
          // they periodically fill the lens with one enormous wing.
          const clearance = smoothstep(2.4, 6, camera.position.distanceTo(bodyPosition));
          mBody.compose(
            bodyPosition,
            bodyQuaternion,
            bodyScale.setScalar(moth.size * clearance),
          );
          bodies.setMatrixAt(i, mBody);
          mWing.makeRotationZ(flap);
          mOut.multiplyMatrices(mBody, mWing);
          wings.setMatrixAt(i * 2, mOut);
          mWing.makeRotationZ(flap).premultiply(mFlip);
          mOut.multiplyMatrices(mBody, mWing);
          wings.setMatrixAt(i * 2 + 1, mOut);
        }
        wings.instanceMatrix.needsUpdate = true;
        bodies.count = live;
        bodies.instanceMatrix.needsUpdate = true;

        /* ---------------------------- atmosphere --------------------------- */

        for (const shaft of shafts) {
          const z = wrap(-shaft.offset + travel * 0.8, AHEAD - SPAN, SPAN);
          shaft.mesh.position.z = z;
          shaft.mesh.rotation.y = Math.sin(time * 0.2 + shaft.phase) * 0.3;
          shaft.mesh.material.uniforms.uIntensity.value =
            (0.05 + audio.mid * 0.16 + audio.beat * 0.12) *
            smoothstep(2, -20, z);
        }

        dust.setVisible(400 + detail * 800);
        // The dust flies past at 0.65 of the camera's speed: as far as 0.65 of its travel.
        dust.update(travel * 0.65, 0.35 + audio.high * 0.5);

        fog.density = 0.0115 + (1 - clamp01(audio.level)) * 0.004;

        ctx.post.bloom = 0.24 + audio.level * 0.2 + audio.beat * 0.24;
        ctx.post.exposure = 0.94 + audio.beat * 0.12;
      },
    };
  },
};
