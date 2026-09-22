import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Suspense, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import * as THREE from "three";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { Figure } from "./figure";
import { VehicleWorld } from "./vehicles";
import { useStudio, type CamFocus } from "@/lib/studio-store";
import { CrouchHold, FpInput } from "@/lib/fp-control";
import { fpLive } from "@/lib/fp-pose";
import { loadCityModel } from "@/lib/load-models";
import {
  approachVehicle,
  getOccupied,
  pushPlayerFromVehicles,
  resetVehicles,
  stepVehicles,
  tryEnterVehicle,
  tryExitVehicle,
  vehicleHintAt,
  vehLive,
} from "@/lib/vehicle-sim";
import {
  bakeCityCollision,
  cityMoveCapsule,
  cityRayDown,
  cityRayPick,
  citySurfaceAt,
  getCityDebugAabbs,
  getCityRuntime,
  getCitySpawn,
  HOME_EXIT,
  HOME_RETURN_SPAWN,
  nearCityPortal,
  nearHomeExit,
  CITY_MAP_H_DEFAULT,
  CITY_BAKE_ID,
} from "@/lib/world-map";

export default function Scene({
  character,
  intestines,
  pelvis,
  arm,
  bayonet,
  bayonetLong,
  room,
}: {
  character: THREE.Object3D;
  intestines: THREE.Object3D;
  pelvis: THREE.Object3D;
  arm: THREE.Object3D;
  bayonet: THREE.Object3D;
  bayonetLong: THREE.Object3D;
  room: THREE.Object3D;
}) {
  const controlsRef = useRef<OrbitControlsImpl>(null);

  return (
    <div
      className="absolute inset-0 touch-none"
      onContextMenu={(e) => e.preventDefault()}
    >
      <Canvas
        dpr={[1, 2]}
        camera={{ position: [0.28, 1.18, 2.35], fov: 34, near: 0.05, far: 40 }}
        gl={{
          antialias: true,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.05,
          alpha: false,
          powerPreference: "high-performance",
          preserveDrawingBuffer: true,
        }}
        onCreated={({ gl, scene }) => {
          gl.setClearColor("#1a1614");
          scene.background = new THREE.Color("#1a1614");
          gl.domElement.style.touchAction = "none";
        }}
      >
        <Suspense fallback={null}>
          <Bedroom room={room} />
          <CityWorld />
          <VehicleWorld />
          <CityMapBake />
          <CityMapRig />
          <CityMapGizmos />
          <CollisionDebug />
          <WallMirror />
          <HomeExitDoor />
          <CityReturnDoor />
          <WorldGate />
          <WorldClip />
          <StudioLights />
          <CityLights />
          <BodyFillLight />
          <Figure
            controlsRef={controlsRef}
            character={character}
            intestines={intestines}
            pelvis={pelvis}
            arm={arm}
            bayonet={bayonet}
            bayonetLong={bayonetLong}
          />
          <ControlsBridge controlsRef={controlsRef} />
          <CameraRig controlsRef={controlsRef} />
          <FirstPersonRig controlsRef={controlsRef} />
        </Suspense>
      </Canvas>
    </div>
  );
}

const ROOM_S = 0.7;
const BED_FOOT_Z = 0.347;
const BED_CENTER_Z = 1.288;
const MATTRESS_Y = 0.57;
const PILLOW_Z = 2.64;
const FLOOR_Y = -0.016;
const _standQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI, 0));
const _lieQ = new THREE.Quaternion().setFromRotationMatrix(
  new THREE.Matrix4().set(-1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1),
);

function applyBedStance(room: THREE.Object3D, stance: "front" | "on" | "lie") {
  const S = ROOM_S;
  room.scale.setScalar(S);
  if (stance === "on") {
    room.quaternion.copy(_standQ);
    room.position.set(0, -MATTRESS_Y * S, BED_CENTER_Z * S);
    return;
  }
  if (stance === "lie") {
    room.quaternion.copy(_lieQ);
    room.position.set(0, 1.98 - PILLOW_Z * S, -0.1 - 0.5 * S);
    return;
  }
  room.quaternion.copy(_standQ);
  room.position.set(0, -FLOOR_Y * S, -0.82 - BED_FOOT_Z * S);
}

function Bedroom({ room }: { room: THREE.Object3D }) {
  const stance = useStudio((s) => s.bedStance);
  const world = useStudio((s) => s.worldMap);
  useMemo(() => {
    room.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of mats) {
        const std = mat as THREE.MeshStandardMaterial;
        if ("envMapIntensity" in std) std.envMapIntensity = 0.35;
        if (std.opacity >= 0.98 && !std.alphaMap) {
          std.transparent = false;
          std.depthWrite = true;
          std.depthTest = true;
        }
      }
    });
  }, [room]);
  applyBedStance(room, stance);
  const mapOpen = useStudio((s) => s.cityMapOpen);
  room.visible = world === "home" && !mapOpen;
  return <primitive object={room} />;
}

const MIRROR_W = 2.42;
const MIRROR_H = 2.18;
const MIRROR_Y = 1.12;
const MIRROR_Z = 0.948;
const _mirrorFwd = new THREE.Vector3();

function WallMirror() {
  const on = useStudio((s) => s.firstPerson && s.fpView === "body" && s.worldMap === "home");
  const mirrorRes = useStudio((s) => s.mirrorRes);
  const group = useMemo(() => {
    const g = new THREE.Group();
    const glass = new Reflector(new THREE.PlaneGeometry(MIRROR_W, MIRROR_H), {
      clipBias: 0.003,
      textureWidth: 1024,
      textureHeight: 1024,
      color: 0xe6ecf0,
      multisample: 0,
    });
    glass.name = "WallMirror";
    glass.frustumCulled = false;
    const draw = glass.onBeforeRender.bind(glass);
    glass.onBeforeRender = function (renderer, scene, camera, geometry, material, group) {
      camera.getWorldDirection(_mirrorFwd);
      if (_mirrorFwd.z < 0.08) return;
      let hide = glass.userData.fpHide as THREE.Object3D[] | undefined;
      if (!hide || hide.length === 0) {
        hide = [];
        scene.traverse((obj) => {
          if (obj.userData.fpHide) hide!.push(obj);
        });
        glass.userData.fpHide = hide;
      }
      const shown: THREE.Object3D[] = [];
      for (const obj of hide) {
        if (!obj.visible) {
          obj.visible = true;
          shown.push(obj);
        }
      }
      const fill = scene.getObjectByName("BodyFillLight") as THREE.PointLight | undefined;
      const fillI = fill?.intensity ?? 0;
      if (fill) fill.intensity = 0;
      draw(renderer, scene, camera, geometry, material, group);
      if (fill) fill.intensity = fillI;
      for (const obj of shown) obj.visible = false;
    };
    g.add(glass);

    const frameMat = new THREE.MeshStandardMaterial({
      color: 0x2c2622,
      roughness: 0.48,
      metalness: 0.32,
    });
    const t = 0.032;
    const d = 0.022;
    const hw = MIRROR_W * 0.5;
    const hh = MIRROR_H * 0.5;
    const bar = (w: number, h: number, x: number, y: number) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), frameMat);
      mesh.position.set(x, y, -0.008);
      g.add(mesh);
    };
    bar(MIRROR_W + t * 2, t, 0, hh + t * 0.5);
    bar(MIRROR_W + t * 2, t, 0, -hh - t * 0.5);
    bar(t, MIRROR_H, -hw - t * 0.5, 0);
    bar(t, MIRROR_H, hw + t * 0.5, 0);

    g.position.set(0, MIRROR_Y, MIRROR_Z);
    g.rotation.y = Math.PI;
    return g;
  }, []);

  useEffect(() => {
    const glass = group.getObjectByName("WallMirror") as InstanceType<typeof Reflector> | undefined;
    glass?.getRenderTarget()?.setSize(mirrorRes, mirrorRes);
  }, [group, mirrorRes]);

  useEffect(() => {
    return () => {
      group.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.isMesh) mesh.geometry.dispose();
        if ("dispose" in obj && typeof (obj as { dispose?: () => void }).dispose === "function") {
          (obj as { dispose: () => void }).dispose();
        }
      });
    };
  }, [group]);

  return <primitive object={group} visible={on} />;
}

