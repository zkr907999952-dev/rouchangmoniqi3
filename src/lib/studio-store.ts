import { CITY_MAP_H_DEFAULT, CITY_MAP_H_MAX, CITY_MAP_H_MIN } from "@/lib/world-map";
import { create } from "zustand";
import type { ExpressionId, HandGesture, HandSide, PoseId } from "@/lib/softbody/soft-skeleton";
import type { FpViewMode } from "@/lib/fp-pose";

export type WorldId = "home" | "city";
export type VehicleCam = "third" | "first";
export type VehicleKind = "car" | "plane";

export type PresetId = "soft" | "firm" | "jelly" | "athletic";
export type InteractMode = "drag" | "pose" | "strike" | "fist" | "bayonet" | "navel";
export type PoseEditMode = "ik" | "rotate" | "move";
export type BayonetKind = "short" | "long";
export type BedStance = "front" | "on" | "lie";

export type CamSnap = {
  px: number;
  py: number;
  pz: number;
  tx: number;
  ty: number;
  tz: number;
};

export type CamFocus = "face" | "chest" | "belly" | "groin";

export type CamCmd =
  | { nonce: number; kind: "snap"; snap: CamSnap }
  | { nonce: number; kind: "focus"; focus: CamFocus }
  | { nonce: number; kind: "zoom"; dist: number }
  | { nonce: number; kind: "pan"; dx: number; dy: number; dz: number };

export type StudioParams = {
  stiffness: number;
  damping: number;
  gravity: number;
  pressure: number;
  jiggle: number;
  wind: number;
  breathing: boolean;
  breathAmp: number;
  breathSpeed: number;
  slowMo: boolean;
  showLattice: boolean;
  showWeights: boolean;
  autoRotate: boolean;
  abdomenXray: number;
  bellyInflate: number;
  navelDepth: number;
  navelDiameter: number;
  navelInsert: number;
  navelDepthRatio: number;
  navelThrust: boolean;
  navelStir: boolean;
  navelThrustSpeed: number;
  navelThrustStart: number;
  navelStirSpeed: number;
  navelStirRadius: number;
  showOrgans: boolean;
  showGutHp: boolean;
  gutAmp: number;
  gutSpeed: number;
  strikeForce: number;
  strikeRange: number;
  strikeRebound: number;
  fistBulge: number;
  fistSpread: number;
  fistGut: number;
  fistLever: number;
  fistMaxDepth: number;
  fistRise: number;
  fistThrust: boolean;
  fistStir: boolean;
  fistThrustSpeed: number;
  fistThrustStart: number;
  fistStirSpeed: number;
  fistStirRadius: number;
  breastSoft: number;
  breastDamp: number;
  hairDamp: number;
  breastInertia: number;
  hairInertia: number;
  bedStance: BedStance;
  uiHidden: boolean;
};

/** Park fingertip is ~5cm in front of the navel; full insert is ~5cm in. Contact is halfway. */
export const NAVEL_CONTACT_T = 0.5;
export const FP_FOV_MIN = 28;
export const FP_FOV_MAX = 100;
export const FP_FOV_DEFAULT = 62;
export const FP_LOOK_SPEED_MIN = 0.25;
export const FP_LOOK_SPEED_MAX = 2;
export const FP_LOOK_SPEED_DEFAULT = 0.9;
export const MIRROR_RES_MIN = 256;
export const MIRROR_RES_MAX = 1024;
export const MIRROR_RES_DEFAULT = 640;
export const FP_BREAST_JIGGLE_MIN = 0;
export const FP_BREAST_JIGGLE_MAX = 1;
export const FP_BREAST_JIGGLE_DEFAULT = 0.4;
export const NAVEL_DEPTH_BASE = 0.06;
export const NAVEL_DIA_BASE = 0.42;
export const NAVEL_DEPTH_RATIO_DEFAULT = 0.7;

export function navelInsertMorph(insert: number, ratio: number) {
  const t = Math.max(0, Math.min(1, insert));
  const r = Math.max(0, Math.min(1.2, ratio));
  const u = t <= NAVEL_CONTACT_T ? 0 : (t - NAVEL_CONTACT_T) / (1 - NAVEL_CONTACT_T);
  return {
    u,
    depth: NAVEL_DEPTH_BASE + u * r,
    diameter: NAVEL_DIA_BASE + u * r * 0.5,
    squeeze: u * Math.min(1, r * 0.72),
  };
}

export const PRESETS: Record<
  PresetId,
  { label: string; hint: string } & StudioParams
