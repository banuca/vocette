import type { AppContext } from '../app-context'
import { escapeHtml } from '../dom'

export function renderAbout(context: AppContext): void {
  context.setHeading('About', 'A small, inspectable voice tool built for people—not subscriptions.')

  context.content.innerHTML = `
    <div class="about-hero">
      <div class="large-brand-mark" aria-hidden="true"><span></span></div>
      <h2>Voice Hotkey</h2>
      <p>Open-source push-to-talk dictation for Windows.</p>
      <span class="version-badge">Version ${escapeHtml(context.appInfo.version)}</span>
    </div>
    <div class="about-grid">
      <section class="about-card"><div class="about-icon" aria-hidden="true">⌨</div><h3>Simple by design</h3><p>Hold a shortcut, speak, then release. The transcript is copied, pasted, and saved locally.</p></section>
      <section class="about-card"><div class="about-icon" aria-hidden="true">⌂</div><h3>Local history</h3><p>Your history remains on this computer. Audio is held in memory only long enough to transcribe it.</p></section>
      <section class="about-card"><div class="about-icon" aria-hidden="true">◇</div><h3>Your API key</h3><p>No shared backend and no maintainer transcription bill. You control the provider account.</p></section>
    </div>
    <section class="notice-card">
      <h3>Independent open-source project</h3>
      <p>Voice Hotkey is an independent MIT-licensed project with no affiliation to any commercial dictation product. It sends audio only to the transcription provider you configure, using your own API key.</p>
      <button class="secondary-button" id="open-transcription-docs" type="button">Read the transcription API documentation</button>
    </section>
  `

  context.content.querySelector('#open-transcription-docs')?.addEventListener('click', () => {
    void window.voiceHotkey.openExternal('transcription-docs')
  })
}
