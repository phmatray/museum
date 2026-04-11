export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface DoorwayConfig {
  id: string
  position: Vec3
  connectsTo: string // room ID
  width: number
  height: number
}

export interface RoomConfig {
  id: string
  name: string
  dimensions: { width: number; height: number; depth: number }
  position: Vec3
  doorways: DoorwayConfig[]
  wallColor: string
  floorColor: string
  ceilingColor: string
  ambientLightIntensity: number
}

export interface TourStop {
  position: Vec3
  lookAt: Vec3
  pauseDuration: number // seconds
}

export interface MuseumConfig {
  rooms: RoomConfig[]
  tourPath: TourStop[]
  playerSpawn: Vec3
  playerHeight: number
  playerSpeed: number
}