> = {
  soft: {
    label: "柔软",
    hint: "松弛回弹",
    stiffness: 0.28,
    damping: 0.94,
    gravity: -1.4,
    pressure: 0.55,
    jiggle: 1,
    wind: 0,
    breathing: true,
    breathAmp: 0.4,
    breathSpeed: 0.3,
    slowMo: false,
    showLattice: false,
    showWeights: false,
    autoRotate: false,
    abdomenXray: 0.38,
    bellyInflate: 0,
    navelDepth: 0,
    navelDiameter: 0,
    navelInsert: 0,
    navelDepthRatio: 0.7,
    navelThrust: false,
    navelStir: false,
    navelThrustSpeed: 0.45,
    navelThrustStart: 0.5,
    navelStirSpeed: 0.55,
    navelStirRadius: 0.4,
    showOrgans: true,
    showGutHp: false,
    gutAmp: 0.3,
    gutSpeed: 0.5,
    strikeForce: 0.52,
    strikeRange: 0.32,
    strikeRebound: 0.72,
    fistBulge: 1.4,
    fistSpread: 1,
    fistGut: 1,
    fistLever: 1,
    fistMaxDepth: 1,
    fistRise: 0.7,
    fistThrust: false,
    fistStir: false,
    fistThrustSpeed: 0.45,
    fistThrustStart: 0.025,
    fistStirSpeed: 0.55,
    fistStirRadius: 0.4,
    breastSoft: 0.02,
    breastDamp: 0.12,
    hairDamp: 0.01,
    breastInertia: 0.55,
    hairInertia: 0.55,
    bedStance: "front",
    uiHidden: false,
  },
  firm: {
    label: "紧致",
    hint: "快速复位",
    stiffness: 0.82,
    damping: 0.9,
    gravity: -0.4,
    pressure: 0.85,
    jiggle: 0.55,
    wind: 0,
    breathing: true,
    breathAmp: 0.4,
    breathSpeed: 0.3,
    slowMo: false,
    showLattice: false,
    showWeights: false,
    autoRotate: false,
    abdomenXray: 0.38,
    bellyInflate: 0,
    navelDepth: 0,
    navelDiameter: 0,
    navelInsert: 0,
    navelDepthRatio: 0.7,
    navelThrust: false,
    navelStir: false,
    navelThrustSpeed: 0.45,
    navelThrustStart: 0.5,
    navelStirSpeed: 0.55,
    navelStirRadius: 0.4,
    showOrgans: true,
    showGutHp: false,
    gutAmp: 0.3,
    gutSpeed: 0.5,
    strikeForce: 0.52,
    strikeRange: 0.32,
    strikeRebound: 0.72,
    fistBulge: 1.4,
    fistSpread: 1,
    fistGut: 1,
    fistLever: 1,
    fistMaxDepth: 1,
    fistRise: 0.7,
    fistThrust: false,
    fistStir: false,
    fistThrustSpeed: 0.45,
    fistThrustStart: 0.025,
    fistStirSpeed: 0.55,
    fistStirRadius: 0.4,
    breastSoft: 0.02,
    breastDamp: 0.12,
    hairDamp: 0.01,
    breastInertia: 0.55,
    hairInertia: 0.55,
    bedStance: "front",
    uiHidden: false,
  },
  jelly: {
    label: "果冻",
    hint: "长时间晃动",
    stiffness: 0.16,
    damping: 0.985,
    gravity: -0.2,
    pressure: 0.7,
    jiggle: 1,
    wind: 0.15,
    breathing: false,
    breathAmp: 0.4,
    breathSpeed: 0.3,
    slowMo: false,
    showLattice: false,
    showWeights: false,
    autoRotate: false,
    abdomenXray: 0.38,
    bellyInflate: 0,
    navelDepth: 0,
    navelDiameter: 0,
    navelInsert: 0,
    navelDepthRatio: 0.7,
    navelThrust: false,
    navelStir: false,
    navelThrustSpeed: 0.45,
    navelThrustStart: 0.5,
    navelStirSpeed: 0.55,
    navelStirRadius: 0.4,
    showOrgans: true,
    showGutHp: false,
    gutAmp: 0.3,
    gutSpeed: 0.5,
    strikeForce: 0.52,
    strikeRange: 0.32,
    strikeRebound: 0.72,
    fistBulge: 1.4,
    fistSpread: 1,
    fistGut: 1,
    fistLever: 1,
    fistMaxDepth: 1,
    fistRise: 0.7,
    fistThrust: false,
    fistStir: false,
    fistThrustSpeed: 0.45,
    fistThrustStart: 0.025,
    fistStirSpeed: 0.55,
    fistStirRadius: 0.4,
    breastSoft: 0.02,
    breastDamp: 0.12,
    hairDamp: 0.01,
    breastInertia: 0.55,
    hairInertia: 0.55,
    bedStance: "front",
    uiHidden: false,
  },
  athletic: {
    label: "运动",
    hint: "弹性支撑",
    stiffness: 0.58,
    damping: 0.92,
    gravity: -0.8,
    pressure: 0.72,
    jiggle: 0.78,
    wind: 0,
    breathing: true,
    breathAmp: 0.4,
    breathSpeed: 0.3,
    slowMo: false,
    showLattice: false,
    showWeights: false,
    autoRotate: false,
    abdomenXray: 0.38,
    bellyInflate: 0,
    navelDepth: 0,
    navelDiameter: 0,
    navelInsert: 0,
    navelDepthRatio: 0.7,
    navelThrust: false,
    navelStir: false,
    navelThrustSpeed: 0.45,
    navelThrustStart: 0.5,
    navelStirSpeed: 0.55,
    navelStirRadius: 0.4,
    showOrgans: true,
    showGutHp: false,
    gutAmp: 0.3,
    gutSpeed: 0.5,
    strikeForce: 0.52,
    strikeRange: 0.32,
    strikeRebound: 0.72,
    fistBulge: 1.4,
    fistSpread: 1,
    fistGut: 1,
    fistLever: 1,
    fistMaxDepth: 1,
    fistRise: 0.7,
    fistThrust: false,
    fistStir: false,
    fistThrustSpeed: 0.45,
    fistThrustStart: 0.025,
    fistStirSpeed: 0.55,
    fistStirRadius: 0.4,
    breastSoft: 0.02,
    breastDamp: 0.12,
    hairDamp: 0.01,
    breastInertia: 0.55,
    hairInertia: 0.55,
    bedStance: "front",
    uiHidden: false,
  },
};

