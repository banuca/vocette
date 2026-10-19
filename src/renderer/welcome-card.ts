/**
 * The questions put to everyone once, at the head of History: whether
 * Vocette starts with the computer, whether it says when there is a new
 * version, and whether it sends opt-in counts (unticked: decision M, 16 Oct). Starting with the computer is already on for a new profile, so
 * the card says so and offers the way out; the update check is asked, with
 * Yes ticked (owner, 15 Oct 2026). Done saves both and the card is gone for
 * good. Both stay in Settings and About afterwards.
 */

export interface WelcomeChoice {
  launchAtLogin: boolean
  updateCheck: boolean
  usageCounts: boolean
}

export interface WelcomeCardOptions {
  /** "Windows", "macOS", or null where starting with the computer is not offered. */
  systemName: string | null
  /** Ticked or not, as the setting stands now. */
  launchAtLogin: boolean
  done(choice: WelcomeChoice): Promise<void>
}

export interface WelcomeCardView {
  apply(due: boolean): void
}

/** "Windows", "macOS", or "your computer"; null when the platform cannot start Vocette at sign-in. */
export function welcomeSystemName(platform: string, launchAvailable: boolean): string | null {
  if (!launchAvailable) return null
  if (platform === 'windows') return 'Windows'
  if (platform === 'macos') return 'macOS'
  return 'your computer'
}

function row(id: string, title: string, detail: string, checked: boolean): HTMLLabelElement {
  const label = document.createElement('label')
  label.className = 'toggle-row'
  const text = document.createElement('div')
  const strong = document.createElement('strong')
  strong.textContent = title
  const span = document.createElement('span')
  span.textContent = detail
  text.append(strong, span)
  const input = document.createElement('input')
  input.type = 'checkbox'
  input.id = id
  input.checked = checked
  label.append(text, input, document.createElement('i'))
  return label
}

export function createWelcomeCard(host: HTMLElement, options: WelcomeCardOptions): WelcomeCardView {
  let shown = false
  return {
    apply(due) {
      if (due === shown) return
      shown = due
      if (!due) {
        host.replaceChildren()
        return
      }
      const card = document.createElement('section')
      card.className = 'welcome-card'
      card.setAttribute('aria-labelledby', 'welcome-heading')
      const heading = document.createElement('h2')
      heading.id = 'welcome-heading'
      heading.textContent = 'Before you start'
      const rows = document.createElement('div')
      rows.className = 'toggle-list'
      let launch: HTMLInputElement | null = null
      if (options.systemName) {
        const launchRow = row(
          'welcome-launch',
          `Start Vocette with ${options.systemName}`,
          'So your shortcut works after a restart. You can change this in Settings.',
          options.launchAtLogin
        )
        launch = launchRow.querySelector('input')
        rows.append(launchRow)
      }
      const updatesRow = row(
        'welcome-updates',
        "Tell me when there's a new version",
        'Once a day Vocette asks GitHub for the latest version number. Nothing about you is ' +
          'sent. You can change this on the About page.',
        true
      )
      const updates = updatesRow.querySelector('input')
      rows.append(updatesRow)
      const countsRow = row(
        'welcome-counts',
        'Help improve Vocette',
        'Once a day, send a few counts, such as how many days you dictated this week. Never ' +
          'your words or audio, and nothing that identifies you. The About page shows exactly ' +
          'what is sent.',
        false
      )
      const counts = countsRow.querySelector('input')
      rows.append(countsRow)
      const actions = document.createElement('div')
      actions.className = 'welcome-actions'
      const done = document.createElement('button')
      done.type = 'button'
      done.className = 'primary-button'
      done.textContent = 'Done'
      const failure = document.createElement('p')
      failure.className = 'welcome-failure'
      failure.setAttribute('aria-live', 'polite')
      done.addEventListener('click', () => {
        done.disabled = true
        failure.textContent = ''
        options
          .done({
            launchAtLogin: launch ? launch.checked : options.launchAtLogin,
            updateCheck: updates?.checked ?? true,
            usageCounts: counts?.checked ?? false
          })
          .catch(() => {
            done.disabled = false
            failure.textContent = 'That could not be saved. Try again.'
          })
      })
      actions.append(done, failure)
      card.append(heading, rows, actions)
      host.replaceChildren(card)
    }
  }
}
