// Demo page: light and dark switch. The choice is kept for this browser only (and the page works without it).
const root = document.documentElement
const button = document.querySelector('.theme')
const dark = () => root.dataset.theme === 'dark' || (!root.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches)

function set(theme) {
  root.dataset.theme = theme
  for (const v of document.querySelectorAll('robot-viewer')) v.setAttribute('theme', theme)
  if (button) { button.textContent = theme === 'dark' ? 'Light' : 'Dark'; button.setAttribute('aria-pressed', String(theme === 'dark')) }
}

let saved = null
try { saved = localStorage.getItem('robot-viewer-demo-theme') } catch { saved = null }
if (saved === 'dark' || saved === 'light') set(saved)
else if (button) button.textContent = dark() ? 'Light' : 'Dark'

button?.addEventListener('click', () => {
  const next = dark() ? 'light' : 'dark'
  set(next)
  try { localStorage.setItem('robot-viewer-demo-theme', next) } catch { /* private mode: the switch still works for this visit */ }
})
