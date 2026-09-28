import { describe, expect, it } from 'vitest'
import {
  BLUETOOTH_HEADSET_NOTE,
  looksLikeBluetoothHeadset
} from '../src/renderer/bluetooth-headset'

/** The guess behind the Bluetooth note under the microphone picker. */
describe('looksLikeBluetoothHeadset', () => {
  // Each label here carries only the word it is listed with, so a word
  // dropped from the list fails its own case rather than hiding behind another.
  it.each([
    ['hands-free', 'Microphone (Bose QC35 II Hands-Free AG Audio)'],
    ['handsfree', 'Microphone (Jabra Talk 45 Handsfree)'],
    ['headset', 'Headset (Jabra Evolve2 65)'],
    ['airpods', 'Microphone (AirPods Pro)'],
    ['buds', 'Microphone (Galaxy Buds2 Pro)'],
    ['bluetooth', 'Microphone (Bluetooth Audio Device)'],
    ['bt ', 'Microphone (BT Audio)'],
    ['wh-', 'Microphone (WH-1000XM5)'],
    ['wf-', 'Microphone (WF-1000XM5)']
  ])('recognises "%s" in %s', (_word, label) => {
    expect(looksLikeBluetoothHeadset(label)).toBe(true)
  })

  it.each([
    // How Windows names a classic Bluetooth headset's microphone, and the
    // system default's entry while that headset is the default.
    'Headset (WH-1000XM4 Hands-Free AG Audio)',
    'Default - Headset (AirPods Pro Hands-Free AG Audio)'
  ])('recognises the names Windows gives a headset: %s', (label) => {
    expect(looksLikeBluetoothHeadset(label)).toBe(true)
  })

  it.each(['MICROPHONE (AIRPODS PRO)', 'microphone (galaxy buds2 pro)', 'Microphone (wh-1000xm5)'])(
    'ignores capitals: %s',
    (label) => {
      expect(looksLikeBluetoothHeadset(label)).toBe(true)
    }
  )

  it('stays quiet with no name to go on, as before microphone access is allowed', () => {
    expect(looksLikeBluetoothHeadset('')).toBe(false)
  })

  it.each([
    'Microphone (Realtek(R) Audio)',
    'Microphone Array (Intel® Smart Sound Technology for Digital Microphones)',
    'Default - Microphone Array (Realtek(R) Audio)',
    'MacBook Pro Microphone',
    // "Blue" is not "Bluetooth".
    'Microphone (Blue Snowball)',
    'Microphone (USB PnP Sound Device)',
    'Stereo Mix (Realtek(R) Audio)'
  ])('leaves other microphones alone: %s', (label) => {
    expect(looksLikeBluetoothHeadset(label)).toBe(false)
  })
})

describe('the Bluetooth note', () => {
  it('says what happens and what to do instead', () => {
    expect(BLUETOOTH_HEADSET_NOTE).toBe(
      'This looks like a Bluetooth headset. While its microphone is open, Windows switches ' +
        "your headphones to call quality. Choose your computer's built-in microphone to keep full sound."
    )
  })
})
