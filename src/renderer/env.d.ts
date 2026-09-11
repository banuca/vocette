import type { MurmurApi } from '../preload/index'
import type { RecorderApi } from '../preload/recorder'

declare global {
  interface Window {
    murmur: MurmurApi
    recorder: RecorderApi
  }
}