type StudioState = StudioParams & {
  preset: PresetId;
  interactMode: InteractMode;
  poseEditMode: PoseEditMode;
  selectedBone: number;
  selectedBoneName: string;
  expression: ExpressionId;
  pose: PoseId;
  handSide: HandSide;
  handGestureL: HandGesture;
  handGestureR: HandGesture;
  energy: number;
  grabbing: boolean;
  shakeNonce: number;
  resetNonce: number;
  strikeNonce: number;
  strikePoint: [number, number, number] | null;
  loading: boolean;
  loadProgress: number;
  loadHint: string;
  loadError: string | null;
  retryNonce: number;
  bayonetHasEntry: boolean;
  bayonetPen: number;
  bayonetAuto: boolean;
  bayonetPump: boolean;
  bayonetKind: BayonetKind;
  gazeFollow: boolean;
  blinkEnabled: boolean;
  eyeOpenL: number;
  eyeOpenR: number;
  blinkRate: number;
  blinkSpeed: number;
  mouthOpen: number;
  mouthAmp: number;
  mouthChinAmp: number;
  mouthLipAmp: number;
  mouthSmile: number;
  mouthPucker: number;
  mouthWidth: number;
  cameraLive: CamSnap;
  cameraPresets: (CamSnap | null)[];
  cameraPresetIndex: number | null;
  camFocus: CamFocus | null;
  camCmd: CamCmd | null;
  firstPerson: boolean;
  fpView: FpViewMode;
  fpLookLocked: boolean;
  fpCrouch: boolean;
  fpProne: boolean;
  fpCrouchHeld: boolean;
  fpStickX: number;
  fpStickY: number;
  fpJumpNonce: number;
  fpInteractNonce: number;
  fpFov: number;
  fpLookSpeed: number;
  mirrorRes: number;
  fpBreastJiggle: number;
  worldMap: WorldId;
  portalHint: string;
  cityMapOpen: boolean;
  cityMapMarker: { x: number; z: number } | null;
  cityMapHeight: number;
  showCollision: boolean;
  fpWarpNonce: number;
  fpWarpX: number;
  fpWarpY: number;
  fpWarpZ: number;
  inVehicle: boolean;
  vehicleKind: VehicleKind | null;
  vehicleSpeed: number;
  vehicleThrust: number;
  vehicleNitro: boolean;
  vehicleAirborne: boolean;
  vehicleGear: boolean;
  vehicleCam: VehicleCam;
  vehNitroHeld: boolean;
  vehDriftHeld: boolean;
  vehYawHeld: number;
  vehThrustSlider: number | null;
  setParam: <K extends keyof StudioParams>(key: K, value: StudioParams[K]) => void;
  applyPreset: (id: PresetId) => void;
  setInteractMode: (mode: InteractMode) => void;
  setPoseEditMode: (mode: PoseEditMode) => void;
  setSelectedBone: (i: number, name?: string) => void;
  setExpression: (id: ExpressionId) => void;
  setPose: (id: PoseId) => void;
  setNavelInsert: (v: number) => void;
  setNavelDepthRatio: (v: number) => void;
  setHandSide: (side: HandSide) => void;
  setHandGesture: (id: HandGesture) => void;
  setEnergy: (v: number) => void;
  setGrabbing: (v: boolean) => void;
  setBayonetHasEntry: (v: boolean) => void;
  setBayonetPen: (v: number) => void;
  setBayonetAuto: (v: boolean) => void;
  setBayonetPump: (v: boolean) => void;
  setBayonetKind: (kind: BayonetKind) => void;
  setGazeFollow: (v: boolean) => void;
  setBlinkEnabled: (v: boolean) => void;
  setEyeOpenL: (v: number) => void;
  setEyeOpenR: (v: number) => void;
  setBlinkRate: (v: number) => void;
  setBlinkSpeed: (v: number) => void;
  setMouthOpen: (v: number) => void;
  setMouthAmp: (v: number) => void;
  setMouthChinAmp: (v: number) => void;
  setMouthLipAmp: (v: number) => void;
  setMouthSmile: (v: number) => void;
  setMouthPucker: (v: number) => void;
  setMouthWidth: (v: number) => void;
  setCameraLive: (snap: CamSnap) => void;
  saveCameraPreset: (i: number) => void;
  applyCameraPreset: (i: number) => void;
  setCamFocus: (focus: CamFocus) => void;
  setCameraZoom: (dist: number) => void;
  panCamera: (dx: number, dy: number, dz: number) => void;
  setFirstPerson: (v: boolean, view?: FpViewMode) => void;
  setFpView: (v: FpViewMode) => void;
  setFpLookLocked: (v: boolean) => void;
  setFpCrouch: (v: boolean) => void;
  setFpProne: (v: boolean) => void;
  setFpCrouchHeld: (v: boolean) => void;
  setFpStick: (x: number, y: number) => void;
  tapFpJump: () => void;
  tapFpInteract: () => void;
  setFpFov: (v: number) => void;
  setFpLookSpeed: (v: number) => void;
  setMirrorRes: (v: number) => void;
  setFpBreastJiggle: (v: number) => void;
  setWorldMap: (v: WorldId) => void;
  setPortalHint: (v: string) => void;
  setCityMapOpen: (v: boolean) => void;
  setCityMapMarker: (v: { x: number; z: number } | null) => void;
  setCityMapHeight: (v: number) => void;
  setShowCollision: (v: boolean) => void;
  warpFp: (x: number, y: number, z: number) => void;
  setVehNitroHeld: (v: boolean) => void;
  setVehDriftHeld: (v: boolean) => void;
  setVehYawHeld: (v: number) => void;
  setVehThrustSlider: (v: number | null) => void;
  toggleVehicleCam: () => void;
  setVehicleCam: (v: VehicleCam) => void;
  shake: () => void;
  fireStrike: (point?: [number, number, number] | null) => void;
  resetSim: () => void;
  retryLoad: () => void;
};

