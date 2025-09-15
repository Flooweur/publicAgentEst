import React, { useEffect, useRef } from 'react'

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
    const TAU = Math.PI * 2
    const SEGMENTS = 256

    // Track profile: wavy radius and width over angle
    function radiusProfile(theta) {
      // Centerline radius modulation
      return trackRadius + 22 * Math.sin(theta * 3) + 12 * Math.sin(theta * 5 + 1.1)
    }

    function widthProfile(theta) {
      return trackWidth + 14 * Math.sin(theta * 2 + 0.3)
    }

    function getRadii(theta) {
      const r = radiusProfile(theta)
      const w = widthProfile(theta)
      return { inner: r - w / 2, outer: r + w / 2, center: r, width: w }
    }

    // Conservative radial limit used to nudge player back if too far
    const boundaryLimit = trackRadius + trackWidth / 2 + 60

    const startAngle = -Math.PI / 2 // top
    const startR = getRadii(startAngle).center
    const startOnCenterlineX = centerX + startR * Math.cos(startAngle)
    const startOnCenterlineY = centerY + startR * Math.sin(startAngle)

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
      // Arcade extras
      score: 0,
      message: null,
      messageUntilMs: 0,
      effectBoostUntil: 0,
      effectSlowUntil: 0,
      items: [], // { id, type, x, y, r, theta, expiresAt }
      nextSpawnAt: performance.now() + 800,
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
      const theta = Math.atan2(dy, dx)
      const { inner, outer } = getRadii(theta)
      return d >= inner && d <= outer
    }

    function checkGates(prevX, prevY, x, y) {
      // Use vertical center line crossing for direction-agnostic gates,
      // and dynamic region thresholds based on track profile at top/bottom
      const innerTop = getRadii(-Math.PI / 2).inner
      const innerBottom = getRadii(Math.PI / 2).inner
      const nearTopRegion = y <= centerY - innerTop + 12
      const nearBottomRegion = y >= centerY + innerBottom - 12

      const crossedCenterVertical = (prevX - centerX) < 0 && (x - centerX) >= 0 || (prevX - centerX) > 0 && (x - centerX) <= 0
      const crossedHalfVertical = crossedCenterVertical

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

    function randomBetween(min, max) {
      return min + Math.random() * (max - min)
    }

    function spawnItem(now, avoidX, avoidY) {
      const s = stateRef.current
      const roll = Math.random()
      const type = roll < 0.4 ? 'accelerator' : roll < 0.7 ? 'obstacle' : 'bonus'
      const theta = Math.random() * TAU
      const rInfo = getRadii(theta)
      const radialOffset = randomBetween(-rInfo.width * 0.35, rInfo.width * 0.35)
      const radius = rInfo.center + radialOffset
      const x = centerX + radius * Math.cos(theta)
      const y = centerY + radius * Math.sin(theta)

      // Avoid spawning too close to the car
      if (Math.hypot(x - avoidX, y - avoidY) < 60) {
        return // skip this spawn; next tick will try again
      }

      const id = `${now}-${Math.floor(Math.random() * 1e6)}`
      const r = type === 'obstacle' ? 9 : type === 'accelerator' ? 8 : 7
      const life = type === 'obstacle' ? 12000 : 9000
      s.items.push({ id, type, x, y, r, theta, expiresAt: now + life })
    }

    function update(dt) {
      const s = stateRef.current
      if (s.paused) return

      const now = performance.now()

      // Base handling
      let acc = 240 // px/s^2
      let frictionOn = 48 // px/s^2
      let frictionOff = 160 // px/s^2
      let maxSpeed = 320 // px/s
      const reverseMax = 120
      const steerBase = 2.6 // rad/s at ref speed
      const steerAtSpeed = 120 // px/s at which steering is strong

      // Effects
      if (now < s.effectBoostUntil) {
        acc *= 1.5
        maxSpeed *= 1.3
        frictionOn *= 0.85
      }
      if (now < s.effectSlowUntil) {
        acc *= 0.6
        maxSpeed *= 0.7
        frictionOn *= 1.25
      }

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

      // Item spawning
      if (now >= s.nextSpawnAt) {
        spawnItem(now, s.car.x, s.car.y)
        // Occasionally spawn two
        if (Math.random() < 0.2) spawnItem(now, s.car.x, s.car.y)
        s.nextSpawnAt = now + 700 + Math.random() * 900
      }

      // Despawn expired
      if (s.items.length) {
        s.items = s.items.filter(it => it.expiresAt > now)
      }

      // Collisions
      const carCollisionR = 10
      for (let i = s.items.length - 1; i >= 0; i--) {
        const it = s.items[i]
        const dxI = it.x - s.car.x
        const dyI = it.y - s.car.y
        if (dxI * dxI + dyI * dyI <= (it.r + carCollisionR) * (it.r + carCollisionR)) {
          if (it.type === 'accelerator') {
            s.effectBoostUntil = now + 1800
            s.car.speed = Math.min(maxSpeed * 1.2, s.car.speed + 160)
            s.message = 'BOOST!'
            s.messageUntilMs = now + 900
          } else if (it.type === 'obstacle') {
            s.effectSlowUntil = now + 700
            s.car.speed *= 0.35
            s.message = 'HIT!'
            s.messageUntilMs = now + 700
          } else if (it.type === 'bonus') {
            s.score += 100
            s.message = '+100'
            s.messageUntilMs = now + 800
          }
          s.items.splice(i, 1)
        }
      }

      // Gentle nudge back if far off track to keep things centered
      const dx = s.car.x - centerX
      const dy = s.car.y - centerY
      const dist = Math.hypot(dx, dy)
      const limit = boundaryLimit
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
      const bgGrad = ctx.createRadialGradient(centerX, centerY, (trackRadius - trackWidth / 2) * 0.5, centerX, centerY, (trackRadius + trackWidth / 2) * 1.4)
      bgGrad.addColorStop(0, '#0a0a12')
      bgGrad.addColorStop(1, '#06060a')
      ctx.fillStyle = bgGrad
      ctx.fillRect(0, 0, WIDTH, HEIGHT)

      // Wavy track ring
      ctx.save()
      ctx.beginPath()
      for (let i = 0; i <= SEGMENTS; i++) {
        const t = (i / SEGMENTS) * TAU
        const r = getRadii(t).outer
        const x = centerX + r * Math.cos(t)
        const y = centerY + r * Math.sin(t)
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      for (let i = SEGMENTS; i >= 0; i--) {
        const t = (i / SEGMENTS) * TAU
        const r = getRadii(t).inner
        const x = centerX + r * Math.cos(t)
        const y = centerY + r * Math.sin(t)
        ctx.lineTo(x, y)
      }
      ctx.closePath()
      const asphalt = ctx.createLinearGradient(0, centerY - (trackRadius + trackWidth), 0, centerY + (trackRadius + trackWidth))
      asphalt.addColorStop(0, 'rgba(255,255,255,0.06)')
      asphalt.addColorStop(0.5, 'rgba(255,255,255,0.12)')
      asphalt.addColorStop(1, 'rgba(255,255,255,0.06)')
      ctx.fillStyle = asphalt
      ctx.shadowColor = 'rgba(255, 59, 141, 0.15)'
      ctx.shadowBlur = 18
      ctx.fill('nonzero')
      ctx.restore()

      // Outer/Inner neon rails (follow the wavy shape)
      ctx.save()
      ctx.lineWidth = 3
      ctx.strokeStyle = 'rgba(255, 59, 141, 0.55)'
      ctx.shadowColor = 'rgba(255, 59, 141, 0.65)'
      ctx.shadowBlur = 10
      // Outer
      ctx.beginPath()
      for (let i = 0; i <= SEGMENTS; i++) {
        const t = (i / SEGMENTS) * TAU
        const r = getRadii(t).outer
        const x = centerX + r * Math.cos(t)
        const y = centerY + r * Math.sin(t)
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
      // Inner
      ctx.beginPath()
      for (let i = 0; i <= SEGMENTS; i++) {
        const t = (i / SEGMENTS) * TAU
        const r = getRadii(t).inner
        const x = centerX + r * Math.cos(t)
        const y = centerY + r * Math.sin(t)
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
      ctx.restore()

      // Center dashed line (wavy centerline)
      ctx.save()
      ctx.strokeStyle = 'rgba(255, 180, 220, 0.9)'
      ctx.lineWidth = 2
      ctx.setLineDash([10, 10])
      ctx.beginPath()
      for (let i = 0; i <= SEGMENTS; i++) {
        const t = (i / SEGMENTS) * TAU
        const r = getRadii(t).center
        const x = centerX + r * Math.cos(t)
        const y = centerY + r * Math.sin(t)
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
      ctx.restore()

      // Finish line (radial segment at top, using wavy radii)
      const top = getRadii(-Math.PI / 2)
      ctx.save()
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 6
      ctx.beginPath()
      ctx.moveTo(centerX + top.inner * Math.cos(-Math.PI / 2), centerY + top.inner * Math.sin(-Math.PI / 2))
      ctx.lineTo(centerX + top.outer * Math.cos(-Math.PI / 2), centerY + top.outer * Math.sin(-Math.PI / 2))
      ctx.stroke()
      ctx.lineWidth = 3
      ctx.strokeStyle = '#000'
      ctx.setLineDash([6, 6])
      ctx.beginPath()
      ctx.moveTo(centerX + top.inner * Math.cos(-Math.PI / 2), centerY + top.inner * Math.sin(-Math.PI / 2))
      ctx.lineTo(centerX + top.outer * Math.cos(-Math.PI / 2), centerY + top.outer * Math.sin(-Math.PI / 2))
      ctx.stroke()
      ctx.restore()
    }

    function drawItems() {
      const s = stateRef.current
      if (!s.items.length) return
      for (const it of s.items) {
        ctx.save()
        ctx.translate(it.x, it.y)
        // Orient along direction of travel (tangent to centerline)
        ctx.rotate(it.theta + Math.PI / 2)
        if (it.type === 'accelerator') {
          ctx.shadowColor = 'rgba(80, 220, 255, 0.8)'
          ctx.shadowBlur = 12
          ctx.fillStyle = 'rgba(80, 220, 255, 0.95)'
          ctx.beginPath()
          ctx.moveTo(it.r + 3, 0)
          ctx.lineTo(-it.r, -it.r * 0.8)
          ctx.lineTo(-it.r, it.r * 0.8)
          ctx.closePath()
          ctx.fill()
        } else if (it.type === 'obstacle') {
          ctx.shadowColor = 'rgba(255, 90, 90, 0.8)'
          ctx.shadowBlur = 10
          ctx.fillStyle = 'rgba(255, 60, 60, 0.95)'
          const sz = it.r + 2
          ctx.fillRect(-sz, -sz, sz * 2, sz * 2)
          ctx.strokeStyle = 'rgba(0,0,0,0.65)'
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.moveTo(-sz, -sz)
          ctx.lineTo(sz, sz)
          ctx.moveTo(-sz, sz)
          ctx.lineTo(sz, -sz)
          ctx.stroke()
        } else {
          // bonus
          ctx.shadowColor = 'rgba(255, 230, 120, 0.9)'
          ctx.shadowBlur = 12
          ctx.fillStyle = 'rgba(255, 215, 80, 0.98)'
          const r = it.r
          ctx.beginPath()
          for (let i = 0; i < 5; i++) {
            const a = (i / 5) * TAU
            const x = Math.cos(a) * r
            const y = Math.sin(a) * r
            if (i === 0) ctx.moveTo(x, y)
            else ctx.lineTo(x, y)
            const a2 = a + TAU / 10
            ctx.lineTo(Math.cos(a2) * (r * 0.45), Math.sin(a2) * (r * 0.45))
          }
          ctx.closePath()
          ctx.fill()
        }
        ctx.restore()
      }
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
      // Left block
      ctx.textAlign = 'left'
      ctx.fillText(`Lap ${stateRef.current.lap}`, 12, 18)
      ctx.fillText(`Time ${toClock(thisLap)}`, 12, 34)
      if (s.bestLapMs != null) {
        ctx.fillText(`Best ${toClock(s.bestLapMs)}`, 12, 50)
      }
      // Right block
      ctx.textAlign = 'right'
      ctx.fillText(`Speed ${Math.round(speedKmh)} u`, WIDTH - 12, 18)
      ctx.fillText(`Score ${s.score}`, WIDTH - 12, 34)
      // Center messages
      if (s.paused) {
        ctx.textAlign = 'center'
        ctx.font = '700 18px Orbitron, Inter, sans-serif'
        ctx.fillText('Paused', WIDTH / 2, 28)
      } else if (s.message && now < s.messageUntilMs) {
        ctx.textAlign = 'center'
        ctx.font = '700 16px Orbitron, Inter, sans-serif'
        ctx.fillText(s.message, WIDTH / 2, 40)
      }
      ctx.restore()
    }

    function frame(now) {
      const dt = Math.min(0.05, (now - (prevTimeRef.current || now)) / 1000)
      prevTimeRef.current = now

      update(dt)
      drawTrack()
      drawItems()
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
        to drive. <span className="kbd">Space</span> to brake. <span className="kbd">R</span> reset, <span className="kbd">P</span> pause.
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

