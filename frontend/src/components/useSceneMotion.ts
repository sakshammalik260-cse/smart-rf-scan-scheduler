import { useEffect, useState } from 'react'

export function useSceneMotion(paused: boolean) {
  const [available, setAvailable] = useState(true)
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setAvailable(!preference.matches && !document.hidden)
    update()
    preference.addEventListener('change', update)
    document.addEventListener('visibilitychange', update)
    return () => {
      preference.removeEventListener('change', update)
      document.removeEventListener('visibilitychange', update)
    }
  }, [])
  return available && !paused
}