export const useStudio = create<StudioState>((set) => ({
  ...PRESETS.soft,
  preset: "soft",
  interactMode: "drag",
  poseEditMode: "ik" as PoseEditMode,
  selectedBone: -1,
  selectedBoneName: "",
  expression: "rest",
  pose: "idle",
  handSide: "R",
  handGestureL: "rest",
  handGestureR: "rest",
  energy: 0,
  grabbing: false,
  shakeNonce: 0,
  resetNonce: 0,
  strikeNonce: 0,
  strikePoint: null,
  loading: true,
  loadProgress: 0,
  loadHint: "准备下载",
  loadError: null,
  retryNonce: 0,
  bayonetHasEntry: false,
  bayonetPen: 0,
  bayonetAuto: false,
  bayonetPump: false,
  bayonetKind: "short",
  gazeFollow: true,
  blinkEnabled: true,
  eyeOpenL: 1,
  eyeOpenR: 1,
  blinkRate: 38,
  blinkSpeed: 1,
  mouthOpen: 0,
  mouthAmp: 0.73,
  mouthChinAmp: 0.46,
  mouthLipAmp: 1,
  mouthSmile: 0,
  mouthPucker: 0,
  mouthWidth: 0,
  cameraLive: { px: 0.28, py: 1.18, pz: 2.35, tx: 0, ty: 1.06, tz: 0.1 },
  cameraPresets: [null, null, null, null],
  cameraPresetIndex: null,
  camFocus: null,
  camCmd: null,
  firstPerson: false,
  fpView: "observe",
  fpLookLocked: false,
  fpCrouch: false,
  fpProne: false,
  fpCrouchHeld: false,
  fpStickX: 0,
  fpStickY: 0,
  fpJumpNonce: 0,
  fpInteractNonce: 0,
  fpFov: FP_FOV_DEFAULT,
  fpLookSpeed: FP_LOOK_SPEED_DEFAULT,
  mirrorRes: MIRROR_RES_DEFAULT,
  fpBreastJiggle: FP_BREAST_JIGGLE_DEFAULT,
  worldMap: "home",
  portalHint: "",
  cityMapOpen: false,
  cityMapMarker: null,
  cityMapHeight: CITY_MAP_H_DEFAULT,
  showCollision: false,
  fpWarpNonce: 0,
  fpWarpX: 0,
  fpWarpY: 0,
  fpWarpZ: 0,
  inVehicle: false,
  vehicleKind: null,
  vehicleSpeed: 0,
  vehicleThrust: 0,
  vehicleNitro: false,
  vehicleAirborne: false,
  vehicleGear: true,
  vehicleCam: "third",
  vehNitroHeld: false,
  vehDriftHeld: false,
  vehYawHeld: 0,
  vehThrustSlider: null,
  setParam: (key, value) =>
    set((s) => ({
      ...s,
      [key]: value,
      preset: s.preset,
    })),
  applyPreset: (id) =>
    set((s) => ({
      ...PRESETS[id],
      preset: id,
      abdomenXray: s.abdomenXray,
      bellyInflate: s.bellyInflate,
      navelDepth: s.navelDepth,
      navelDiameter: s.navelDiameter,
      navelInsert: s.navelInsert,
      navelDepthRatio: s.navelDepthRatio,
      navelThrust: s.navelThrust,
      navelStir: s.navelStir,
      navelThrustSpeed: s.navelThrustSpeed,
      navelThrustStart: s.navelThrustStart,
      navelStirSpeed: s.navelStirSpeed,
      navelStirRadius: s.navelStirRadius,
      breastSoft: s.breastSoft,
      breastDamp: s.breastDamp,
      hairDamp: s.hairDamp,
      breastInertia: s.breastInertia,
      hairInertia: s.hairInertia,
      breathAmp: s.breathAmp,
      breathSpeed: s.breathSpeed,
      showOrgans: s.showOrgans,
      showGutHp: s.showGutHp,
      gutAmp: s.gutAmp,
      gutSpeed: s.gutSpeed,
      strikeForce: s.strikeForce,
      strikeRange: s.strikeRange,
      strikeRebound: s.strikeRebound,
      fistBulge: s.fistBulge,
      fistSpread: s.fistSpread,
      fistGut: s.fistGut,
      fistLever: s.fistLever,
      fistMaxDepth: s.fistMaxDepth,
      fistRise: s.fistRise,
      fistThrust: s.fistThrust,
      fistStir: s.fistStir,
      fistThrustSpeed: s.fistThrustSpeed,
      fistThrustStart: s.fistThrustStart,
      fistStirSpeed: s.fistStirSpeed,
      fistStirRadius: s.fistStirRadius,
      bedStance: s.bedStance,
      showLattice: s.showLattice,
      showWeights: s.showWeights,
      uiHidden: s.uiHidden,
      interactMode: s.interactMode,
      expression: s.expression,
      pose: s.pose,
      handSide: s.handSide,
      handGestureL: s.handGestureL,
      handGestureR: s.handGestureR,
    })),
  setInteractMode: (interactMode) =>
    set((s) => {
      const entering = interactMode === "navel";
      const leaving = s.interactMode === "navel" && !entering;
      const belly: CamSnap = { px: 0.08, py: 1.08, pz: 0.72, tx: 0, ty: 1.055, tz: 0.1 };
      return {
        interactMode,
        selectedBone: interactMode === "pose" ? s.selectedBone : -1,
        ...(entering
          ? {
              pose: "navelPoke" as const,
              handGestureL: "rest" as const,
              handGestureR: "point" as const,
              navelInsert: 0,
              navelDepth: 0.06,
              navelDiameter: 0.42,
              camCmd: { nonce: (s.camCmd?.nonce ?? 0) + 1, kind: "snap" as const, snap: belly },
            }
          : {}),
        ...(leaving ? { navelInsert: 0, navelThrust: false, navelStir: false } : {}),
      };
    }),
  setPoseEditMode: (poseEditMode) => set({ poseEditMode }),
  setSelectedBone: (selectedBone, name) => set({ selectedBone, selectedBoneName: name ?? "" }),
  setExpression: (expression) => {
    const face: Record<ExpressionId, Partial<StudioState>> = {
      rest: { mouthOpen: 0, mouthSmile: 0, mouthWidth: 0, mouthPucker: 0, eyeOpenL: 1, eyeOpenR: 1 },
      ahegao: { mouthOpen: 0.88, mouthSmile: 0.12, mouthWidth: 0.38, mouthPucker: 0, eyeOpenL: 1, eyeOpenR: 1 },
      pain: { mouthOpen: 0.32, mouthSmile: -0.42, mouthWidth: -0.12, mouthPucker: 0.08, eyeOpenL: 0.7, eyeOpenR: 0.7 },
      vomit: { mouthOpen: 0.96, mouthSmile: -0.18, mouthWidth: 0.48, mouthPucker: 0, eyeOpenL: 0.48, eyeOpenR: 0.48 },
      disgust: { mouthOpen: 0.14, mouthSmile: -0.58, mouthWidth: -0.28, mouthPucker: 0.18, eyeOpenL: 0.86, eyeOpenR: 0.68 },
      climax: { mouthOpen: 0.74, mouthSmile: 0.22, mouthWidth: 0.42, mouthPucker: 0, eyeOpenL: 0.92, eyeOpenR: 0.92 },
    };
    set({ expression, ...face[expression] });
  },
  setPose: (pose) => {
    const pack: Record<PoseId, { expression: ExpressionId; handGestureL: HandGesture; handGestureR: HandGesture }> = {
      idle: { expression: "rest", handGestureL: "rest", handGestureR: "rest" },
      tpose: { expression: "rest", handGestureL: "rest", handGestureR: "rest" },
      disdain: { expression: "disgust", handGestureL: "rest", handGestureR: "middle" },
      ahegaoPose: { expression: "ahegao", handGestureL: "peace", handGestureR: "peace" },
      squat: { expression: "rest", handGestureL: "rest", handGestureR: "rest" },
      walk: { expression: "rest", handGestureL: "rest", handGestureR: "rest" },
      walkBack: { expression: "rest", handGestureL: "rest", handGestureR: "rest" },
      walkLeft: { expression: "rest", handGestureL: "rest", handGestureR: "rest" },
      walkRight: { expression: "rest", handGestureL: "rest", handGestureR: "rest" },
      crouchWalk: { expression: "rest", handGestureL: "rest", handGestureR: "rest" },
      crawl: { expression: "rest", handGestureL: "rest", handGestureR: "rest" },
      jump: { expression: "rest", handGestureL: "rest", handGestureR: "rest" },
      dance1: { expression: "rest", handGestureL: "rest", handGestureR: "rest" },
      dance2: { expression: "rest", handGestureL: "rest", handGestureR: "rest" },
      dance3: { expression: "rest", handGestureL: "rest", handGestureR: "rest" },
      dance4: { expression: "rest", handGestureL: "rest", handGestureR: "rest" },
      dance5: { expression: "rest", handGestureL: "rest", handGestureR: "rest" },
      dance6: { expression: "rest", handGestureL: "rest", handGestureR: "rest" },
      dance7: { expression: "rest", handGestureL: "rest", handGestureR: "rest" },
      dance8: { expression: "rest", handGestureL: "rest", handGestureR: "rest" },
      splits: { expression: "rest", handGestureL: "rest", handGestureR: "rest" },
      backbend: { expression: "rest", handGestureL: "rest", handGestureR: "rest" },
      inspectNavel: { expression: "rest", handGestureL: "rest", handGestureR: "two" },
      navelPoke: { expression: "rest", handGestureL: "rest", handGestureR: "point" },
    };
    const p = pack[pose] ?? pack.idle;
    const face: Record<ExpressionId, Partial<StudioState>> = {
      rest: { mouthOpen: 0, mouthSmile: 0, mouthWidth: 0, mouthPucker: 0, eyeOpenL: 1, eyeOpenR: 1 },
      ahegao: { mouthOpen: 0.88, mouthSmile: 0.12, mouthWidth: 0.38, mouthPucker: 0, eyeOpenL: 1, eyeOpenR: 1 },
      pain: { mouthOpen: 0.32, mouthSmile: -0.42, mouthWidth: -0.12, mouthPucker: 0.08, eyeOpenL: 0.7, eyeOpenR: 0.7 },
      vomit: { mouthOpen: 0.96, mouthSmile: -0.18, mouthWidth: 0.48, mouthPucker: 0, eyeOpenL: 0.48, eyeOpenR: 0.48 },
      disgust: { mouthOpen: 0.14, mouthSmile: -0.58, mouthWidth: -0.28, mouthPucker: 0.18, eyeOpenL: 0.86, eyeOpenR: 0.68 },
      climax: { mouthOpen: 0.74, mouthSmile: 0.22, mouthWidth: 0.42, mouthPucker: 0, eyeOpenL: 0.92, eyeOpenR: 0.92 },
    };
    set((s) => {
      const bodyCam: Partial<Record<PoseId, CamSnap>> = {
        ahegaoPose: { px: 0.02, py: 1.42, pz: 1.7, tx: 0, ty: 1.32, tz: 0.04 },
        splits: { px: 0.35, py: 1.05, pz: 4.1, tx: -0.04, ty: 0.92, tz: 0.04 },
        squat: { px: 0.35, py: 0.85, pz: 2.6, tx: 0, ty: 0.62, tz: 0.04 },
        walk: { px: 0.5, py: 1.12, pz: 2.4, tx: 0, ty: 0.92, tz: 0.05 },
        walkBack: { px: 0.5, py: 1.12, pz: 2.4, tx: 0, ty: 0.92, tz: 0.05 },
        walkLeft: { px: 0.15, py: 1.12, pz: 2.55, tx: 0, ty: 0.92, tz: 0.04 },
        walkRight: { px: 0.15, py: 1.12, pz: 2.55, tx: 0, ty: 0.92, tz: 0.04 },
        crouchWalk: { px: 0.5, py: 0.88, pz: 2.2, tx: 0, ty: 0.6, tz: 0.08 },
        crawl: { px: 0.85, py: 0.78, pz: 1.7, tx: 0, ty: 0.2, tz: 0.4 },
        jump: { px: 0.55, py: 1.28, pz: 2.55, tx: 0, ty: 1.02, tz: 0.05 },
        dance1: { px: 0.65, py: 1.18, pz: 3.35, tx: 0, ty: 0.88, tz: 0.05 },
        dance2: { px: 0.65, py: 1.18, pz: 3.35, tx: 0, ty: 0.88, tz: 0.05 },
        dance3: { px: 0.65, py: 1.18, pz: 3.35, tx: 0, ty: 0.88, tz: 0.05 },
        dance4: { px: 0.65, py: 1.18, pz: 3.35, tx: 0, ty: 0.88, tz: 0.05 },
        dance5: { px: 0.65, py: 1.18, pz: 3.35, tx: 0, ty: 0.88, tz: 0.05 },
        dance6: { px: 0.9, py: 0.85, pz: 2.9, tx: 0, ty: 0.45, tz: 0.1 },
        dance7: { px: 0.65, py: 1.18, pz: 3.35, tx: 0, ty: 0.88, tz: 0.05 },
        dance8: { px: 0.9, py: 0.85, pz: 2.9, tx: 0, ty: 0.45, tz: 0.1 },
        backbend: { px: 0.25, py: 0.98, pz: 3.8, tx: 0, ty: 0.88, tz: -0.05 },
        inspectNavel: { px: 0.1, py: 1.08, pz: 0.78, tx: 0, ty: 1.055, tz: 0.1 },
        navelPoke: { px: 0.08, py: 1.08, pz: 0.72, tx: 0, ty: 1.055, tz: 0.1 },
      };
      const snap = bodyCam[pose];
      const navelExtra =
        pose === "inspectNavel"
          ? { navelDepth: 0.2, navelDiameter: 0.58, navelInsert: 0, interactMode: s.interactMode }
          : pose === "navelPoke"
            ? { navelDepth: 0.06, navelDiameter: 0.42, navelInsert: 0, interactMode: "navel" as const }
            : { navelInsert: pose === s.pose ? s.navelInsert : 0 };
      return {
        pose,
        ...p,
        ...face[p.expression],
        ...navelExtra,
        ...(snap
          ? { camCmd: { nonce: (s.camCmd?.nonce ?? 0) + 1, kind: "snap" as const, snap } }
          : {}),
      };
    });
  },
  setHandSide: (handSide) => set({ handSide }),
  setNavelInsert: (navelInsert) => {
    const t = Math.max(0, Math.min(1, navelInsert));
    set((s) => {
      const m = navelInsertMorph(t, s.navelDepthRatio);
      return { navelInsert: t, navelDepth: m.depth, navelDiameter: m.diameter };
    });
  },
  setNavelDepthRatio: (navelDepthRatio) => {
    const r = Math.max(0, Math.min(1.2, navelDepthRatio));
    set((s) => {
      const m = navelInsertMorph(s.navelInsert, r);
      return { navelDepthRatio: r, navelDepth: m.depth, navelDiameter: m.diameter };
    });
  },
  setHandGesture: (id) =>
    set((s) => (s.handSide === "L" ? { handGestureL: id } : { handGestureR: id })),
  setEnergy: (energy) => set({ energy }),
  setGrabbing: (grabbing) => set({ grabbing }),
  setBayonetHasEntry: (bayonetHasEntry) => set({ bayonetHasEntry }),
  setBayonetPen: (bayonetPen) => set({ bayonetPen: Math.max(0, Math.min(1, bayonetPen)) }),
  setBayonetAuto: (bayonetAuto) => set((s) => ({ bayonetAuto, bayonetPump: bayonetAuto ? false : s.bayonetPump })),
  setBayonetPump: (bayonetPump) => set((s) => ({ bayonetPump, bayonetAuto: bayonetPump ? false : s.bayonetAuto })),
  setBayonetKind: (bayonetKind) => set({ bayonetKind, interactMode: "bayonet" }),
  setGazeFollow: (gazeFollow) => set({ gazeFollow }),
  setBlinkEnabled: (blinkEnabled) => set({ blinkEnabled }),
  setEyeOpenL: (eyeOpenL) => set({ eyeOpenL: Math.max(0, Math.min(1, eyeOpenL)) }),
  setEyeOpenR: (eyeOpenR) => set({ eyeOpenR: Math.max(0, Math.min(1, eyeOpenR)) }),
  setBlinkRate: (blinkRate) => set({ blinkRate: Math.max(4, Math.min(40, blinkRate)) }),
  setBlinkSpeed: (blinkSpeed) => set({ blinkSpeed: Math.max(0, Math.min(1, blinkSpeed)) }),
  setMouthOpen: (mouthOpen) => set({ mouthOpen: Math.max(0, Math.min(1, mouthOpen)) }),
  setMouthAmp: (mouthAmp) => set({ mouthAmp: Math.max(0.3, Math.min(2, mouthAmp)) }),
  setMouthChinAmp: (mouthChinAmp) => set({ mouthChinAmp: Math.max(0, Math.min(2, mouthChinAmp)) }),
  setMouthLipAmp: (mouthLipAmp) => set({ mouthLipAmp: Math.max(0.3, Math.min(2, mouthLipAmp)) }),
  setMouthSmile: (mouthSmile) => set({ mouthSmile: Math.max(-1, Math.min(1, mouthSmile)) }),
  setMouthPucker: (mouthPucker) => set({ mouthPucker: Math.max(0, Math.min(1, mouthPucker)) }),
  setMouthWidth: (mouthWidth) => set({ mouthWidth: Math.max(-1, Math.min(1, mouthWidth)) }),
  setCameraLive: (cameraLive) => set({ cameraLive }),
  saveCameraPreset: (i) =>
    set((s) => {
      if (i < 0 || i > 3) return s;
      const next = s.cameraPresets.slice() as (CamSnap | null)[];
      next[i] = { ...s.cameraLive };
      return { cameraPresets: next, cameraPresetIndex: i };
    }),
  applyCameraPreset: (i) =>
    set((s) => {
      const snap = s.cameraPresets[i];
      if (!snap) return s;
      return {
        cameraPresetIndex: i,
        camFocus: null,
        camCmd: { nonce: (s.camCmd?.nonce ?? 0) + 1, kind: "snap", snap },
      };
    }),
  setCamFocus: (focus) =>
    set((s) => ({
      camFocus: focus,
      cameraPresetIndex: null,
      camCmd: { nonce: (s.camCmd?.nonce ?? 0) + 1, kind: "focus", focus },
    })),
  setCameraZoom: (dist) =>
    set((s) => ({
      camCmd: {
        nonce: (s.camCmd?.nonce ?? 0) + 1,
        kind: "zoom",
        dist: Math.max(0.12, Math.min(6.2, dist)),
      },
    })),
  panCamera: (dx, dy, dz) =>
    set((s) => ({
      camCmd: { nonce: (s.camCmd?.nonce ?? 0) + 1, kind: "pan", dx, dy, dz },
    })),
  setFirstPerson: (firstPerson, view) =>
    set((s) => ({
      firstPerson,
      fpView: view ?? s.fpView,
      fpLookLocked: firstPerson ? s.fpLookLocked : false,
      fpCrouch: firstPerson ? s.fpCrouch : false,
      fpProne: firstPerson ? s.fpProne : false,
      fpCrouchHeld: false,
      fpStickX: 0,
      fpStickY: 0,
      autoRotate: firstPerson ? false : s.autoRotate,
      uiHidden: firstPerson ? true : false,
    })),
  setFpView: (fpView) =>
    set((s) => {
      const turningOff = s.firstPerson && s.fpView === fpView;
      if (turningOff) {
        return {
          firstPerson: false,
          fpLookLocked: false,
          fpCrouchHeld: false,
          fpStickX: 0,
          fpStickY: 0,
          autoRotate: s.autoRotate,
          uiHidden: false,
        };
      }
      return {
        firstPerson: true,
        fpView,
        fpCrouchHeld: false,
        fpStickX: 0,
        fpStickY: 0,
        autoRotate: false,
        uiHidden: true,
      };
    }),
  setFpLookLocked: (fpLookLocked) => set({ fpLookLocked }),
  setFpCrouch: (fpCrouch) => set({ fpCrouch }),
  setFpProne: (fpProne) => set({ fpProne }),
  setFpCrouchHeld: (fpCrouchHeld) => set({ fpCrouchHeld }),
  setFpStick: (fpStickX, fpStickY) => set({ fpStickX, fpStickY }),
  tapFpJump: () => set((s) => ({ fpJumpNonce: s.fpJumpNonce + 1 })),
  tapFpInteract: () => set((s) => ({ fpInteractNonce: s.fpInteractNonce + 1 })),
  setFpFov: (fpFov) =>
    set({
      fpFov: Math.max(FP_FOV_MIN, Math.min(FP_FOV_MAX, fpFov)),
    }),
  setFpLookSpeed: (fpLookSpeed) =>
    set({
      fpLookSpeed: Math.max(FP_LOOK_SPEED_MIN, Math.min(FP_LOOK_SPEED_MAX, fpLookSpeed)),
    }),
  setMirrorRes: (mirrorRes) =>
    set({
      mirrorRes: Math.max(MIRROR_RES_MIN, Math.min(MIRROR_RES_MAX, Math.round(mirrorRes / 64) * 64)),
    }),
  setFpBreastJiggle: (fpBreastJiggle) =>
    set({
      fpBreastJiggle: Math.max(FP_BREAST_JIGGLE_MIN, Math.min(FP_BREAST_JIGGLE_MAX, fpBreastJiggle)),
    }),
  setWorldMap: (worldMap) =>
    set({
      worldMap,
      portalHint: "",
      cityMapOpen: false,
      cityMapMarker: null,
      inVehicle: false,
      vehicleKind: null,
      vehNitroHeld: false,
      vehDriftHeld: false,
      vehYawHeld: 0,
      vehThrustSlider: null,
    }),
  setPortalHint: (portalHint) => set({ portalHint }),
  setCityMapOpen: (cityMapOpen) => set({ cityMapOpen }),
  setCityMapMarker: (cityMapMarker) => set({ cityMapMarker }),
  setCityMapHeight: (cityMapHeight) =>
    set({
      cityMapHeight: Math.max(CITY_MAP_H_MIN, Math.min(CITY_MAP_H_MAX, cityMapHeight)),
    }),
  setShowCollision: (showCollision) => set({ showCollision }),
  warpFp: (fpWarpX, fpWarpY, fpWarpZ) =>
    set((s) => ({ fpWarpNonce: s.fpWarpNonce + 1, fpWarpX, fpWarpY, fpWarpZ, cityMapOpen: false })),
  setVehNitroHeld: (vehNitroHeld) => set({ vehNitroHeld }),
  setVehDriftHeld: (vehDriftHeld) => set({ vehDriftHeld }),
  setVehYawHeld: (vehYawHeld) => set({ vehYawHeld: Math.max(-1, Math.min(1, vehYawHeld)) }),
  setVehThrustSlider: (vehThrustSlider) => set({ vehThrustSlider }),
  toggleVehicleCam: () => set((s) => ({ vehicleCam: s.vehicleCam === "first" ? "third" : "first" })),
  setVehicleCam: (vehicleCam) => set({ vehicleCam }),
  shake: () => set((s) => ({ shakeNonce: s.shakeNonce + 1 })),
  fireStrike: (point = null) =>
    set((s) => ({ strikeNonce: s.strikeNonce + 1, strikePoint: point ?? null })),
  resetSim: () =>
    set((s) => ({
      resetNonce: s.resetNonce + 1,
      energy: 0,
      bayonetHasEntry: false,
      bayonetPen: 0,
      navelInsert: 0,
      navelThrust: false,
      navelStir: false,
    })),
  retryLoad: () =>
    set((s) => ({
      loading: true,
      loadProgress: 0,
      loadHint: "重新下载",
      loadError: null,
      retryNonce: s.retryNonce + 1,
    })),
}));