function ControlsBridge({
  controlsRef,
}: {
  controlsRef: RefObject<OrbitControlsImpl | null>;
}) {
  const autoRotate = useStudio((s) => s.autoRotate);
  const grabbing = useStudio((s) => s.grabbing);
  const firstPerson = useStudio((s) => s.firstPerson);
  const cityMapOpen = useStudio((s) => s.cityMapOpen);
  const { gl, camera } = useThree();

  useEffect(() => {
    const canvas = gl.domElement;
    const host = canvas.parentElement ?? canvas;
    const TAP_MS = 340;
    const TAP_PX = 38;
    const HOLD_MS = 280;
    const sph = new THREE.Spherical();
    const offset = new THREE.Vector3();
    const _right = new THREE.Vector3();
    const _up = new THREE.Vector3();
    let pressT = 0;
    let pressX = 0;
    let pressY = 0;
    let pressId = -1;
    let lastTapT = 0;
    let lastTapX = 0;
    let lastTapY = 0;
    let rotating = false;
    let rotId = -1;
    let px = 0;
    let py = 0;

    const setRotateFlag = (on: boolean) => {
      const c = controlsRef.current as (OrbitControlsImpl & { _touchRotate?: boolean }) | null;
      if (c) c._touchRotate = on;
    };

    const rotateBy = (x: number, y: number) => {
      const c = controlsRef.current;
      if (!c) return;
      const dx = x - px;
      const dy = y - py;
      px = x;
      py = y;
      offset.copy(camera.position).sub(c.target);
      sph.setFromVector3(offset);
      sph.theta -= dx * 0.0055;
      sph.phi = THREE.MathUtils.clamp(sph.phi - dy * 0.0055, c.minPolarAngle, c.maxPolarAngle);
      sph.makeSafe();
      offset.setFromSpherical(sph);
      camera.position.copy(c.target).add(offset);
      camera.lookAt(c.target);
      c.update();
    };

    const minD = 0.12;
    const maxD = 6.2;
    const panCam = (dx: number, dy: number) => {
      const c = controlsRef.current;
      if (!c) return;
      const el = gl.domElement;
      const dist = camera.position.distanceTo(c.target);
      const persp = camera as THREE.PerspectiveCamera;
      const h = 2 * dist * Math.tan(((persp.fov ?? 50) * Math.PI) / 360);
      const w = h * (el.clientWidth / Math.max(1, el.clientHeight));
      _right.setFromMatrixColumn(camera.matrix, 0);
      _up.setFromMatrixColumn(camera.matrix, 1);
      const tx = (-dx * w) / Math.max(1, el.clientWidth);
      const ty = (dy * h) / Math.max(1, el.clientHeight);
      c.target.addScaledVector(_right, tx);
      c.target.addScaledVector(_up, ty);
      camera.position.addScaledVector(_right, tx);
      camera.position.addScaledVector(_up, ty);
      c.update();
    };
    const dollyCam = (scale: number, walk: number) => {
      const c = controlsRef.current;
      if (!c) return;
      offset.copy(camera.position).sub(c.target);
      let len = offset.length() * scale;
      const fwd = offset.clone().normalize();
      if (len < minD) {
        const extra = minD - len;
        len = minD;
        c.target.addScaledVector(fwd, -extra);
        camera.position.addScaledVector(fwd, -extra);
      }
      if (walk !== 0) {
        c.target.addScaledVector(fwd, -walk);
        camera.position.addScaledVector(fwd, -walk);
      }
      len = THREE.MathUtils.clamp(len, minD, maxD);
      offset.setLength(len);
      camera.position.copy(c.target).add(offset);
      camera.lookAt(c.target);
      c.update();
    };

    let two = false;
    let midX = 0;
    let midY = 0;
    let pinch = 0;

    const twoPos = (e: TouchEvent) => {
      const a = e.touches[0]!;
      const b = e.touches[1]!;
      return {
        x: (a.clientX + b.clientX) * 0.5,
        y: (a.clientY + b.clientY) * 0.5,
        d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
      };
    };

    const down = (e: PointerEvent) => {
      if (useStudio.getState().firstPerson) return;
      if (e.pointerType !== "touch") return;
      const now = performance.now();
      const dx = e.clientX - lastTapX;
      const dy = e.clientY - lastTapY;
      const isDouble =
        e.isPrimary && now - lastTapT < TAP_MS && dx * dx + dy * dy < TAP_PX * TAP_PX;
      if (isDouble) {
        rotating = true;
        rotId = e.pointerId;
        px = e.clientX;
        py = e.clientY;
        lastTapT = 0;
        setRotateFlag(true);
        window.dispatchEvent(new Event("studio-cancel-grab"));
        e.stopPropagation();
        e.preventDefault();
        return;
      }
      pressT = now;
      pressX = e.clientX;
      pressY = e.clientY;
      pressId = e.pointerId;
    };

    const move = (e: PointerEvent) => {
      if (useStudio.getState().firstPerson) return;
      if (!rotating || e.pointerId !== rotId) return;
      rotateBy(e.clientX, e.clientY);
      e.stopPropagation();
      e.preventDefault();
    };

    const up = (e: PointerEvent) => {
      if (useStudio.getState().firstPerson) return;
      if (e.pointerType !== "touch") return;
      if (rotating && e.pointerId === rotId) {
        rotating = false;
        rotId = -1;
        setRotateFlag(false);
        return;
      }
      if (e.pointerId !== pressId) return;
      const dt = performance.now() - pressT;
      const dx = e.clientX - pressX;
      const dy = e.clientY - pressY;
      if (dt < HOLD_MS && dx * dx + dy * dy < TAP_PX * TAP_PX) {
        lastTapT = performance.now();
        lastTapX = e.clientX;
        lastTapY = e.clientY;
      } else {
        lastTapT = 0;
      }
      pressId = -1;
    };

    const touchStart = (e: TouchEvent) => {
      if (useStudio.getState().firstPerson) return;
      if (e.touches.length < 2) return;
      rotating = false;
      rotId = -1;
      setRotateFlag(false);
      window.dispatchEvent(new Event("studio-cancel-grab"));
      const p = twoPos(e);
      two = true;
      midX = p.x;
      midY = p.y;
      pinch = p.d;
      const c = controlsRef.current;
      if (c) {
        c.enablePan = false;
        c.enableRotate = false;
        c.enableZoom = false;
        c.enableDamping = false;
      }
    };
    const touchMove = (e: TouchEvent) => {
      if (useStudio.getState().firstPerson) return;
      if (!two || e.touches.length < 2) return;
      const p = twoPos(e);
      panCam(p.x - midX, p.y - midY);
      const c = controlsRef.current;
      const dist = c ? camera.position.distanceTo(c.target) : 1;
      const pinchDelta = p.d - pinch;
      if (Math.abs(pinchDelta) > 10 && pinch > 8 && p.d > 8) {
        const scale = pinch / p.d;
        const walk = dist <= minD + 0.05 && scale < 1 ? (1 - scale) * 0.28 : 0;
        dollyCam(scale, walk);
      } else if (dist <= minD + 0.08) {
        const walk = (p.y - midY) * -0.0032;
        if (Math.abs(walk) > 1e-5) dollyCam(1, walk);
      }
      midX = p.x;
      midY = p.y;
      pinch = p.d;
      e.preventDefault();
    };
    const touchEnd = (e: TouchEvent) => {
      if (e.touches.length >= 2) {
        const p = twoPos(e);
        midX = p.x;
        midY = p.y;
        pinch = p.d;
        return;
      }
      two = false;
      const c = controlsRef.current;
      if (c) {
        c.enablePan = !useStudio.getState().grabbing;
        c.enableRotate = !useStudio.getState().grabbing;
        c.enableZoom = true;
        c.enableDamping = true;
      }
    };

    host.addEventListener("pointerdown", down, true);
    host.addEventListener("pointermove", move, true);
    host.addEventListener("pointerup", up, true);
    host.addEventListener("pointercancel", up, true);
    host.addEventListener("touchstart", touchStart, { capture: true, passive: true });
    host.addEventListener("touchmove", touchMove, { capture: true, passive: false });
    host.addEventListener("touchend", touchEnd, { capture: true, passive: true });
    host.addEventListener("touchcancel", touchEnd, { capture: true, passive: true });
    return () => {
      host.removeEventListener("pointerdown", down, true);
      host.removeEventListener("pointermove", move, true);
      host.removeEventListener("pointerup", up, true);
      host.removeEventListener("pointercancel", up, true);
      host.removeEventListener("touchstart", touchStart, true);
      host.removeEventListener("touchmove", touchMove, true);
      host.removeEventListener("touchend", touchEnd, true);
      host.removeEventListener("touchcancel", touchEnd, true);
    };
  }, [gl, camera, controlsRef]);

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enabled={!firstPerson && !cityMapOpen}
      enableRotate={!grabbing && !firstPerson && !cityMapOpen}
      enablePan={!grabbing && !firstPerson && !cityMapOpen}
      enableDamping={!firstPerson && !cityMapOpen}
      enableZoom={!firstPerson && !cityMapOpen}
      dampingFactor={0.08}
      autoRotate={autoRotate && !grabbing && !firstPerson && !cityMapOpen}
      autoRotateSpeed={0.45}
      minDistance={0.12}
      maxDistance={6.2}
      minPolarAngle={Math.PI * 0.08}
      maxPolarAngle={Math.PI * 0.9}
      screenSpacePanning
      mouseButtons={{
        LEFT: -1 as unknown as THREE.MOUSE,
        MIDDLE: THREE.MOUSE.PAN,
        RIGHT: THREE.MOUSE.ROTATE,
      }}
      touches={{
        ONE: -1 as unknown as THREE.TOUCH,
        TWO: -1 as unknown as THREE.TOUCH,
      }}
    />
  );
}

const CAM_FOCUS: Record<CamFocus, { x: number; y: number; z: number; dist: number }> = {
  face: { x: 0, y: 1.54, z: 0.11, dist: 0.72 },
  chest: { x: 0, y: 1.27, z: 0.13, dist: 0.88 },
  belly: { x: 0, y: 1.06, z: 0.1, dist: 1.08 },
  groin: { x: 0, y: 0.91, z: 0.08, dist: 0.92 },
};

function CameraRig({
  controlsRef,
}: {
  controlsRef: RefObject<OrbitControlsImpl | null>;
}) {
  const { camera } = useThree();
  const cmd = useStudio((s) => s.camCmd);

  useEffect(() => {
    const c = controlsRef.current;
    if (!c) return;
    const writeLive = () => {
      useStudio.getState().setCameraLive({
        px: camera.position.x,
        py: camera.position.y,
        pz: camera.position.z,
        tx: c.target.x,
        ty: c.target.y,
        tz: c.target.z,
      });
    };
    c.addEventListener("change", writeLive);
    writeLive();
    return () => c.removeEventListener("change", writeLive);
  }, [camera, controlsRef]);

  useEffect(() => {
    if (!cmd) return;
    if (useStudio.getState().firstPerson) return;
    const c = controlsRef.current;
    if (!c) return;
    const offset = new THREE.Vector3();
    if (cmd.kind === "snap") {
      camera.position.set(cmd.snap.px, cmd.snap.py, cmd.snap.pz);
      c.target.set(cmd.snap.tx, cmd.snap.ty, cmd.snap.tz);
    } else if (cmd.kind === "focus") {
      const f = CAM_FOCUS[cmd.focus];
      offset.copy(camera.position).sub(c.target);
      if (offset.lengthSq() < 1e-6) offset.set(0, 0, 1);
      offset.setLength(f.dist);
      c.target.set(f.x, f.y, f.z);
      camera.position.copy(c.target).add(offset);
    } else if (cmd.kind === "zoom") {
      offset.copy(camera.position).sub(c.target);
      if (offset.lengthSq() < 1e-6) offset.set(0, 0, 1);
      offset.setLength(cmd.dist);
      camera.position.copy(c.target).add(offset);
    } else if (cmd.kind === "pan") {
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1);
      const fwd = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 2).multiplyScalar(-1);
      const delta = new THREE.Vector3()
        .addScaledVector(right, cmd.dx)
        .addScaledVector(up, cmd.dy)
        .addScaledVector(fwd, cmd.dz);
      c.target.add(delta);
      camera.position.add(delta);
    }
    camera.lookAt(c.target);
    c.update();
    useStudio.getState().setCameraLive({
      px: camera.position.x,
      py: camera.position.y,
      pz: camera.position.z,
      tx: c.target.x,
      ty: c.target.y,
      tz: c.target.z,
    });
  }, [cmd, camera, controlsRef]);

  return null;
}

