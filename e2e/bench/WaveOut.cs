// Plays a 16-bit PCM WAV on a chosen output device (winmm waveOut), so the benchmark
// doesn't depend on, or change, the Windows default device.
using System;
using System.IO;
using System.Runtime.InteropServices;

public static class BenchAudio {
  [StructLayout(LayoutKind.Sequential)] struct WAVEFORMATEX { public ushort tag, ch; public uint rate, bytesPerSec; public ushort align, bits, cb; }
  [StructLayout(LayoutKind.Sequential)] internal struct WAVEHDR { public IntPtr data; public uint len, rec; public IntPtr user; public uint flags, loops; public IntPtr next, res; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct WAVEOUTCAPS { public ushort mid, pid; public uint ver; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string name; public uint formats; public ushort ch, res; public uint support; }
  [DllImport("winmm.dll")] static extern int waveOutGetNumDevs();
  [DllImport("winmm.dll", CharSet = CharSet.Unicode)] static extern int waveOutGetDevCaps(IntPtr id, ref WAVEOUTCAPS caps, int size);
  [DllImport("winmm.dll")] static extern int waveOutOpen(out IntPtr h, IntPtr id, ref WAVEFORMATEX fmt, IntPtr cb, IntPtr inst, int flags);
  // The header must stay at one address until playback ends, so it lives in unmanaged memory.
  [DllImport("winmm.dll")] static extern int waveOutPrepareHeader(IntPtr h, IntPtr hdr, int size);
  [DllImport("winmm.dll")] static extern int waveOutWrite(IntPtr h, IntPtr hdr, int size);
  [DllImport("winmm.dll")] static extern int waveOutUnprepareHeader(IntPtr h, IntPtr hdr, int size);
  [DllImport("winmm.dll")] static extern int waveOutReset(IntPtr h);
  [DllImport("winmm.dll")] static extern int waveOutClose(IntPtr h);

  static readonly int HdrSize = Marshal.SizeOf(typeof(WAVEHDR));

  public static string[] Devices() {
    int n = waveOutGetNumDevs(); var names = new string[n];
    for (int i = 0; i < n; i++) { var c = new WAVEOUTCAPS(); waveOutGetDevCaps((IntPtr)i, ref c, Marshal.SizeOf(c)); names[i] = c.name; }
    return names;
  }

  // Device names are cut to 31 characters by winmm, so match on a part of the name.
  public static int Find(string part) {
    var d = Devices();
    for (int i = 0; i < d.Length; i++) if (d[i].IndexOf(part, StringComparison.OrdinalIgnoreCase) >= 0) return i;
    return -1;
  }

  public sealed class Playback : IDisposable {
    readonly IntPtr h, hdr, pcm; bool done;
    internal Playback(IntPtr h, IntPtr hdr, IntPtr pcm) { this.h = h; this.hdr = hdr; this.pcm = pcm; }
    public void Dispose() {
      if (done) return; done = true;
      waveOutReset(h); waveOutUnprepareHeader(h, hdr, HdrSize); waveOutClose(h);
      Marshal.FreeHGlobal(hdr); Marshal.FreeHGlobal(pcm);
    }
  }

  // Starts playback and returns at once; dispose the result to stop and free it.
  public static Playback Start(string wavPath, int device) {
    byte[] all = File.ReadAllBytes(wavPath);
    int p = 12; var fmt = new WAVEFORMATEX(); int dataOff = -1, dataLen = 0;
    while (p + 8 <= all.Length) {
      string id = System.Text.Encoding.ASCII.GetString(all, p, 4); int len = BitConverter.ToInt32(all, p + 4);
      if (id == "fmt ") {
        fmt.tag = 1; fmt.ch = BitConverter.ToUInt16(all, p + 10); fmt.rate = BitConverter.ToUInt32(all, p + 12);
        fmt.bits = BitConverter.ToUInt16(all, p + 22); fmt.align = (ushort)(fmt.ch * fmt.bits / 8); fmt.bytesPerSec = fmt.rate * fmt.align; fmt.cb = 0;
      } else if (id == "data") { dataOff = p + 8; dataLen = Math.Min(len, all.Length - dataOff); break; }
      p += 8 + len + (len & 1);
    }
    if (dataOff < 0) throw new InvalidDataException("No data chunk in " + wavPath);
    IntPtr h; int r = waveOutOpen(out h, (IntPtr)device, ref fmt, IntPtr.Zero, IntPtr.Zero, 0);
    if (r != 0) throw new InvalidOperationException("waveOutOpen failed: " + r);
    IntPtr pcm = Marshal.AllocHGlobal(dataLen); Marshal.Copy(all, dataOff, pcm, dataLen);
    IntPtr hdr = Marshal.AllocHGlobal(HdrSize);
    Marshal.StructureToPtr(new WAVEHDR { data = pcm, len = (uint)dataLen }, hdr, false);
    waveOutPrepareHeader(h, hdr, HdrSize);
    waveOutWrite(h, hdr, HdrSize);
    return new Playback(h, hdr, pcm);
  }
}
