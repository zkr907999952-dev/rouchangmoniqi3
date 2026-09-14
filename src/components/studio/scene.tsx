import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Suspense, useEffect, useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { Figure } from "./figure";
import { useStudio, type CamFocus } from "@/lib/studio-store";
import { CrouchHold, FpInput } from "@/lib/fp-control";
import { fpLive } from "@/lib/fp-pose";

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
        dpr={[1, 1.25]}
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
          <StudioLights />
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
  return <primitive object={room} />;
}

function ControlsBridge({
  controlsRef,
}: {
  controlsRef: RefObject<OrbitControlsImpl | null>;
}) {
  const autoRotate = useStudio((s) => s.autoRotate);
  const grabbing = useStudio((s) => s.grabbing);
  const firstPerson = useStudio((s) => s.firstPerson);
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
      enabled={!firstPerson}
      enableRotate={!grabbing && !firstPerson}
      enablePan={!grabbing && !firstPerson}
      enableDamping={!firstPerson}
      enableZoom={!firstPerson}
      dampingFactor={0.08}
      autoRotate={autoRotate && !grabbing && !firstPerson}
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
const FP_AIR = 1.35;
const FP_JUMP = 5.2;
const FP_GRAV = 13;
const FP_SENS = 0.0017;
const FP_TOUCH_SENS = 0.00305;
const FP_PITCH_LIM = Math.PI / 2 - 0.02;
const FP_BOUNDS = { x: 1.85, zMin: -1.55, zMax: 2.85, bodyR: 0.28 };
const ORBIT_HOME = { px: 0.28, py: 1.18, pz: 2.35, tx: 0, ty: 1.06, tz: 0.1, fov: 34 };
const _fpRight = new THREE.Vector3();
const _fpFwd = new THREE.Vector3();
const _fpUp = new THREE.Vector3();
const _fpZ = new THREE.Vector3();
const _fpMat = new THREE.Matrix4();

function lookDirFromYawPitch(yaw: number, pitch: number, out: THREE.Vector3) {
  const cy = Math.cos(pitch);
  out.set(-Math.sin(yaw) * cy, Math.sin(pitch), -Math.cos(yaw) * cy);
  return out;
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

function FirstPersonRig({
  controlsRef,
}: {
  controlsRef: RefObject<OrbitControlsImpl | null>;
}) {
  const { camera, gl } = useThree();
  const firstPerson = useStudio((s) => s.firstPerson);
  const fpView = useStudio((s) => s.fpView);
  const lookLocked = useStudio((s) => s.fpLookLocked);
  const fpFov = useStudio((s) => s.fpFov);
  const pos = useRef(new THREE.Vector3(0.12, 0, 1.92));
  const velY = useRef(0);
  const yaw = useRef(0);
  const pitch = useRef(-0.08);
  const grounded = useRef(true);
  const coyote = useRef(0);
  const jumpBuf = useRef(0);
  const eye = useRef(FP_STAND);
  const bob = useRef(0);
  const distWalk = useRef(0);
  const input = useRef(new FpInput());
  const lookTouch = useRef<{ id: number; x: number; y: number } | null>(null);
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
  const speedRef = useRef(0);
  const crouchGate = useRef<CrouchHold | null>(null);

  useEffect(() => {
    const gate = new CrouchHold(
      () => {
        const s = useStudio.getState();
        if (!s.firstPerson) return;
        if (s.fpProne) {
          s.setFpProne(false);
          s.setFpCrouch(false);
        } else {
          s.setFpCrouch(!s.fpCrouch);
        }
      },
      () => {
        const s = useStudio.getState();
        if (!s.firstPerson) return;
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
      const body = fpView === "body";
      if (body) {
        pos.current.set(0, 0, 0);
        yaw.current = Math.PI;
        pitch.current = -0.72;
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
      eye.current = FP_STAND;
      grounded.current = true;
      persp.fov = useStudio.getState().fpFov;
      persp.near = body ? 0.04 : 0.08;
      persp.updateProjectionMatrix();
      fpLive.active = true;
      fpLive.view = fpView;
      input.current.gate = crouchGate.current;
      input.current.attach();
    } else {
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
  }, [firstPerson, fpView, camera, controlsRef]);

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
      if (!useStudio.getState().fpLookLocked) return;
      const sens = FP_SENS * useStudio.getState().fpLookSpeed;
      yaw.current -= e.movementX * sens;
      pitch.current -= e.movementY * sens;
      pitch.current = THREE.MathUtils.clamp(pitch.current, -FP_PITCH_LIM, FP_PITCH_LIM);
    };
    const onPointerDown = (e: PointerEvent) => {
      if (e.button === 2) {
        e.preventDefault();
        e.stopPropagation();
        const st = useStudio.getState();
        if (st.fpLookLocked) {
          st.setFpLookLocked(false);
          if (document.pointerLockElement) document.exitPointerLock();
        } else {
          st.setFpLookLocked(true);
          tryLock();
        }
        return;
      }
      if (e.pointerType === "touch" && e.button === 0) {
        const r = el.getBoundingClientRect();
        if (e.clientX < r.left + r.width * 0.42) return;
        lookTouch.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
      }
    };
    const onPointerMove = (e: PointerEvent) => {
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
      if (lookTouch.current?.id === e.pointerId) lookTouch.current = null;
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
      getYaw: () => yaw.current,
      getPitch: () => pitch.current,
      setPitch: (v: number) => {
        pitch.current = THREE.MathUtils.clamp(v, -FP_PITCH_LIM, FP_PITCH_LIM);
      },
      setLook: (y: number, p: number) => {
        yaw.current = y;
        pitch.current = THREE.MathUtils.clamp(p, -FP_PITCH_LIM, FP_PITCH_LIM);
      },
      getLookSpeed: () => useStudio.getState().fpLookSpeed,
      applyLook: (dx: number, dy: number) => {
        const sens = FP_SENS * useStudio.getState().fpLookSpeed;
        yaw.current -= dx * sens;
        pitch.current -= dy * sens;
        pitch.current = THREE.MathUtils.clamp(pitch.current, -FP_PITCH_LIM, FP_PITCH_LIM);
      },
      getSpeed: () => speedRef.current,
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
        canvas: [gl.domElement.width, gl.domElement.height, gl.domElement.clientWidth, gl.domElement.clientHeight],
        tri: gl.info.render.triangles,
        calls: gl.info.render.calls,
      }),
      setCrouchHeld: (v: boolean) => crouchGate.current?.setHeld(v),
      setKeys: (codes: string[]) => input.current.setKeys(codes),
      setSteer: (v: number) => {
        input.current.stickX = -v;
        input.current.stickY = 1;
      },
    };
    window.__controlsTest = probe;
    return () => {
      if (window.__controlsTest === probe) delete window.__controlsTest;
    };
  }, []);

  useFrame((_, dt) => {
    if (!firstPerson) return;
    const d = Math.min(0.05, Math.max(0.001, dt));
    const st = useStudio.getState();
    const body = st.fpView === "body";
    input.current.stickX = st.fpStickX;
    input.current.stickY = st.fpStickY;
    input.current.crouchHold = st.fpCrouchHeld;
    if (st.fpJumpNonce !== lastJumpNonce.current) {
      lastJumpNonce.current = st.fpJumpNonce;
      input.current.jumpTap = true;
    }
    const act = input.current.poll();
    crouchGate.current?.setHeld(act.crouchHeld);
    const live = useStudio.getState();
    const crouched = live.fpCrouch;
    const prone = live.fpProne;
    if (st.fpInteractNonce !== lastInteractNonce.current) {
      lastInteractNonce.current = st.fpInteractNonce;
      window.dispatchEvent(new Event("studio-fp-interact"));
    } else if (act.interact) {
      window.dispatchEvent(new Event("studio-fp-interact"));
    }

    const wantEye = prone ? FP_PRONE : crouched ? FP_CROUCH : FP_STAND;
    eye.current += (wantEye - eye.current) * (1 - Math.exp(-10 * d));

    const fx = -Math.sin(yaw.current);
    const fz = -Math.cos(yaw.current);
    const rx = Math.cos(yaw.current);
    const rz = -Math.sin(yaw.current);
    const speed = grounded.current
      ? prone
        ? FP_WALK * 0.28
        : crouched
          ? FP_WALK * 0.45
          : FP_WALK
      : FP_AIR;
    const wishX = rx * act.moveX + fx * act.moveY;
    const wishZ = rz * act.moveX + fz * act.moveY;
    const wishLen = Math.hypot(wishX, wishZ);
    const nx = wishLen > 1e-5 ? wishX / wishLen : 0;
    const nz = wishLen > 1e-5 ? wishZ / wishLen : 0;
    const step = speed * Math.min(1, wishLen) * d;
    const prevX = pos.current.x;
    const prevZ = pos.current.z;
    let x = pos.current.x + nx * step;
    let z = pos.current.z + nz * step;
    x = THREE.MathUtils.clamp(x, -FP_BOUNDS.x, FP_BOUNDS.x);
    z = THREE.MathUtils.clamp(z, FP_BOUNDS.zMin, FP_BOUNDS.zMax);
    const br = FP_BOUNDS.bodyR;
    const r2 = x * x + z * z;
    if (!body && r2 < br * br && pos.current.y < 1.75) {
      const r = Math.sqrt(r2) || 1e-6;
      x = (x / r) * br;
      z = (z / r) * br;
    }
    pos.current.x = x;
    pos.current.z = z;
    speedRef.current = wishLen * speed;
    const stepDist = Math.hypot(x - prevX, z - prevZ);

    if (grounded.current) coyote.current = 0.12;
    else coyote.current = Math.max(0, coyote.current - d);
    if (act.jump && prone) {
      useStudio.getState().setFpProne(false);
      useStudio.getState().setFpCrouch(false);
    }
    if (act.jump) jumpBuf.current = 0.12;
    else jumpBuf.current = Math.max(0, jumpBuf.current - d);
    if (jumpBuf.current > 0 && coyote.current > 0) {
      velY.current = FP_JUMP;
      grounded.current = false;
      coyote.current = 0;
      jumpBuf.current = 0;
    }
    velY.current -= FP_GRAV * d;
    pos.current.y += velY.current * d;
    if (pos.current.y <= 0) {
      pos.current.y = 0;
      velY.current = 0;
      grounded.current = true;
    } else {
      grounded.current = false;
    }

    if (grounded.current && wishLen > 0.12) distWalk.current += step;
    else distWalk.current *= 1 - d * 4;
    const bobAmp = grounded.current && wishLen > 0.12 ? (prone ? 0.006 : crouched ? 0.01 : 0.018) : 0;
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
    fpLive.moveFwd = act.moveY;
    fpLive.moveSide = act.moveX;
    fpLive.speedMps = speed;
    fpLive.stepDist = grounded.current ? stepDist : 0;
    fpLive.grounded = grounded.current;
    fpLive.velY = velY.current;
    if (grounded.current) fpLive.airTime = 0;
    else fpLive.airTime += d;
  }, -1);

  useFrame(() => {
    if (!firstPerson) return;
    const body = useStudio.getState().fpView === "body";
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
    const c = controlsRef.current;
    if (c) {
      c.target.set(camera.position.x + fx, camera.position.y, camera.position.z + fz);
      c.enabled = false;
    }
  });

  return null;
}