const FP_STAND = 1.58;
const FP_CROUCH = 0.86;
const FP_PRONE = 0.28;
const FP_WALK = 1.65;
const FP_AIR = 1.55;
const FP_JUMP = 8.5;
const FP_GRAV = 20;
const FP_MAX_FALL = 58;
const FP_FRICTION = 6.4;
const FP_ACCEL = 12;
const FP_AIR_ACCEL = 3.4;
const FP_STEP = 0.4;
const FP_SENS = 0.0017;
const FP_TOUCH_SENS = 0.00305;
const FP_PITCH_LIM = Math.PI / 2 - 0.02;
const FP_BOUNDS = { xMin: -4.35, xMax: 1.85, zMin: -1.55, zMax: 2.85, bodyR: 0.28 };
const CITY_WALK = 5.8;
const CITY_RUN = 11;
const ORBIT_HOME = { px: 0.28, py: 1.18, pz: 2.35, tx: 0, ty: 1.06, tz: 0.1, fov: 34 };
const _fpRight = new THREE.Vector3();
const _fpFwd = new THREE.Vector3();
const _fpUp = new THREE.Vector3();
const _fpZ = new THREE.Vector3();
const _fpMat = new THREE.Matrix4();
const _camHit = new THREE.Vector3();
const _vehQ = new THREE.Quaternion();
const _lookQ = new THREE.Quaternion();
const _lookE = new THREE.Euler();

function lookDirFromYawPitch(yaw: number, pitch: number, out: THREE.Vector3) {
  const cy = Math.cos(pitch);
  out.set(-Math.sin(yaw) * cy, Math.sin(pitch), -Math.cos(yaw) * cy);
  return out;
}

function syncFpProjection(camera: THREE.Camera, worldMap: string, fpView: string, fov: number) {
  const persp = camera as THREE.PerspectiveCamera;
  const city = worldMap === "city";
  const body = fpView === "body";
  const near = city ? 0.12 : body ? 0.04 : 0.08;
  const far = city ? 5200 : 40;
  if (persp.fov === fov && persp.near === near && persp.far === far) return;
  persp.fov = fov;
  persp.near = near;
  persp.far = far;
  persp.updateProjectionMatrix();
}

/** Roll-free look. Right axis stays horizontal from yaw so looking down never mirrors. */
function applyLookDir(camera: THREE.Camera, dir: THREE.Vector3, yaw: number) {
  _fpFwd.copy(dir);
  const len = _fpFwd.length();
  if (len < 1e-6) _fpFwd.set(-Math.sin(yaw), 0, -Math.cos(yaw));
  else _fpFwd.multiplyScalar(1 / len);
  _fpRight.set(Math.cos(yaw), 0, -Math.sin(yaw));
  _fpUp.crossVectors(_fpRight, _fpFwd);
  if (_fpUp.lengthSq() < 1e-8) {
    _fpUp.set(0, 1, 0);
    _fpRight.crossVectors(_fpFwd, _fpUp).normalize();
    _fpUp.crossVectors(_fpRight, _fpFwd);
  } else {
    _fpUp.normalize();
  }
  _fpZ.copy(_fpFwd).multiplyScalar(-1);
  _fpMat.makeBasis(_fpRight, _fpUp, _fpZ);
  camera.quaternion.setFromRotationMatrix(_fpMat);
}

function applyFpLook(camera: THREE.Camera, yaw: number, pitch: number) {
  applyLookDir(camera, lookDirFromYawPitch(yaw, pitch, _fpFwd), yaw);
}

function pullCameraOutOfWalls(camera: THREE.Camera, city: boolean, near: number, yaw: number, pitch: number) {
  const p = camera.position;
  if (city && getCityRuntime().ready) {
    const r = near + 0.08;
    const y0 = p.y;
    const pushed = cityMoveCapsule(p.x, p.y - r, p.z, r, r * 2.08, 0, 0, 0);
    p.x = pushed.x;
    p.z = pushed.z;
    p.y = THREE.MathUtils.clamp(pushed.y + r, y0 - 0.1, y0 + 0.1);
    lookDirFromYawPitch(yaw, pitch, _fpFwd);
    const hit = cityRayPick(p, _fpFwd, r + 0.16);
    if (hit) {
      _camHit.set(hit.x, hit.y, hit.z);
      const dist = p.distanceTo(_camHit);
      const need = near + 0.07;
      if (dist < need) p.addScaledVector(_fpFwd, dist - need);
    }
  } else {
    const skin = near + 0.08;
    const inside = p.x > -2.02 && p.x < 3.62 && p.z > -3.36 && p.z < 1.02 && p.y < 2.48;
    if (!inside) return;
    if (p.x < -1.96 + skin) p.x = -1.96 + skin;
    if (p.x > 3.52 - skin) p.x = 3.52 - skin;
    if (p.z < -3.28 + skin) p.z = -3.28 + skin;
    if (p.z > 0.9 - skin) p.z = 0.9 - skin;
    if (p.y > 2.3 - skin) p.y = 2.3 - skin;
  }
}

