import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Suspense, useEffect, useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { Figure } from "./figure";
import { useStudio, type CamFocus } from "@/lib/studio-store";
import { FpInput } from "@/lib/fp-control";

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
const FP_CROUCH = 1.08;
const FP_WALK = 1.65;
const FP_AIR = 1.15;
const FP_JUMP = 3.15;
const FP_GRAV = 14;
const FP_SENS = 0.00215;
const FP_BOUNDS = { x: 1.85, zMin: -1.55, zMax: 2.85, bodyR: 0.28 };

function FirstPersonRig({
  controlsRef,
}: {
  controlsRef: RefObject<OrbitControlsImpl | null>;
}) {
  const { camera, gl } = useThree();
  const firstPerson = useStudio((s) => s.firstPerson);
  const lookLocked = useStudio((s) => s.fpLookLocked);
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

  useEffect(() => {
    const persp = camera as THREE.PerspectiveCamera;
    if (firstPerson) {
      const c = controlsRef.current;
      orbitSnap.current = {
        px: camera.position.x,
        py: camera.position.y,
        pz: camera.position.z,
        tx: c?.target.x ?? 0,
        ty: c?.target.y ?? 1.06,
        tz: c?.target.z ?? 0.1,
        fov: persp.fov,
      };
      pos.current.set(0.12, 0, 1.92);
      velY.current = 0;
      yaw.current = 0;
      pitch.current = -0.08;
      eye.current = FP_STAND;
      grounded.current = true;
      persp.fov = 75;
      persp.near = 0.08;
      persp.updateProjectionMatrix();
      camera.position.set(0.12, FP_STAND, 1.92);
      camera.lookAt(0.12, FP_STAND - 0.08, 0.92);
      input.current.attach();
    } else {
      input.current.detach();
      if (document.pointerLockElement) document.exitPointerLock();
      useStudio.getState().setFpLookLocked(false);
      const snap = orbitSnap.current;
      if (snap) {
        camera.position.set(snap.px, snap.py, snap.pz);
        persp.fov = snap.fov;
        persp.near = 0.05;
        persp.updateProjectionMatrix();
        const c = controlsRef.current;
        if (c) {
          c.target.set(snap.tx, snap.ty, snap.tz);
          c.enabled = true;
          c.update();
        }
        camera.lookAt(snap.tx, snap.ty, snap.tz);
      }
    }
    return () => input.current.detach();
  }, [firstPerson, camera, controlsRef]);

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
      yaw.current -= e.movementX * FP_SENS;
      pitch.current -= e.movementY * FP_SENS;
      pitch.current = THREE.MathUtils.clamp(pitch.current, -1.35, 1.35);
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
      yaw.current -= dx * 0.0045;
      pitch.current -= dy * 0.0045;
      pitch.current = THREE.MathUtils.clamp(pitch.current, -1.35, 1.35);
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
      getSpeed: () => speedRef.current,
      getPos: () => pos.current.toArray() as [number, number, number],
      getEye: () => eye.current,
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
    input.current.stickX = st.fpStickX;
    input.current.stickY = st.fpStickY;
    input.current.crouchHold = st.fpCrouch;
    if (st.fpJumpNonce !== lastJumpNonce.current) {
      lastJumpNonce.current = st.fpJumpNonce;
      input.current.jumpTap = true;
    }
    const act = input.current.poll();
    if (st.fpInteractNonce !== lastInteractNonce.current) {
      lastInteractNonce.current = st.fpInteractNonce;
      window.dispatchEvent(new Event("studio-fp-interact"));
    } else if (act.interact) {
      window.dispatchEvent(new Event("studio-fp-interact"));
    }

    const wantEye = act.crouch ? FP_CROUCH : FP_STAND;
    eye.current += (wantEye - eye.current) * (1 - Math.exp(-10 * d));

    const fx = -Math.sin(yaw.current);
    const fz = -Math.cos(yaw.current);
    const rx = Math.cos(yaw.current);
    const rz = -Math.sin(yaw.current);
    const speed = grounded.current ? (act.crouch ? FP_WALK * 0.45 : FP_WALK) : FP_AIR;
    const wishX = rx * act.moveX + fx * act.moveY;
    const wishZ = rz * act.moveX + fz * act.moveY;
    const wishLen = Math.hypot(wishX, wishZ);
    const nx = wishLen > 1e-5 ? wishX / wishLen : 0;
    const nz = wishLen > 1e-5 ? wishZ / wishLen : 0;
    const step = speed * Math.min(1, wishLen) * d;
    let x = pos.current.x + nx * step;
    let z = pos.current.z + nz * step;
    x = THREE.MathUtils.clamp(x, -FP_BOUNDS.x, FP_BOUNDS.x);
    z = THREE.MathUtils.clamp(z, FP_BOUNDS.zMin, FP_BOUNDS.zMax);
    const br = FP_BOUNDS.bodyR;
    const r2 = x * x + z * z;
    if (r2 < br * br && pos.current.y < 1.75) {
      const r = Math.sqrt(r2) || 1e-6;
      x = (x / r) * br;
      z = (z / r) * br;
    }
    pos.current.x = x;
    pos.current.z = z;
    speedRef.current = wishLen * speed;

    if (grounded.current) coyote.current = 0.12;
    else coyote.current = Math.max(0, coyote.current - d);
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
    const bobAmp = grounded.current && wishLen > 0.12 ? 0.018 : 0;
    bob.current = Math.sin(distWalk.current * 14) * bobAmp;

    const lookY = pos.current.y + eye.current + bob.current;
    camera.position.set(pos.current.x, lookY, pos.current.z);
    const cy = Math.cos(pitch.current);
    camera.lookAt(
      pos.current.x + fx * cy,
      lookY + Math.sin(pitch.current),
      pos.current.z + fz * cy,
    );
    const c = controlsRef.current;
    if (c) {
      c.target.set(pos.current.x + fx * cy, lookY + Math.sin(pitch.current), pos.current.z + fz * cy);
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
