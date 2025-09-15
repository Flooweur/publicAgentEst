import React, { useEffect, useRef, useState } from 'react'

function NeonRacer() {
  const canvasRef = useRef(null)
  const requestRef = useRef(0)
  const prevTimeRef = useRef(0)
  const stateRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d', { alpha: true })

    // Fixed internal resolution for crisp scaling
    const WIDTH = 480
    const HEIGHT = 360
    canvas.width = WIDTH
    canvas.height = HEIGHT

    const centerX = WIDTH / 2
    const centerY = HEIGHT / 2
    const trackRadius = 125
    const trackWidth = 86
    const innerR = trackRadius - trackWidth / 2
    const outerR = trackRadius + trackWidth / 2

    const startAngle = -Math.PI / 2 // top
    const startOnCenterlineX = centerX + trackRadius * Math.cos(startAngle)
    const startOnCenterlineY = centerY + trackRadius * Math.sin(startAngle)

    const keys = new Set()

    const initialState = {
      car: {
        x: startOnCenterlineX,
        y: startOnCenterlineY + 6, // a touch inside the gate
        angle: startAngle + Math.PI / 2, // pointing clockwise
        speed: 0,
      },
      lastPos: { x: startOnCenterlineX, y: startOnCenterlineY + 6 },
      onTrack: true,
      lap: 1,
      lapStartMs: performance.now(),
      lastLapMs: 0,
      bestLapMs: null,
      passedHalfGate: false,
      paused: false,
    }

    stateRef.current = initialState

    function handleKeyDown(e) {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Space'].includes(e.key)) e.preventDefault()
      keys.add(e.key)
      if (e.key === 'r' || e.key === 'R') {
        reset()
      }
      if (e.key === 'p' || e.key === 'P') {
        stateRef.current.paused = !stateRef.current.paused
      }
    }

    function handleKeyUp(e) {
      keys.delete(e.key)
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)

    function reset() {
      stateRef.current = {
        ...initialState,
        lapStartMs: performance.now(),
      }
    }

    function isOnTrack(x, y) {
      const dx = x - centerX
      const dy = y - centerY
      const d = Math.hypot(dx, dy)
      return d >= innerR && d <= outerR
    }

    function checkGates(prevX, prevY, x, y) {
      // Finish gate: radial at angle -90deg (x ~= centerX), near top region
      const nearTopRegion = y <= centerY - innerR + 8
      const crossedCenterVertical = (prevX - centerX) < 0 && (x - centerX) >= 0 || (prevX - centerX) > 0 && (x - centerX) <= 0

      // Half gate: radial at +90deg, near bottom region
      const nearBottomRegion = y >= centerY + innerR - 8
      const crossedHalfVertical = crossedCenterVertical // same x=center line, but check region

      const s = stateRef.current

      if (crossedHalfVertical && nearBottomRegion) {
        s.passedHalfGate = true
      }

      if (crossedCenterVertical && nearTopRegion && s.passedHalfGate) {
        const now = performance.now()
        const lapTime = now - s.lapStartMs
        s.lastLapMs = lapTime
        if (s.bestLapMs == null || lapTime < s.bestLapMs) {
          s.bestLapMs = lapTime
        }
        s.lap += 1
        s.lapStartMs = now
        s.passedHalfGate = false
      }
    }

    function update(dt) {
      const s = stateRef.current
      if (s.paused) return

      const acc = 240 // px/s^2
      const frictionOn = 48 // px/s^2
      const frictionOff = 160 // px/s^2
      const maxSpeed = 320 // px/s
      const reverseMax = 120
      const steerBase = 2.6 // rad/s at ref speed
      const steerAtSpeed = 120 // px/s at which steering is strong

      const pressingUp = keys.has('ArrowUp') || keys.has('w') || keys.has('W')
      const pressingDown = keys.has('ArrowDown') || keys.has('s') || keys.has('S')
      const pressingLeft = keys.has('ArrowLeft') || keys.has('a') || keys.has('A')
      const pressingRight = keys.has('ArrowRight') || keys.has('d') || keys.has('D')
      const pressingBrake = keys.has(' ') || keys.has('Space')

      const forward = (pressingUp ? 1 : 0) + (pressingDown ? -1 : 0)
      let steer = (pressingLeft ? -1 : 0) + (pressingRight ? 1 : 0)

      // Reduce steering when almost stopped to prevent spinning in place
      const speed = s.car.speed
      const steerFactor = Math.min(1, Math.abs(speed) / steerAtSpeed)
      if (Math.abs(speed) < 12) steer *= 0.35

      s.car.angle += steer * steerBase * steerFactor * dt * Math.sign(Math.max(0.0001, speed) )

      let throttle = forward * acc
      if (pressingBrake) {
        throttle -= 3 * acc
      }

      // Friction depends on track adherence
      s.onTrack = isOnTrack(s.car.x, s.car.y)
      const friction = s.onTrack ? frictionOn : frictionOff

      // Integrate speed
      if (throttle === 0) {
        if (speed > 0) {
          s.car.speed = Math.max(0, speed - friction * dt)
        } else {
          s.car.speed = Math.min(0, speed + friction * dt)
        }
      } else {
        s.car.speed = speed + throttle * dt
      }

      // Clamp
      s.car.speed = Math.max(-reverseMax, Math.min(maxSpeed, s.car.speed))

      // Integrate position
      s.lastPos.x = s.car.x
      s.lastPos.y = s.car.y
      s.car.x += Math.cos(s.car.angle) * s.car.speed * dt
      s.car.y += Math.sin(s.car.angle) * s.car.speed * dt

      // Gate checks
      checkGates(s.lastPos.x, s.lastPos.y, s.car.x, s.car.y)

      // Gentle nudge back if far off track to keep things centered
      const dx = s.car.x - centerX
      const dy = s.car.y - centerY
      const dist = Math.hypot(dx, dy)
      const limit = outerR + 40
      if (dist > limit) {
        const pull = (dist - limit) * 0.6
        const nx = dx / (dist || 1)
        const ny = dy / (dist || 1)
        s.car.x -= nx * pull * dt
        s.car.y -= ny * pull * dt
        s.car.speed *= 0.98
      }
    }

    function drawTrack() {
      // Background tint
      ctx.clearRect(0, 0, WIDTH, HEIGHT)

      // Grass/dark field
      const bgGrad = ctx.createRadialGradient(centerX, centerY, innerR * 0.5, centerX, centerY, outerR * 1.25)
      bgGrad.addColorStop(0, '#0a0a12')
      bgGrad.addColorStop(1, '#06060a')
      ctx.fillStyle = bgGrad
      ctx.fillRect(0, 0, WIDTH, HEIGHT)

      // Track donut
      ctx.save()
      ctx.beginPath()
      ctx.arc(centerX, centerY, outerR, 0, Math.PI * 2)
      ctx.arc(centerX, centerY, innerR, 0, Math.PI * 2, true)
      ctx.closePath()
      const asphalt = ctx.createLinearGradient(0, centerY - outerR, 0, centerY + outerR)
      asphalt.addColorStop(0, 'rgba(255,255,255,0.06)')
      asphalt.addColorStop(0.5, 'rgba(255,255,255,0.12)')
      asphalt.addColorStop(1, 'rgba(255,255,255,0.06)')
      ctx.fillStyle = asphalt
      ctx.shadowColor = 'rgba(255, 59, 141, 0.15)'
      ctx.shadowBlur = 18
      ctx.fill('nonzero')
      ctx.restore()

      // Outer/Inner neon rails
      ctx.save()
      ctx.lineWidth = 3
      ctx.strokeStyle = 'rgba(255, 59, 141, 0.55)'
      ctx.shadowColor = 'rgba(255, 59, 141, 0.65)'
      ctx.shadowBlur = 10
      ctx.beginPath()
      ctx.arc(centerX, centerY, outerR, 0, Math.PI * 2)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(centerX, centerY, innerR, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()

      // Center dashed line
      ctx.save()
      ctx.strokeStyle = 'rgba(255, 180, 220, 0.9)'
      ctx.lineWidth = 2
      ctx.setLineDash([10, 10])
      ctx.beginPath()
      ctx.arc(centerX, centerY, trackRadius, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()

      // Finish line (radial segment at top)
      ctx.save()
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 6
      ctx.beginPath()
      ctx.moveTo(centerX, centerY - innerR)
      ctx.lineTo(centerX, centerY - outerR)
      ctx.stroke()
      ctx.lineWidth = 3
      ctx.strokeStyle = '#000'
      ctx.setLineDash([6, 6])
      ctx.beginPath()
      ctx.moveTo(centerX, centerY - innerR)
      ctx.lineTo(centerX, centerY - outerR)
      ctx.stroke()
      ctx.restore()
    }

    function drawCar() {
      const s = stateRef.current
      const { x, y, angle } = s.car

      ctx.save()
      ctx.translate(x, y)
      ctx.rotate(angle)

      const carLength = 26
      const carWidth = 14

      // Glow underbody
      ctx.shadowColor = s.onTrack ? 'rgba(255, 59, 141, 0.7)' : 'rgba(255, 120, 120, 0.7)'
      ctx.shadowBlur = 18

      // Body
      const grd = ctx.createLinearGradient(-carLength / 2, 0, carLength / 2, 0)
      grd.addColorStop(0, '#111626')
      grd.addColorStop(0.5, s.onTrack ? '#ff3b8d' : '#ff6262')
      grd.addColorStop(1, '#1a1f33')
      ctx.fillStyle = grd
      ctx.strokeStyle = 'rgba(255,255,255,0.2)'
      ctx.lineWidth = 1

      ctx.beginPath()
      ctx.moveTo(carLength / 2, 0)
      ctx.lineTo(-carLength / 2, -carWidth / 2)
      ctx.lineTo(-carLength / 2 + 5, 0)
      ctx.lineTo(-carLength / 2, carWidth / 2)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()

      // Cockpit glass
      ctx.fillStyle = 'rgba(180,200,255,0.25)'
      ctx.beginPath()
      ctx.moveTo(carLength / 4, -carWidth / 3)
      ctx.lineTo(-2, -carWidth / 4)
      ctx.lineTo(-2, carWidth / 4)
      ctx.lineTo(carLength / 4, carWidth / 3)
      ctx.closePath()
      ctx.fill()

      // Headlights
      ctx.fillStyle = 'rgba(255,255,200,0.9)'
      ctx.shadowColor = 'rgba(255,255,200,0.7)'
      ctx.shadowBlur = 12
      ctx.fillRect(carLength / 2 - 2, -4, 3, 3)
      ctx.fillRect(carLength / 2 - 2, 1, 3, 3)

      ctx.restore()
    }

    function renderHUD() {
      const s = stateRef.current
      const now = performance.now()
      const thisLap = Math.max(0, now - s.lapStartMs)
      const speedKmh = Math.max(0, s.car.speed) * 3.6 / 60 // arbitrary feel scaling

      const toClock = (ms) => {
        const m = Math.floor(ms / 60000)
        const secs = Math.floor((ms % 60000) / 1000)
        const cs = Math.floor((ms % 1000) / 10)
        return `${String(m).padStart(1, '0')}:${String(secs).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
      }

      // Draw text inside canvas (under the overlay HUD div)
      ctx.save()
      ctx.font = '700 12px Orbitron, Inter, sans-serif'
      ctx.fillStyle = 'rgba(255,255,255,0.9)'
      ctx.shadowColor = 'rgba(255, 59, 141, 0.55)'
      ctx.shadowBlur = 8
      ctx.textAlign = 'left'
      ctx.fillText(`Lap ${stateRef.current.lap}`, 12, 18)
      ctx.fillText(`Time ${toClock(thisLap)}`, 12, 34)
      if (s.bestLapMs != null) {
        ctx.fillText(`Best ${toClock(s.bestLapMs)}`, 12, 50)
      }
      ctx.textAlign = 'right'
      ctx.fillText(`Speed ${Math.round(speedKmh)} u`, WIDTH - 12, 18)
      if (s.paused) {
        ctx.textAlign = 'center'
        ctx.font = '700 18px Orbitron, Inter, sans-serif'
        ctx.fillText('Paused', WIDTH / 2, 28)
      }
      ctx.restore()
    }

    function frame(now) {
      const dt = Math.min(0.05, (now - (prevTimeRef.current || now)) / 1000)
      prevTimeRef.current = now

      update(dt)
      drawTrack()
      drawCar()
      renderHUD()

      requestRef.current = requestAnimationFrame(frame)
    }

    requestRef.current = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(requestRef.current)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [])

  return (
    <div className="game-card">
      <div className="game-frame">
        <canvas ref={canvasRef} className="game-canvas" />
        <div className="hud" aria-hidden>
          <span>Neon Drift</span>
          <span>Press R to reset • P to pause</span>
        </div>
      </div>
      <div className="instructions" style={{ marginTop: 10 }}>
        <span className="kbd">W</span>
        <span className="kbd">A</span>
        <span className="kbd">S</span>
        <span className="kbd">D</span>
        or
        <span className="kbd">↑</span>
        <span className="kbd">←</span>
        <span className="kbd">↓</span>
        <span className="kbd">→</span>
        to drive. <span className="kbd">Space</span> to brake.
      </div>
    </div>
  )
}

export default function App() {
  return (
    <>
      <header className="app-header">
        <div className="brand">Neon Drift</div>
      </header>
      <main className="app-main">
        <div className="container">
          <NeonRacer />
        </div>
      </main>
    </>
  )
}