function FirstPersonRig({
  controlsRef,
}: {
  controlsRef: RefObject<OrbitControlsImpl | null>;
}) {
  const { camera, gl } = useThree();
  const firstPerson = useStudio((s) => s.firstPerson);
  const fpView = useStudio((s) => s.fpView);
  const worldMap = useStudio((s) => s.worldMap);
  const lookLocked = useStudio((s) => s.fpLookLocked);
  const fpFov = useStudio((s) => s.fpFov);
  const pos = useRef(new THREE.Vector3(0.12, 0, 1.92));
  const velX = useRef(0);
  const velY = useRef(0);
  const velZ = useRef(0);
  const yaw = useRef(0);
  const pitch = useRef(-0.08);
  const grounded = useRef(true);
  const coyote = useRef(0);
  const jumpBuf = useRef(0);
  const eye = useRef(FP_STAND);
  const eyeFrom = useRef(FP_STAND);
  const eyeTarget = useRef(FP_STAND);
  const eyeBlend = useRef(1);
  const bob = useRef(0);
  const distWalk = useRef(0);
  const input = useRef(new FpInput());
  const lookTouch = useRef<{ id: number; x: number; y: number } | null>(null);
  const vehOrbit = useRef<{ id: number; x: number; y: number } | null>(null);
  const orbitSnap = useRef<{
    px: number;
    py: number;
    pz: number;
    tx: number;
    ty: number;
    tz: number;
    fov: number;
  } | null>(null);
  const lastJumpNonce = useRef(0);
  const lastInteractNonce = useRef(0);
  const lastWarpNonce = useRef(-1);
  const lastVehCam = useRef<"first" | "third" | null>(null);
  const lastVehYaw = useRef(0);
  const lastVehId = useRef("");
  const lookIdle = useRef(99);
  const speedRef = useRef(0);
  const crouchGate = useRef<CrouchHold | null>(null);
  const wasFp = useRef(false);
  const lastWorld = useRef(worldMap);

  useEffect(() => {
    const gate = new CrouchHold(
      () => {
        const s = useStudio.getState();
        if (!s.firstPerson || s.inVehicle) return;
        if (s.fpProne) {
          s.setFpProne(false);
          s.setFpCrouch(false);
        } else {
          s.setFpCrouch(!s.fpCrouch);
        }
      },
      () => {
        const s = useStudio.getState();
        if (!s.firstPerson || s.inVehicle) return;
        s.setFpProne(!s.fpProne);
      },
    );
    crouchGate.current = gate;
    input.current.gate = gate;
    return () => {
      gate.reset();
      if (crouchGate.current === gate) crouchGate.current = null;
      if (input.current.gate === gate) input.current.gate = null;
    };
  }, []);

  useEffect(() => {
    const persp = camera as THREE.PerspectiveCamera;
    if (firstPerson) {
      const c = controlsRef.current;
      if (!orbitSnap.current) {
        orbitSnap.current = {
          px: camera.position.x,
          py: camera.position.y,
          pz: camera.position.z,
          tx: c?.target.x ?? 0,
          ty: c?.target.y ?? 1.06,
          tz: c?.target.z ?? 0.1,
          fov: persp.fov,
        };
      }
      const city = worldMap === "city";
      const body = fpView === "body";
      const worldChanged = lastWorld.current !== worldMap;
      const fpJustOn = !wasFp.current;
      lastWorld.current = worldMap;
      wasFp.current = true;
      const resetPos = fpJustOn || worldChanged || !city;
      if (resetPos) {
        if (city) {
          const sp = getCitySpawn();
          pos.current.set(sp.x, sp.y, sp.z);
          yaw.current = sp.yaw;
          pitch.current = sp.pitch;
          fpLive.bodyYaw = sp.yaw;
          camera.position.set(sp.x, sp.y + 1.46, sp.z);
          lookDirFromYawPitch(sp.yaw, sp.pitch, _fpFwd);
          applyLookDir(camera, _fpFwd, sp.yaw);
        } else if (worldChanged) {
          const sp = HOME_RETURN_SPAWN;
          pos.current.set(sp.x, sp.y, sp.z);
          yaw.current = sp.yaw;
          pitch.current = sp.pitch;
          fpLive.bodyYaw = sp.yaw;
          camera.position.set(sp.x, FP_STAND, sp.z);
          lookDirFromYawPitch(sp.yaw, sp.pitch, _fpFwd);
          applyLookDir(camera, _fpFwd, sp.yaw);
        } else if (body) {
          pos.current.set(0, 0, 0);
          yaw.current = Math.PI;
          pitch.current = -0.72;
          fpLive.bodyYaw = Math.PI;
          fpLive.eyeX = 0;
          fpLive.eyeY = 1.46;
          fpLive.eyeZ = 0.22;
          fpLive.chestX = 0;
          fpLive.chestY = 1.14;
          fpLive.chestZ = 0.12;
          fpLive.headReady = true;
          camera.position.set(0, 1.46, 0.22);
          lookDirFromYawPitch(Math.PI, -0.72, _fpFwd);
          applyLookDir(camera, _fpFwd, Math.PI);
        } else {
          pos.current.set(0.12, 0, 1.92);
          yaw.current = 0;
          pitch.current = -0.08;
          camera.position.set(0.12, FP_STAND, 1.92);
          camera.lookAt(0.12, FP_STAND - 0.08, 0.92);
        }
        velY.current = 0;
        velX.current = 0;
        velZ.current = 0;
        eye.current = FP_STAND;
        eyeFrom.current = FP_STAND;
        eyeTarget.current = FP_STAND;
        eyeBlend.current = 1;
        grounded.current = true;
      }
      syncFpProjection(camera, worldMap, fpView, useStudio.getState().fpFov);
      fpLive.active = true;
      fpLive.view = fpView;
      input.current.gate = crouchGate.current;
      input.current.attach();
    } else {
      wasFp.current = false;
      crouchGate.current?.reset();
      input.current.detach();
      fpLive.active = false;
      fpLive.headReady = false;
      if (document.pointerLockElement) document.exitPointerLock();
      useStudio.getState().setFpLookLocked(false);
      const snap = orbitSnap.current;
      orbitSnap.current = null;
      const home =
        snap && Math.hypot(snap.px - snap.tx, snap.pz - snap.tz) > 0.45 ? snap : ORBIT_HOME;
      camera.position.set(home.px, home.py, home.pz);
      persp.fov = home.fov;
      persp.near = 0.05;
      persp.updateProjectionMatrix();
      const c = controlsRef.current;
      if (c) {
        c.target.set(home.tx, home.ty, home.tz);
        c.enabled = true;
        c.update();
      }
      camera.lookAt(home.tx, home.ty, home.tz);
    }
    return () => input.current.detach();
  }, [firstPerson, fpView, worldMap, camera, controlsRef]);

  useEffect(() => {
    if (!firstPerson) return;
    const persp = camera as THREE.PerspectiveCamera;
    persp.fov = fpFov;
    persp.updateProjectionMatrix();
  }, [firstPerson, fpFov, camera]);

  useEffect(() => {
    if (!firstPerson) return;
    const el = gl.domElement;
    const onWheel = (e: WheelEvent) => {
      if (useStudio.getState().cityMapOpen) return;
      e.preventDefault();
      e.stopPropagation();
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      const st = useStudio.getState();
      st.setFpFov(st.fpFov + dy * 0.045);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [firstPerson, gl]);

  useEffect(() => {
    if (!firstPerson) return;
    const el = gl.domElement;
    el.style.cursor = lookLocked ? "none" : "";
    return () => {
      el.style.cursor = "";
    };
  }, [firstPerson, lookLocked, gl]);

  useEffect(() => {
    if (!firstPerson) return;
    const el = gl.domElement;
    const tryLock = () => {
      const req = el.requestPointerLock as (opts?: { unadjustedMovement?: boolean }) => Promise<void> | void;
      try {
        const result = req.call(el, { unadjustedMovement: true });
        if (result && typeof (result as Promise<void>).catch === "function") {
          (result as Promise<void>).catch(() => {
            try {
              el.requestPointerLock();
            } catch {
              /* iframe preview often rejects pointer lock */
            }
          });
        }
      } catch {
        try {
          el.requestPointerLock();
        } catch {
          /* keep software look */
        }
      }
    };
    const hadPtrLock = { current: false };
    const onLockChange = () => {
      if (document.pointerLockElement === el) {
        hadPtrLock.current = true;
        useStudio.getState().setFpLookLocked(true);
      } else if (hadPtrLock.current) {
        hadPtrLock.current = false;
        useStudio.getState().setFpLookLocked(false);
      }
    };
    const onPointerLockError = () => {
      /* iframe preview often rejects — software look stays via store flag */
    };
    const onMouseMove = (e: MouseEvent) => {
      if (useStudio.getState().cityMapOpen) return;
      const st = useStudio.getState();
      const vehThird = (st.inVehicle || vehLive.inVehicle) && st.vehicleCam === "third";
      if (vehThird) return;
      if (!st.fpLookLocked) return;
      const sens = FP_SENS * st.fpLookSpeed;
      yaw.current -= e.movementX * sens;
      pitch.current -= e.movementY * sens;
      pitch.current = THREE.MathUtils.clamp(pitch.current, -FP_PITCH_LIM, FP_PITCH_LIM);
    };
    const onPointerDown = (e: PointerEvent) => {
      if (useStudio.getState().cityMapOpen) return;
      const st = useStudio.getState();
      const vehThird = (st.inVehicle || vehLive.inVehicle) && st.vehicleCam === "third";
      if (e.button === 0 && vehThird) {
        vehOrbit.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
        lookIdle.current = 0;
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        e.preventDefault();
        return;
      }
      if (e.button === 2) {
        e.preventDefault();
        e.stopPropagation();
        if (vehThird) return;
        if (st.fpLookLocked) {
          st.setFpLookLocked(false);
          if (document.pointerLockElement) document.exitPointerLock();
        } else {
          st.setFpLookLocked(true);
          tryLock();
        }
        return;
      }
      if (e.pointerType === "touch" || e.pointerType === "pen") {
        if (e.button !== 0) return;
        lookTouch.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        e.preventDefault();
      }
    };
    const onPointerMove = (e: PointerEvent) => {
      if (useStudio.getState().cityMapOpen) return;
      const orbit = vehOrbit.current;
      if (orbit && e.pointerId === orbit.id) {
        const dx = e.clientX - orbit.x;
        const dy = e.clientY - orbit.y;
        orbit.x = e.clientX;
        orbit.y = e.clientY;
        yaw.current -= dx * FP_TOUCH_SENS * useStudio.getState().fpLookSpeed;
        pitch.current -= dy * FP_TOUCH_SENS * useStudio.getState().fpLookSpeed;
        pitch.current = THREE.MathUtils.clamp(pitch.current, -FP_PITCH_LIM, FP_PITCH_LIM);
        lookIdle.current = 0;
        return;
      }
      const t = lookTouch.current;
      if (!t || e.pointerId !== t.id) return;
      const dx = e.clientX - t.x;
      const dy = e.clientY - t.y;
      t.x = e.clientX;
      t.y = e.clientY;
      yaw.current -= dx * FP_TOUCH_SENS * useStudio.getState().fpLookSpeed;
      pitch.current -= dy * FP_TOUCH_SENS * useStudio.getState().fpLookSpeed;
      pitch.current = THREE.MathUtils.clamp(pitch.current, -FP_PITCH_LIM, FP_PITCH_LIM);
    };
    const onPointerUp = (e: PointerEvent) => {
      if (vehOrbit.current?.id === e.pointerId) {
        vehOrbit.current = null;
        lookIdle.current = 0;
        try {
          if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        return;
      }
      if (lookTouch.current?.id !== e.pointerId) return;
      lookTouch.current = null;
      try {
        if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Escape") return;
      if (document.pointerLockElement) document.exitPointerLock();
      useStudio.getState().setFpLookLocked(false);
    };
    document.addEventListener("pointerlockchange", onLockChange);
    document.addEventListener("pointerlockerror", onPointerLockError);
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("keydown", onKey);
    el.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      document.removeEventListener("pointerlockchange", onLockChange);
      document.removeEventListener("pointerlockerror", onPointerLockError);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("keydown", onKey);
      el.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [firstPerson, gl]);

  useEffect(() => {
    const probe = {
      getYaw: () => (vehLive.inVehicle ? vehLive.yaw : yaw.current),
      getPitch: () => (vehLive.inVehicle ? vehLive.pitch : pitch.current),
      setPitch: (v: number) => {
        pitch.current = THREE.MathUtils.clamp(v, -FP_PITCH_LIM, FP_PITCH_LIM);
      },
      setLook: (y: number, p: number) => {
        yaw.current = y;
        pitch.current = THREE.MathUtils.clamp(p, -FP_PITCH_LIM, FP_PITCH_LIM);
        lookIdle.current = 0;
      },
      getLookSpeed: () => useStudio.getState().fpLookSpeed,
      applyLook: (dx: number, dy: number) => {
        const sens = FP_SENS * useStudio.getState().fpLookSpeed;
        yaw.current -= dx * sens;
        pitch.current -= dy * sens;
        pitch.current = THREE.MathUtils.clamp(pitch.current, -FP_PITCH_LIM, FP_PITCH_LIM);
        lookIdle.current = 0;
      },
      getSpeed: () => (vehLive.inVehicle ? Math.abs(vehLive.speed) : speedRef.current),
      getRoll: () => vehLive.roll,
      getSprinting: () => fpLive.sprinting,
      getPos: () => pos.current.toArray() as [number, number, number],
      getEye: () => eye.current,
      getCrouch: () => useStudio.getState().fpCrouch,
      getProne: () => useStudio.getState().fpProne,
      getDebug: () => ({
        fp: useStudio.getState().firstPerson,
        view: useStudio.getState().fpView,
        crouch: useStudio.getState().fpCrouch,
        prone: useStudio.getState().fpProne,
        gate: !!crouchGate.current,
        inputGate: !!input.current.gate,
        held: crouchGate.current?.held ?? null,
        lookSpeed: useStudio.getState().fpLookSpeed,
        pitch: pitch.current,
        fov: (camera as THREE.PerspectiveCamera).fov,
        near: (camera as THREE.PerspectiveCamera).near,
        aspect: (camera as THREE.PerspectiveCamera).aspect,
        quat: camera.quaternion.toArray(),
        camPos: camera.position.toArray(),
        canvas: [gl.domElement.width, gl.domElement.height, gl.domElement.clientWidth, gl.domElement.clientHeight],
        tri: gl.info.render.triangles,
        calls: gl.info.render.calls,
        world: useStudio.getState().worldMap,
        grounded: grounded.current,
        posY: pos.current.y,
        velY: velY.current,
        airTime: fpLive.airTime,
        cityReady: getCityRuntime().ready,
        cityCols: getCityRuntime().colliders.length,
        citySkip: getCityRuntime().skipped,
        bakeId: getCityRuntime().bakeId,
        houseCount: getCityRuntime().houseCount,
        probeN: getCityRuntime().probeN,
        probeY: getCityRuntime().probeY,
        sampleV: getCityRuntime().sampleV,
        sampleBB: getCityRuntime().sampleBB,
        colNear: getCityDebugAabbs(pos.current.x, pos.current.z, 24, 4),
        citySpawn: getCityRuntime().spawn,
        cityMinY: getCityRuntime().minY,
        inVehicle: vehLive.inVehicle,
        vehicleCam: useStudio.getState().vehicleCam,
        vehId: vehLive.id,
        vehKind: vehLive.kind,
        vehSpeed: vehLive.speed,
        vehYaw: vehLive.yaw,
        vehPitch: vehLive.pitch,
        vehRoll: vehLive.roll,
        vehPos: [vehLive.x, vehLive.y, vehLive.z],
        vehEye: [vehLive.eyeX, vehLive.eyeY, vehLive.eyeZ],
        vehSteer: vehLive.steerIn,
        vehSteerAngle: getOccupied()?.steerAngle ?? 0,
        vehN: vehLive.vehicles.length,
        vehReady: vehLive.ready,
        vehicles: vehLive.vehicles.map((v) => ({ id: v.id, kind: v.kind, x: v.x, y: v.y, z: v.z, yaw: v.yaw, speed: v.speed })),
        cityVis: (() => {
          const rt = getCityRuntime();
          const g = rt.group;
          const col = rt.colliders[0];
          const mesh = col?.mesh;
          const mat = mesh ? ((Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial) : null;
          const wp = mesh ? mesh.getWorldPosition(new THREE.Vector3()) : null;
          return {
            group: !!g,
            groupVis: g?.visible ?? null,
            parent: !!g?.parent,
            kids: g?.children.length ?? 0,
            meshVis: mesh?.visible ?? null,
            meshName: mesh?.name ?? null,
            wp: wp ? [wp.x, wp.y, wp.z] : null,
            color: mat?.color ? mat.color.getHexString() : null,
            metal: mat?.metalness ?? null,
            rough: mat?.roughness ?? null,
            map: !!mat?.map,
            side: mat?.side ?? null,
            opacity: mat?.opacity ?? null,
          };
        })(),
        mapOpen: useStudio.getState().cityMapOpen,
        showCollision: useStudio.getState().showCollision,
        loading: useStudio.getState().loading,
        loadHint: useStudio.getState().loadHint,
        loadProgress: useStudio.getState().loadProgress,
      }),
      setCrouchHeld: (v: boolean) => crouchGate.current?.setHeld(v),
      setKeys: (codes: string[]) => input.current.setKeys(codes),
      setStick: (x: number, y: number) => {
        useStudio.getState().setFpStick(x, y);
      },
      setSteer: (v: number) => {
        input.current.stickX = -v;
        input.current.stickY = 1;
      },
      setFirstPerson: (on: boolean, view?: "observe" | "body") => {
        useStudio.getState().setFirstPerson(on, view);
      },
      warp: (x: number, y: number, z: number) => {
        useStudio.getState().warpFp(x, y, z);
      },
      interact: () => {
        window.dispatchEvent(new Event("studio-fp-interact"));
      },
      warpToVehicle: (kind?: "car" | "plane") => {
        const p = approachVehicle(kind);
        if (!p) return null;
        useStudio.getState().warpFp(p.x, p.y, p.z);
        return p;
      },
    };
    window.__controlsTest = probe;
    return () => {
      if (window.__controlsTest === probe) delete window.__controlsTest;
    };
  }, []);

  useFrame((_, dt) => {
    const st = useStudio.getState();
    if (st.fpWarpNonce !== lastWarpNonce.current) {
      const boot = lastWarpNonce.current < 0;
      lastWarpNonce.current = st.fpWarpNonce;
      if (vehLive.inVehicle && !boot) resetVehicles();
      if (!vehLive.inVehicle) {
        pos.current.set(st.fpWarpX, st.fpWarpY, st.fpWarpZ);
        velX.current = 0;
        velY.current = 0;
        velZ.current = 0;
        grounded.current = true;
        fpLive.x = st.fpWarpX;
        fpLive.y = st.fpWarpY;
        fpLive.z = st.fpWarpZ;
      }
    }
    if (!firstPerson) return;
    const d = Math.min(0.05, Math.max(0.001, dt));
    const body = st.fpView === "body";
    const mapOpen = st.cityMapOpen;
    input.current.stickX = mapOpen ? 0 : st.fpStickX;
    input.current.stickY = mapOpen ? 0 : st.fpStickY;
    input.current.crouchHold = st.fpCrouchHeld;
    if (st.fpJumpNonce !== lastJumpNonce.current) {
      lastJumpNonce.current = st.fpJumpNonce;
      if (!mapOpen) input.current.jumpTap = true;
    }
    const act = input.current.poll();
    const live = useStudio.getState();
    const inVeh = live.inVehicle || vehLive.inVehicle;
    if (!inVeh) crouchGate.current?.setHeld(act.crouchHeld);
    else crouchGate.current?.setHeld(false);
    const crouched = live.fpCrouch;
    const prone = live.fpProne;
    if (st.fpInteractNonce !== lastInteractNonce.current) {
      lastInteractNonce.current = st.fpInteractNonce;
      window.dispatchEvent(new Event("studio-fp-interact"));
    } else if (!mapOpen) {
      if (inVeh ? act.interactF : act.interact) {
        window.dispatchEvent(new Event("studio-fp-interact"));
      }
    }

    if (vehLive.ready && live.worldMap === "city") {
      stepVehicles(d, {
        throttle: inVeh ? act.moveY : 0,
        steer: inVeh ? -act.moveX : 0,
        pitch: inVeh ? -act.moveY : 0,
        roll: inVeh ? -act.moveX : 0,
        yaw: inVeh ? (act.qHeld ? 1 : 0) + live.vehYawHeld + (act.eHeld ? -1 : 0) : 0,
        nitro: inVeh && (act.sprint || live.vehNitroHeld),
        handbrake: inVeh && (act.spaceHeld || live.vehDriftHeld),
        thrustUp: inVeh && (act.sprint || live.vehNitroHeld),
        thrustDown: inVeh && act.cHeld,
        thrustSlider: inVeh ? live.vehThrustSlider : null,
        mapOpen,
        gearToggle: inVeh && act.ctrlHeld,
        dragBrake: inVeh && act.qHeld && act.eHeld,
      });
    }
    if (inVeh) {
      const v = getOccupied();
      if (vehLive.snapYaw != null) {
        yaw.current = vehLive.snapYaw;
        lastVehYaw.current = vehLive.snapYaw;
        pitch.current = live.vehicleCam === "first" ? -0.06 : -0.18;
        lookIdle.current = 99;
        vehLive.snapYaw = null;
      }
      if (v) {
        pos.current.set(v.x, v.y, v.z);
        speedRef.current = Math.abs(v.speed);
      }
      fpLive.active = true;
      fpLive.view = body ? "body" : "observe";
      fpLive.x = pos.current.x;
      fpLive.y = pos.current.y;
      fpLive.z = pos.current.z;
      fpLive.yaw = yaw.current;
      fpLive.pitch = pitch.current;
      fpLive.crouched = false;
      fpLive.prone = false;
      fpLive.moveFwd = 0;
      fpLive.moveSide = 0;
      fpLive.speedMps = speedRef.current;
      fpLive.stepDist = 0;
      fpLive.grounded = v ? !v.airborne : true;
      fpLive.velY = v?.vy ?? 0;
      fpLive.sprinting = false;
      if (v?.airborne) fpLive.airTime += d;
      else fpLive.airTime = 0;
      return;
    }

    const wantEye = prone ? FP_PRONE : crouched ? FP_CROUCH : FP_STAND;
    if (wantEye !== eyeTarget.current) {
      eyeFrom.current = eye.current;
      eyeTarget.current = wantEye;
      eyeBlend.current = 0;
    }
    if (eyeBlend.current < 1) {
      eyeBlend.current = Math.min(1, eyeBlend.current + d / 0.7);
      const t = eyeBlend.current;
      const u = t * t * (3 - 2 * t);
      eye.current = eyeFrom.current + (eyeTarget.current - eyeFrom.current) * u;
    } else {
      eye.current = wantEye;
    }

    const fx = -Math.sin(yaw.current);
    const fz = -Math.cos(yaw.current);
    const rx = Math.cos(yaw.current);
    const rz = -Math.sin(yaw.current);
    const cityOn = live.worldMap === "city" && getCityRuntime().ready;
    const sprint = Boolean(act.sprint) && !crouched && !prone && !mapOpen;
    const maxSpeed = grounded.current
      ? prone
        ? FP_WALK * 0.28
        : crouched
          ? FP_WALK * 0.45
          : cityOn
            ? sprint
              ? FP_WALK * CITY_RUN
              : FP_WALK * CITY_WALK
            : sprint
              ? FP_WALK * 1.9
              : FP_WALK
      : cityOn
        ? sprint
          ? FP_WALK * CITY_RUN
          : FP_WALK * CITY_WALK
        : sprint
          ? FP_AIR * 1.35
          : FP_AIR;
    const wishX = mapOpen ? 0 : rx * act.moveX + fx * act.moveY;
    const wishZ = mapOpen ? 0 : rz * act.moveX + fz * act.moveY;
    const wishLen = Math.hypot(wishX, wishZ);
    const nx = wishLen > 1e-5 ? wishX / wishLen : 0;
    const nz = wishLen > 1e-5 ? wishZ / wishLen : 0;
    const wishSpeed = maxSpeed * Math.min(1, wishLen);

    const sub = Math.max(1, Math.min(4, Math.ceil(d / 0.0167)));
    const stepDt = d / sub;
    const capR = prone ? 0.22 : crouched ? 0.26 : 0.3;
    const capH = prone ? 0.42 : crouched ? 0.94 : 1.64;
    const prevX = pos.current.x;
    const prevZ = pos.current.z;

    if (!mapOpen && act.jump && prone) {
      useStudio.getState().setFpProne(false);
      useStudio.getState().setFpCrouch(false);
    }
    if (!mapOpen && act.jump) jumpBuf.current = 0.14;
    else jumpBuf.current = Math.max(0, jumpBuf.current - d);

    for (let si = 0; si < sub; si++) {
      let vx = velX.current;
      let vz = velZ.current;
      const speed2 = Math.hypot(vx, vz);
      if (grounded.current) {
        if (speed2 > 0.05) {
          const drop = speed2 * FP_FRICTION * stepDt;
          const k = Math.max(0, speed2 - drop) / speed2;
          vx *= k;
          vz *= k;
        } else {
          vx = 0;
          vz = 0;
        }
      }
      if (wishSpeed > 1e-4) {
        const accel = (grounded.current ? FP_ACCEL : FP_AIR_ACCEL) * wishSpeed * stepDt;
        const current = vx * nx + vz * nz;
        const add = wishSpeed - current;
        if (add > 0) {
          const acc = Math.min(accel, add);
          vx += nx * acc;
          vz += nz * acc;
        }
      }
      velX.current = vx;
      velZ.current = vz;

      if (grounded.current) coyote.current = 0.14;
      else coyote.current = Math.max(0, coyote.current - stepDt);
      if (!mapOpen && jumpBuf.current > 0 && coyote.current > 0) {
        velY.current = FP_JUMP;
        grounded.current = false;
        coyote.current = 0;
        jumpBuf.current = 0;
      }
      velY.current -=
        FP_GRAV *
        (grounded.current || (velY.current > -14 && fpLive.airTime < 1.05)
          ? 1
          : 1 + Math.min(1.8, Math.max(0, fpLive.airTime - 1.05) * 1.15 + Math.max(0, -velY.current - 14) * 0.04)) *
        stepDt;
      if (velY.current < -FP_MAX_FALL) velY.current = -FP_MAX_FALL;

      const dx = velX.current * stepDt;
      const dz = velZ.current * stepDt;
      const dy = velY.current * stepDt;
      let x = pos.current.x;
      let y = pos.current.y;
      let z = pos.current.z;
      if (cityOn) {
        const wasGround = grounded.current;
        const snapGround = wasGround || velY.current > -9;
        let hor = cityMoveCapsule(x, y, z, capR, capH, dx, 0, dz, snapGround);
        const wishDx = x + dx;
        const wishDz = z + dz;
        const blocked =
          Math.hypot(hor.x - wishDx, hor.z - wishDz) > 0.012 && Math.hypot(dx, dz) > 0.008;
        if (blocked && wasGround && velY.current <= 0.4) {
          const stepped = cityMoveCapsule(x, y + FP_STEP, z, capR, capH, dx, 0, dz);
          if (
            Math.hypot(stepped.x - wishDx, stepped.z - wishDz) + 0.01 <
            Math.hypot(hor.x - wishDx, hor.z - wishDz)
          ) {
            hor = stepped;
          }
        }
        const vert = cityMoveCapsule(hor.x, hor.y, hor.z, capR, capH, 0, dy, 0, snapGround);
        x = vert.x;
        y = vert.y;
        z = vert.z;
        if (vert.grounded && velY.current <= 0) {
          velY.current = 0;
          grounded.current = true;
        } else if (dy > 0 && vert.y < hor.y + dy - 0.01) {
          velY.current = 0;
          grounded.current = false;
        } else {
          grounded.current = vert.grounded && velY.current <= 0.2;
        }
        if (wasGround && velY.current <= 0) {
          const gy = cityRayDown(x, y + 1.15, z, FP_STEP + 1.35);
          if (gy != null && y - gy > -0.12 && y - gy < FP_STEP + 0.2) {
            y = gy;
            velY.current = 0;
            grounded.current = true;
          }
        }
        if (!grounded.current && velY.current < -8 && y < getCityRuntime().minY + 6) {
          const gy = citySurfaceAt(x, z);
          if (Number.isFinite(gy)) {
            y = gy;
            velY.current = 0;
            grounded.current = true;
          }
        }
      } else {
        x += dx;
        z += dz;
        x = THREE.MathUtils.clamp(x, FP_BOUNDS.xMin, FP_BOUNDS.xMax);
        z = THREE.MathUtils.clamp(z, FP_BOUNDS.zMin, FP_BOUNDS.zMax);
        const br = FP_BOUNDS.bodyR;
        const r2 = x * x + z * z;
        if (!body && r2 < br * br && y < 1.75) {
          const r = Math.sqrt(r2) || 1e-6;
          x = (x / r) * br;
          z = (z / r) * br;
        }
        y += dy;
        if (y <= 0) {
          y = 0;
          velY.current = 0;
          grounded.current = true;
        } else {
          grounded.current = false;
        }
      }
      pos.current.x = x;
      pos.current.y = y;
      pos.current.z = z;
    }

    if (cityOn) {
      const pushed = pushPlayerFromVehicles(pos.current.x, pos.current.y, pos.current.z, capR);
      pos.current.x = pushed.x;
      pos.current.z = pushed.z;
    }

    const stepDist = Math.hypot(pos.current.x - prevX, pos.current.z - prevZ);
    speedRef.current = Math.hypot(velX.current, velZ.current);

    if (grounded.current && wishLen > 0.12) distWalk.current += stepDist;
    else distWalk.current *= 1 - d * 4;
    const bobAmp =
      grounded.current && wishLen > 0.12
        ? (prone ? 0.006 : crouched ? 0.01 : sprint ? 0.028 : 0.018)
        : 0;
    bob.current = Math.sin(distWalk.current * 14) * bobAmp;

    fpLive.active = true;
    fpLive.view = body ? "body" : "observe";
    fpLive.x = pos.current.x;
    fpLive.y = pos.current.y;
    fpLive.z = pos.current.z;
    fpLive.yaw = yaw.current;
    fpLive.pitch = pitch.current;
    fpLive.crouched = crouched;
    fpLive.prone = prone;
    fpLive.moveFwd = mapOpen ? 0 : act.moveY;
    fpLive.moveSide = mapOpen ? 0 : act.moveX;
    fpLive.speedMps = maxSpeed;
    fpLive.stepDist = grounded.current ? stepDist : 0;
    fpLive.grounded = grounded.current;
    fpLive.velY = velY.current;
    fpLive.sprinting = sprint && wishLen > 0.12;
    if (grounded.current) fpLive.airTime = 0;
    else fpLive.airTime += d;
  }, -1);

  useFrame((_, dt) => {
    if (!firstPerson) return;
    const st = useStudio.getState();
    if (st.cityMapOpen) return;
    const inVeh = st.inVehicle || vehLive.inVehicle;
    const v = inVeh ? getOccupied() : null;
    if (v) {
      const d = Math.min(0.05, Math.max(0.001, dt));
      const firstCam = st.vehicleCam === "first";
      if (lastVehCam.current !== st.vehicleCam || lastVehId.current !== v.id) {
        lastVehCam.current = st.vehicleCam;
        lastVehId.current = v.id;
        yaw.current = v.yaw;
        lastVehYaw.current = v.yaw;
        if (firstCam) pitch.current = v.kind === "plane" ? 0.04 : -0.06;
        else pitch.current = -0.18;
        lookIdle.current = 99;
      }
      const fx = v.fx;
      const fy = v.fy;
      const fz = v.fz;
      const ux = v.ux;
      const uy = v.uy;
      const uz = v.uz;
      const rx = v.rx;
      const ry = v.ry;
      const rz = v.rz;
      lookIdle.current = vehOrbit.current ? 0 : lookIdle.current + d;
      const persp = camera as THREE.PerspectiveCamera;
      const kick =
        v.kind === "plane"
          ? Math.min(4.5, Math.abs(v.speed) * 0.028 + Math.max(0, v.thrust - 0.8) * 6)
          : Math.min(7, Math.abs(v.speed) * 0.055 + v.nitro * 3.2);
      if (firstCam) {
        yaw.current += v.yaw - lastVehYaw.current;
        lastVehYaw.current = v.yaw;
        pitch.current = THREE.MathUtils.clamp(pitch.current, -FP_PITCH_LIM, FP_PITCH_LIM);
        let dyaw = Math.atan2(Math.sin(yaw.current - v.yaw), Math.cos(yaw.current - v.yaw));
        dyaw = THREE.MathUtils.clamp(dyaw, -2.4, 2.4);
        yaw.current = v.yaw + dyaw;
        const camX = v.x + rx * v.eyeX + ux * v.eyeY - fx * v.eyeZ;
        const camY = v.y + ry * v.eyeX + uy * v.eyeY - fy * v.eyeZ;
        const camZ = v.z + rz * v.eyeX + uz * v.eyeY - fz * v.eyeZ;
        camera.position.set(camX, camY, camZ);
        _lookE.set(pitch.current, dyaw, 0, "YXZ");
        _lookQ.setFromEuler(_lookE);
        _vehQ.set(v.qx, v.qy, v.qz, v.qw);
        camera.quaternion.copy(_vehQ).multiply(_lookQ);
        const fov = Math.min(82, st.fpFov + kick * 0.45);
        const near = 0.06;
        const far = 5200;
        if (persp.fov !== fov || persp.near !== near || persp.far !== far) {
          persp.fov = fov;
          persp.near = near;
          persp.far = far;
          persp.updateProjectionMatrix();
        }
        const c = controlsRef.current;
        if (c) {
          c.target.set(v.x + fx * 6, camY, v.z + fz * 6);
          c.enabled = false;
        }
        return;
      }
      pitch.current = THREE.MathUtils.clamp(pitch.current, -1.25, 0.55);
      if (!vehOrbit.current) {
        const dyaw = Math.atan2(Math.sin(v.yaw - yaw.current), Math.cos(v.yaw - yaw.current));
        yaw.current += dyaw * (1 - Math.exp(-3.2 * d));
        const wantPitch = v.kind === "plane" && v.airborne ? -0.12 : -0.18;
        pitch.current += (wantPitch - pitch.current) * (1 - Math.exp(-2.8 * d));
      }
      const dist = vehLive.camDist;
      const height = vehLive.camHeight;
      const lookAhead = v.kind === "plane" ? 14 : 5.5;
      const lookY = v.y + (v.kind === "plane" ? 0.4 : 0.55);
      const cy = Math.cos(pitch.current);
      const lx = -Math.sin(yaw.current) * cy;
      const ly = Math.sin(pitch.current);
      const lz = -Math.cos(yaw.current) * cy;
      let camX = v.x - lx * dist;
      let camY = lookY - ly * dist + height * 0.12;
      let camZ = v.z - lz * dist;
      if (v.kind === "plane" && v.airborne) {
        const rec = vehOrbit.current ? 0 : THREE.MathUtils.clamp(lookIdle.current / 0.4, 0, 1);
        const chaseX = v.x - fx * dist + ux * height * 0.55;
        const chaseY = v.y - fy * dist + uy * height * 0.55;
        const chaseZ = v.z - fz * dist + uz * height * 0.55;
        camX = camX + (chaseX - camX) * rec;
        camY = camY + (chaseY - camY) * rec;
        camZ = camZ + (chaseZ - camZ) * rec;
      } else {
        const gy = citySurfaceAt(camX, camZ);
        if (camY < gy + 0.7) camY = gy + 0.7;
        _camHit.set(v.x, lookY, v.z);
        _fpZ.set(camX - v.x, camY - lookY, camZ - v.z);
        const span = _fpZ.length();
        if (span > 0.2) {
          _fpZ.multiplyScalar(1 / span);
          const hit = cityRayPick(_camHit, _fpZ, span);
          if (hit) {
            const hd = _camHit.distanceTo(_fpFwd.set(hit.x, hit.y, hit.z));
            if (hd < span - 0.35) {
              const t = Math.max(1.2, hd - 0.45);
              camX = v.x + _fpZ.x * t;
              camY = lookY + _fpZ.y * t;
              camZ = v.z + _fpZ.z * t;
            }
          }
        }
      }
      const k = 1 - Math.exp(-8.5 * d);
      camera.position.x += (camX - camera.position.x) * k;
      camera.position.y += (camY - camera.position.y) * k;
      camera.position.z += (camZ - camera.position.z) * k;
      _fpFwd.set(v.x + fx * lookAhead - camera.position.x, lookY + fy * lookAhead + 0.2 - camera.position.y, v.z + fz * lookAhead - camera.position.z);
      if (v.kind === "plane" && v.airborne && !vehOrbit.current) {
        _fpFwd.set(v.x + fx * lookAhead - camera.position.x, v.y + fy * lookAhead + uy * 0.4 - camera.position.y, v.z + fz * lookAhead - camera.position.z);
        applyLookDir(camera, _fpFwd, v.yaw);
      } else {
        applyLookDir(camera, _fpFwd, yaw.current);
      }
      const fov = Math.min(88, st.fpFov + kick);
      const near = 0.45;
      const far = 5200;
      if (persp.fov !== fov || persp.near !== near || persp.far !== far) {
        persp.fov = fov;
        persp.near = near;
        persp.far = far;
        persp.updateProjectionMatrix();
      }
      const c = controlsRef.current;
      if (c) {
        c.target.set(v.x, lookY, v.z);
        c.enabled = false;
      }
      return;
    }
    syncFpProjection(camera, st.worldMap, st.fpView, st.fpFov);
    const body = st.fpView === "body";
    const fx = -Math.sin(yaw.current);
    const fz = -Math.cos(yaw.current);
    if (body) {
      camera.position.set(fpLive.eyeX, fpLive.eyeY, fpLive.eyeZ);
      applyFpLook(camera, yaw.current, pitch.current);
    } else {
      const lookY = pos.current.y + eye.current + bob.current;
      camera.position.set(pos.current.x, lookY, pos.current.z);
      applyFpLook(camera, yaw.current, pitch.current);
    }
    pullCameraOutOfWalls(camera, st.worldMap === "city", (camera as THREE.PerspectiveCamera).near, yaw.current, pitch.current);
    const c = controlsRef.current;
    if (c) {
      c.target.set(camera.position.x + fx, camera.position.y, camera.position.z + fz);
      c.enabled = false;
    }
  });

  return null;
}

function WorldClip() {
  const world = useStudio((s) => s.worldMap);
  const { camera, scene, gl } = useThree();
  useEffect(() => {
    const p = camera as THREE.PerspectiveCamera;
    const city = world === "city";
    p.far = city ? 5200 : 40;
    if (!useStudio.getState().firstPerson) p.near = city ? 0.2 : 0.05;
    p.updateProjectionMatrix();
    const bg = city ? "#7eafd0" : "#1a1614";
    scene.background = new THREE.Color(bg);
    scene.fog = city ? new THREE.Fog(0x7eafd0, 220, 3400) : null;
    gl.setClearColor(bg);
  }, [world, camera, scene, gl]);
  return null;
}

function CityWorld() {
  const world = useStudio((s) => s.worldMap);
  const mapOpen = useStudio((s) => s.cityMapOpen);
  const show = world === "city" || mapOpen;
  const [group, setGroup] = useState<THREE.Group | null>(() => getCityRuntime().group);
  useEffect(() => {
    if (!show) return;
    let n = 0;
    const id = window.setInterval(() => {
      const g = getCityRuntime().group;
      setGroup(g);
      if (g || ++n > 50) window.clearInterval(id);
    }, 80);
    return () => window.clearInterval(id);
  }, [show]);
  if (!group) return null;
  return <primitive object={group} visible={show} />;
}

function CityMapBake() {
  const world = useStudio((s) => s.worldMap);
  const mapOpen = useStudio((s) => s.cityMapOpen);
  useEffect(() => {
    if (world !== "city" && !mapOpen) return;
    let cancelled = false;
    (async () => {
      try {
        const model = await loadCityModel(() => {});
        if (cancelled) return;
        if (!getCityRuntime().ready || getCityRuntime().group !== model || getCityRuntime().bakeId !== CITY_BAKE_ID) bakeCityCollision(model);
      } catch {
        /* keep last world */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [world, mapOpen]);
  return null;
}

const _mapNdc = new THREE.Vector2();
const _mapRay = new THREE.Raycaster();
const cityMapPan = { x: 0, z: 0 };

function CityMapRig() {
  const open = useStudio((s) => s.cityMapOpen);
  const height = useStudio((s) => s.cityMapHeight);
  const { camera, gl, scene, size } = useThree();
  const drag = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  const prevFog = useRef<THREE.Fog | THREE.FogExp2 | null>(null);
  const prevUp = useRef(new THREE.Vector3(0, 1, 0));
  const prevProj = useRef({ fov: 50, near: 0.1, far: 40 });

  useEffect(() => {
    if (!open) return;
    cityMapPan.x = fpLive.x;
    cityMapPan.z = fpLive.z;
    const st = useStudio.getState();
    if (st.worldMap !== "city") {
      const sp = getCitySpawn();
      if (sp) {
        cityMapPan.x = sp.x;
        cityMapPan.z = sp.z;
      }
    }
    if (st.cityMapHeight < 50 || st.cityMapHeight > 400) st.setCityMapHeight(CITY_MAP_H_DEFAULT);
    prevFog.current = scene.fog;
    prevUp.current.copy(camera.up);
    const persp0 = camera as THREE.PerspectiveCamera;
    prevProj.current = { fov: persp0.fov, near: persp0.near, far: persp0.far };
    scene.fog = null;
    const el = gl.domElement;
    el.style.cursor = "grab";

    const vis = (h: number) => {
      const persp = camera as THREE.PerspectiveCamera;
      const fov = (persp.fov * Math.PI) / 180;
      const halfH = Math.tan(fov * 0.5) * h;
      const halfW = halfH * (size.width / Math.max(1, size.height));
      return { halfW, halfH };
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      const cur = useStudio.getState().cityMapHeight;
      const next = cur * Math.exp(dy * 0.0016);
      useStudio.getState().setCityMapHeight(next);
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 && e.pointerType === "mouse") return;
      drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      el.style.cursor = "grabbing";
      e.preventDefault();
    };

    const onMove = (e: PointerEvent) => {
      const d = drag.current;
      if (!d || d.id !== e.pointerId) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (!d.moved && Math.hypot(dx, dy) > 7) d.moved = true;
      if (!d.moved) return;
      d.x = e.clientX;
      d.y = e.clientY;
      const h = useStudio.getState().cityMapHeight;
      const { halfW, halfH } = vis(h);
      cityMapPan.x -= (dx / Math.max(1, size.width)) * halfW * 2;
      cityMapPan.z -= (dy / Math.max(1, size.height)) * halfH * 2;
      const rt = getCityRuntime();
      cityMapPan.x = THREE.MathUtils.clamp(cityMapPan.x, rt.minX, rt.maxX);
      cityMapPan.z = THREE.MathUtils.clamp(cityMapPan.z, rt.minZ, rt.maxZ);
    };

    const pickAt = (clientX: number, clientY: number) => {
      const rect = el.getBoundingClientRect();
      _mapNdc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
      _mapRay.setFromCamera(_mapNdc, camera);
      const hit = cityRayPick(_mapRay.ray.origin, _mapRay.ray.direction, camera.position.y + 900);
      if (hit) {
        useStudio.getState().setCityMapMarker({ x: hit.x, z: hit.z });
        return;
      }
      const dir = _mapRay.ray.direction;
      if (Math.abs(dir.y) < 1e-5) return;
      const t = -_mapRay.ray.origin.y / dir.y;
      if (t <= 0) return;
      const x = _mapRay.ray.origin.x + dir.x * t;
      const z = _mapRay.ray.origin.z + dir.z * t;
      useStudio.getState().setCityMapMarker({ x, z });
    };

    const onUp = (e: PointerEvent) => {
      const d = drag.current;
      if (!d || d.id !== e.pointerId) return;
      const moved = d.moved;
      drag.current = null;
      try {
        if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      el.style.cursor = "grab";
      if (!moved) pickAt(e.clientX, e.clientY);
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      el.style.cursor = "";
      camera.up.copy(prevUp.current);
      scene.fog = prevFog.current;
      const persp = camera as THREE.PerspectiveCamera;
      persp.fov = prevProj.current.fov;
      persp.near = prevProj.current.near;
      persp.far = prevProj.current.far;
      persp.updateProjectionMatrix();
    };
  }, [open, camera, gl, scene, size.width, size.height]);

  useFrame(() => {
    if (!open) return;
    const persp = camera as THREE.PerspectiveCamera;
    camera.up.set(0, 0, -1);
    camera.position.set(cityMapPan.x, height, cityMapPan.z);
    camera.lookAt(cityMapPan.x, 0, cityMapPan.z);
    persp.fov = 52;
    persp.near = Math.max(1, height * 0.04);
    persp.far = height + 900;
    persp.updateProjectionMatrix();
    if (scene.fog) scene.fog = null;
  });

  return null;
}

function makeArrowMesh() {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0xd4b5a0, depthTest: false, depthWrite: false });
  const body = new THREE.Mesh(new THREE.ConeGeometry(1.1, 3.4, 3), mat);
  body.rotation.x = -Math.PI / 2;
  body.position.z = -0.4;
  g.add(body);
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.55, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xf2efe9, depthTest: false, depthWrite: false }),
  );
  g.add(core);
  g.renderOrder = 12;
  return g;
}

function CityMapGizmos() {
  const open = useStudio((s) => s.cityMapOpen);
  const marker = useStudio((s) => s.cityMapMarker);
  const arrow = useMemo(() => makeArrowMesh(), []);
  const pin = useMemo(() => {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.7, 1.35, 24),
      new THREE.MeshBasicMaterial({ color: 0xd4b5a0, side: THREE.DoubleSide, depthTest: false, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    g.add(ring);
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, 3.2, 8),
      new THREE.MeshBasicMaterial({ color: 0xf2efe9, depthTest: false, depthWrite: false }),
    );
    pole.position.y = 1.6;
    g.add(pole);
    g.renderOrder = 13;
    return g;
  }, []);

  useFrame(() => {
    arrow.visible = open;
    pin.visible = open && !!marker;
    if (!open) return;
    const gy = citySurfaceAt(fpLive.x, fpLive.z);
    const h = useStudio.getState().cityMapHeight;
    const sc = THREE.MathUtils.clamp(h * 0.018, 1.6, 28);
    arrow.position.set(fpLive.x, gy + 0.15, fpLive.z);
    arrow.scale.setScalar(sc);
    arrow.rotation.set(0, fpLive.yaw, 0);
    if (marker) {
      const my = citySurfaceAt(marker.x, marker.z);
      pin.position.set(marker.x, my, marker.z);
      pin.scale.setScalar(sc);
    }
  });

  return (
    <>
      <primitive object={arrow} />
      <primitive object={pin} />
    </>
  );
}

function CollisionDebug() {
  const on = useStudio((s) => s.showCollision);
  const world = useStudio((s) => s.worldMap);
  const boxes = useMemo(() => {
    const group = new THREE.Group();
    group.name = "CollisionDebug";
    group.frustumCulled = false;
    const mat = new THREE.MeshBasicMaterial({
      color: 0x7ad0ff,
      transparent: true,
      opacity: 0.18,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const huge = mat.clone();
    huge.opacity = 0.07;
    huge.color.setHex(0x9ad8c8);
    for (let i = 0; i < 56; i++) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
      mesh.userData.huge = huge;
      mesh.userData.fill = mat;
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 10;
      group.add(mesh);
    }
    return group;
  }, []);
  const cap = useMemo(() => {
    const mesh = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.3, 1.04, 3, 8),
      new THREE.MeshBasicMaterial({
        color: 0x7ad0ff,
        depthTest: true,
        depthWrite: false,
        transparent: true,
        opacity: 0.26,
        side: THREE.DoubleSide,
      }),
    );
    mesh.frustumCulled = false;
    mesh.renderOrder = 11;
    return mesh;
  }, []);

  useFrame(() => {
    const show = on && world === "city" && getCityRuntime().ready;
    const inVeh = useStudio.getState().inVehicle || vehLive.inVehicle;
    boxes.visible = show;
    cap.visible = show && !inVeh;
    if (!show) return;
    const list = getCityDebugAabbs(fpLive.x, fpLive.z, 28, 56);
    for (let i = 0; i < boxes.children.length; i++) {
      const mesh = boxes.children[i] as THREE.Mesh;
      const box = list[i];
      if (!box) {
        mesh.visible = false;
        continue;
      }
      const w = Math.max(0.04, box.maxX - box.minX);
      const h = Math.max(0.04, box.maxY - box.minY);
      const d = Math.max(0.04, box.maxZ - box.minZ);
      const inside =
        fpLive.x >= box.minX &&
        fpLive.x <= box.maxX &&
        fpLive.z >= box.minZ &&
        fpLive.z <= box.maxZ &&
        fpLive.y + 0.4 >= box.minY &&
        fpLive.y <= box.maxY;
      if (inside && w * d > 16) {
        mesh.visible = false;
        continue;
      }
      mesh.visible = true;
      mesh.position.set((box.minX + box.maxX) * 0.5, (box.minY + box.maxY) * 0.5, (box.minZ + box.maxZ) * 0.5);
      mesh.scale.set(w, h, d);
      mesh.material = w * d > 80 ? (mesh.userData.huge as THREE.Material) : (mesh.userData.fill as THREE.Material);
    }
    const r = fpLive.prone ? 0.22 : fpLive.crouched ? 0.26 : 0.3;
    const h = fpLive.prone ? 0.42 : fpLive.crouched ? 0.94 : 1.64;
    cap.scale.set(r / 0.3, h / 1.64, r / 0.3);
    cap.position.set(fpLive.x, fpLive.y + h * 0.5, fpLive.z);
    const mat = cap.material as THREE.MeshBasicMaterial;
    mat.color.setHex(fpLive.grounded ? 0x7cff9a : 0xff6b5a);
  });

  return (
    <>
      <primitive object={boxes} />
      <primitive object={cap} />
    </>
  );
}

function makeDoorMarker(label: string, color: number) {
  const g = new THREE.Group();
  g.name = label;
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const pane = new THREE.Mesh(new THREE.PlaneGeometry(0.92, 2.05), mat);
  pane.position.y = 1.05;
  g.add(pane);
  const edge = new THREE.Mesh(
    new THREE.PlaneGeometry(0.98, 2.12),
    new THREE.MeshBasicMaterial({ color: 0xfff3d6, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }),
  );
  edge.position.y = 1.05;
  edge.position.z = -0.01;
  g.add(edge);
  const chev = new THREE.Mesh(
    new THREE.RingGeometry(0.11, 0.2, 3),
    new THREE.MeshBasicMaterial({ color: 0xfff8ee, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false }),
  );
  chev.position.set(0, 1.55, 0.02);
  chev.rotation.z = Math.PI;
  g.add(chev);
  return g;
}

function HomeExitDoor() {
  const world = useStudio((s) => s.worldMap);
  const group = useMemo(() => {
    const g = makeDoorMarker("HomeExit", 0x7ad0ff);
    const pad = new THREE.Mesh(
      new THREE.CircleGeometry(0.48, 20),
      new THREE.MeshBasicMaterial({
        color: 0x243848,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    pad.rotation.x = -Math.PI / 2;
    pad.position.y = 0.02;
    g.add(pad);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.4, 0.56, 24),
      new THREE.MeshBasicMaterial({
        color: 0x7ad0ff,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    g.add(ring);
    return g;
  }, []);
  useFrame(({ clock }) => {
    const pulse = 0.38 + Math.sin(clock.elapsedTime * 3.2) * 0.16;
    const pane = group.children[0] as THREE.Mesh;
    const mat = pane.material as THREE.MeshBasicMaterial;
    mat.opacity = pulse;
    group.visible = world === "home";
  });
  return <primitive object={group} position={[HOME_EXIT.x, 0, HOME_EXIT.z]} rotation={[0, Math.PI / 2, 0]} />;
}

function CityReturnDoor() {
  const world = useStudio((s) => s.worldMap);
  const group = useMemo(() => makeDoorMarker("CityReturn", 0xffc978), []);
  useFrame(({ clock }) => {
    const rt = getCityRuntime();
    group.visible = world === "city" && rt.ready;
    if (!group.visible) return;
    const pulse = 0.4 + Math.sin(clock.elapsedTime * 3.2) * 0.16;
    const pane = group.children[0] as THREE.Mesh;
    (pane.material as THREE.MeshBasicMaterial).opacity = pulse;
    const sp = rt.spawn;
    group.position.set(sp.x, sp.y, sp.z - 2.15);
    group.rotation.set(0, 0, 0);
  });
  return <primitive object={group} />;
}

let travelLock = false;

function WorldGate() {
  const [, bump] = useState(0);
  useEffect(() => {
    const go = async () => {
      const s = useStudio.getState();
      if (!s.firstPerson || travelLock || s.loading) return;
      if (s.inVehicle || vehLive.inVehicle) {
        tryExitVehicle();
        return;
      }
      const x = fpLive.x;
      const z = fpLive.z;
      if (s.worldMap === "city" && tryEnterVehicle(fpLive.x, fpLive.y, fpLive.z)) return;
      if (s.worldMap === "home" && nearHomeExit(x, z)) {
        travelLock = true;
        s.setFirstPerson(true, "body");
        useStudio.setState({ loading: true, loadError: null, loadProgress: 8, loadHint: "打开家门…" });
        try {
          const model = await loadCityModel((pct, hint) => {
            useStudio.setState({ loading: true, loadProgress: pct, loadHint: hint, loadError: null });
          });
          useStudio.setState({ loadProgress: 94, loadHint: "生成贴合模型的碰撞" });
          if (!getCityRuntime().ready || getCityRuntime().group !== model || getCityRuntime().bakeId !== CITY_BAKE_ID) bakeCityCollision(model);
          useStudio.setState({ worldMap: "city", portalHint: "", loadProgress: 100, loadHint: "进入城市" });
          bump((n) => n + 1);
          requestAnimationFrame(() => {
            useStudio.setState({ loading: false, loadProgress: 100, loadHint: "就绪" });
            travelLock = false;
          });
        } catch (err) {
          travelLock = false;
          useStudio.setState({
            loading: false,
            loadError: null,
            loadHint: "就绪",
            portalHint: err instanceof Error ? `城市载入失败：${err.message}` : "城市载入失败",
          });
        }
        return;
      }
      if (s.worldMap === "city" && nearCityPortal(x, z)) {
        resetVehicles();
        travelLock = true;
        useStudio.setState({ loading: true, loadError: null, loadProgress: 22, loadHint: "返回家中…" });
        s.setFirstPerson(true, "body");
        await new Promise((r) => setTimeout(r, 260));
        useStudio.setState({ worldMap: "home", portalHint: "", loadProgress: 80, loadHint: "进入房间" });
        await new Promise((r) => setTimeout(r, 180));
        useStudio.setState({ loading: false, loadProgress: 100, loadHint: "就绪" });
        travelLock = false;
      }
    };
    window.addEventListener("studio-fp-interact", go);
    return () => window.removeEventListener("studio-fp-interact", go);
  }, []);

  useFrame(() => {
    const s = useStudio.getState();
    if (!s.firstPerson) {
      if (s.portalHint) s.setPortalHint("");
      return;
    }
    let hint = "";
    if (s.inVehicle || vehLive.inVehicle) hint = "";
    else if (s.worldMap === "city") hint = vehicleHintAt(fpLive.x, fpLive.y, fpLive.z);
    if (!hint) {
      if (s.worldMap === "home" && nearHomeExit(fpLive.x, fpLive.z)) hint = "按 E / 互动 出门";
      else if (s.worldMap === "city" && nearCityPortal(fpLive.x, fpLive.z)) hint = "按 E / 互动 回家";
    }
    if (hint !== s.portalHint) s.setPortalHint(hint);
  });
  return null;
}

function StudioLights() {
  const home = useStudio((s) => s.worldMap === "home");
  return (
    <group visible={home}>
      <ambientLight intensity={0.34} color="#e6d8c8" />
      <hemisphereLight args={["#f2ebe3", "#3a322c", 0.48]} />
      <directionalLight position={[1.8, 3.4, 2.4]} intensity={1.05} color="#fff1e0" />
      <directionalLight position={[-2.6, 2.6, 0.8]} intensity={0.32} color="#c8d0dc" />
      <pointLight position={[0, 2.55, -1.35]} intensity={2.1} distance={8} decay={2} color="#ffd7b0" />
      <pointLight position={[1.4, 1.7, -2.1]} intensity={1.1} distance={4.2} decay={2} color="#ffc98a" />
    </group>
  );
}

function CityLights() {
  const on = useStudio((s) => s.worldMap === "city" || s.cityMapOpen);
  return (
    <group visible={on}>
      <ambientLight intensity={0.42} color="#d7e6f2" />
      <hemisphereLight args={["#c8e4ff", "#4a6a4a", 0.72]} />
      <directionalLight position={[80, 140, 40]} intensity={1.35} color="#fff4d6" />
      <directionalLight position={[-50, 40, -30]} intensity={0.28} color="#8eb4d8" />
    </group>
  );
}

function BodyFillLight() {
  const ref = useRef<THREE.PointLight>(null);
  const { camera } = useThree();
  const on = useStudio((s) => s.firstPerson && s.fpView === "body");
  const city = useStudio((s) => s.worldMap === "city");
  useFrame(() => {
    const l = ref.current;
    if (!l) return;
    if (!on || useStudio.getState().inVehicle) {
      l.intensity = 0;
      return;
    }
    l.position.copy(camera.position);
    const moving = Math.hypot(fpLive.moveFwd, fpLive.moveSide) > 0.1 || fpLive.sprinting;
    const base = city ? 0.06 : 0.18;
    l.intensity = moving ? base * 0.45 : base;
  });
  return (
    <pointLight
      ref={ref}
      name="BodyFillLight"
      color="#e6d4c6"
      distance={2.6}
      decay={2}
      intensity={0}
    />
  );
}