function StudioLights() {
  return (
    <>
      <ambientLight intensity={0.34} color="#e6d8c8" />
      <hemisphereLight args={["#f2ebe3", "#3a322c", 0.48]} />
      <directionalLight position={[1.8, 3.4, 2.4]} intensity={1.05} color="#fff1e0" />
      <directionalLight position={[-2.6, 2.6, 0.8]} intensity={0.32} color="#c8d0dc" />
      <pointLight position={[0, 2.55, -1.35]} intensity={2.1} distance={8} decay={2} color="#ffd7b0" />
      <pointLight position={[1.4, 1.7, -2.1]} intensity={1.1} distance={4.2} decay={2} color="#ffc98a" />
    </>
  );
}

function BodyFillLight() {
  const ref = useRef<THREE.PointLight>(null);
  const on = useStudio((s) => s.firstPerson && s.fpView === "body");
  useFrame(() => {
    const l = ref.current;
    if (!l) return;
    if (!on) {
      l.intensity = 0;
      return;
    }
    l.intensity = 2.4;
    l.position.set(fpLive.eyeX + 0.04, fpLive.eyeY + 0.1, fpLive.eyeZ + 0.06);
  });
  return <pointLight ref={ref} color="#ffd2b6" distance={1.6} decay={2} intensity={0} />;
}
