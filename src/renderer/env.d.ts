import type { VoiceHotkeyApi } from '../preload/index'
import type { RecorderApi } from '../preload/recorder'

declare global {
  interface Window {
    voiceHotkey: VoiceHotkeyApi
    recorder: RecorderApi
  }
}
