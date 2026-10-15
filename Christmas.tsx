import { useCallback, useEffect, useMemo, useRef, useState, startTransition, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react"
import { addPropertyControls, ControlType, useIsStaticRenderer } from "./framer"
import { useInView } from "framer-motion"

interface MyComponentProps {
    snow?: number
    snowColor?: string
    text: string
    frontImage?: string
    fontSize: number
    letterColor: string
    highlightColor: string
    backgroundColor: string
    radius: number
    stiffness: number
    damping: number
    volume: number
    noteInterval: number
    reverbAmount: number
    soundEnabled: boolean
    gravity?: number
    brush?: number
    spacing?: number
    style?: CSSProperties
}

type AudioEngine = {
    context: AudioContext
    master: GainNode
    dry: GainNode
    wetSend: GainNode
    convolver: ConvolverNode
    wet: GainNode
}

const melodyHz = [
    1760.0, 1760.0, 1760.0, 1567.98, 1396.91, 1318.51, 1318.51, 1318.51, 1174.66, 1046.5, 1174.66, 1174.66, 1174.66, 1318.51, 1174.66, 1046.5,
    987.77, 1046.5, 880.0, 659.25, 739.99, 830.61, 880.0, 987.77, 1046.5, 1174.66, 1318.51, 1174.66, 1046.5, 659.25, 739.99, 830.61, 880.0, 987.77,
    1046.5, 1174.66, 1318.51, 1174.66, 1046.5,
]

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value))
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
    const cleaned = hex.replace("#", "")
    const normalized = cleaned.length === 3 ? cleaned.split("").map((c) => c + c).join("") : cleaned
    const numeric = Number.parseInt(normalized, 16)
    if (Number.isNaN(numeric)) return { r: 0, g: 0, b: 0 }
    return {
        r: (numeric >> 16) & 255,
        g: (numeric >> 8) & 255,
        b: numeric & 255,
    }
}

function mixColor(a: string, b: string, t: number): string {
    const from = hexToRgb(a)
    const to = hexToRgb(b)
    const amount = clamp(t, 0, 1)
    const r = Math.round(from.r + (to.r - from.r) * amount)
    const g = Math.round(from.g + (to.g - from.g) * amount)
    const bch = Math.round(from.b + (to.b - from.b) * amount)
    return `rgb(${r}, ${g}, ${bch})`
}

function createImpulseResponse(context: AudioContext, seconds = 4.5): AudioBuffer {
    const length = Math.floor(context.sampleRate * seconds)
    const impulse = context.createBuffer(2, length, context.sampleRate)
    for (let channel = 0; channel < impulse.numberOfChannels; channel++) {
        const data = impulse.getChannelData(channel)
        for (let i = 0; i < length; i++) {
            const decay = Math.pow(1 - i / length, 3.6)
            data[i] = (Math.random() * 2 - 1) * decay
        }
    }
    return impulse
}

/**
 * @framerSupportedLayoutWidth fixed
 * @framerSupportedLayoutHeight fixed
 */
export default function LetterCloth(props: MyComponentProps) {
    const {
        text,
        fontSize,
        letterColor,
        highlightColor,
        backgroundColor,
        radius,
        stiffness,
        damping,
        volume,
        noteInterval,
        reverbAmount,
        soundEnabled,
        gravity = 0.5,
        brush = 1,
        spacing = 2,
        frontImage = "",
        snow = 80,
        snowColor = "#eee5e5",
        style,
    } = props
    const staticRenderer = useIsStaticRenderer()
    const rootRef = useRef<HTMLDivElement | null>(null)
    const canvasRef = useRef<HTMLCanvasElement | null>(null)
    const inView = useInView(rootRef, { amount: 0.02 })
    const [audioActive, setAudioActive] = useState(false)

    const engineRef = useRef<AudioEngine | null>(null)
    const sizesRef = useRef({ width: 0, height: 0, dpr: 1 })
    // Each string is one hanging chain of beads. Only sideways offset (ox) and velocity (vx) are simulated.
    const gridRef = useRef({
        strings: 0,
        rows: 0,
        cellW: 0,
        cellH: 0,
        gap: 0,
        offsetX: 0,
        ox: new Float32Array(0),
        vx: new Float32Array(0),
    })
    const pointerRef = useRef({
        x: -9999,
        y: -9999,
        active: false,
        lastX: 0,
        lastY: 0,
        lastT: 0,
        speed: 0,
        vx: 0,
        vy: 0,
        cellX: -1,
        cellY: -1,
        lastTriggerX: 0,
        lastTriggerY: 0,
        lastTriggerT: 0,
    })
    const melodyIndexRef = useRef(0)
    const snowRef = useRef<{ x: number; y: number; r: number; s: number; p: number }[]>([])
    const rafRef = useRef(0)
    const lastFrameRef = useRef(0)

    // One letter per string, spaces removed: C A R O L O F T H E B E L L S
    const letters = useMemo(() => {
        const cleaned = (text && text.length > 0 ? text : "CAROL OF THE BELLS ").replace(/\s+/g, "")
        return cleaned.length > 0 ? cleaned : "CAROLOFTHEBELLS"
    }, [text])

    const ensureAudio = useCallback(async () => {
        if (!soundEnabled || staticRenderer) return null
        if (typeof window === "undefined") return null

        if (!engineRef.current) {
            const context = new window.AudioContext()
            const master = context.createGain()
            master.gain.value = clamp(volume, 0, 1)

            const dry = context.createGain()
            const wetSend = context.createGain()
            const convolver = context.createConvolver()
            convolver.buffer = createImpulseResponse(context)
            const wet = context.createGain()

            dry.gain.value = 1
            wetSend.gain.value = clamp(reverbAmount, 0, 1)
            wet.gain.value = 0.5 + clamp(reverbAmount, 0, 1) * 0.5

            dry.connect(master)
            wetSend.connect(convolver)
            convolver.connect(wet)
            wet.connect(master)
            master.connect(context.destination)

            engineRef.current = { context, master, dry, wetSend, convolver, wet }
        }

        if (engineRef.current.context.state !== "running") {
            await engineRef.current.context.resume()
        }
        startTransition(() => setAudioActive(engineRef.current?.context.state === "running"))
        return engineRef.current
    }, [reverbAmount, soundEnabled, staticRenderer, volume])

    const playNextNote = useCallback(
        (velocity: number) => {
            const engine = engineRef.current
            if (!engine || !soundEnabled) return
            const now = engine.context.currentTime
            // First pass: play the song in order. After that: random notes from the melody.
            const index =
                melodyIndexRef.current < melodyHz.length
                    ? melodyIndexRef.current
                    : Math.floor(Math.random() * melodyHz.length)
            const frequency = melodyHz[index]
            melodyIndexRef.current += 1
            const noteGain = engine.context.createGain()
            const pan = engine.context.createStereoPanner()
            pan.pan.value = (Math.random() * 2 - 1) * 0.5

            noteGain.gain.setValueAtTime(0.0001, now)
            const amp = clamp(0.12 + velocity * 0.35, 0.08, 0.6)
            noteGain.gain.linearRampToValueAtTime(amp, now + 0.012)
            noteGain.gain.exponentialRampToValueAtTime(0.0001, now + 6.0)

            const ratios = [1, 2.76, 5.4]
            const gains = [1, 0.28, 0.12]
            ratios.forEach((ratio, i) => {
                const osc = engine.context.createOscillator()
                const partial = engine.context.createGain()
                osc.type = i === 0 ? "sine" : "triangle"
                osc.frequency.setValueAtTime(frequency * ratio, now)
                osc.detune.setValueAtTime((Math.random() * 2 - 1) * 7, now)
                partial.gain.value = gains[i]
                osc.connect(partial)
                partial.connect(noteGain)
                osc.start(now)
                osc.stop(now + 6.5)
            })

            noteGain.connect(pan)
            pan.connect(engine.dry)
            pan.connect(engine.wetSend)
        },
        [soundEnabled]
    )

    const triggerNoteIfNeeded = useCallback(
        async (forceCellCheck = false) => {
            if (!soundEnabled || staticRenderer) return
            const pointer = pointerRef.current
            const now = performance.now()
            const elapsed = now - pointer.lastTriggerT
            if (elapsed < Math.max(30, noteInterval)) return

            const grid = gridRef.current
            const nextCellX = grid.gap > 0 ? Math.floor(pointer.x / grid.gap) : -1
            const nextCellY = grid.cellH > 0 ? Math.floor(pointer.y / grid.cellH) : -1
            const cellChanged = nextCellX !== pointer.cellX || nextCellY !== pointer.cellY
            const dx = pointer.x - pointer.lastTriggerX
            const dy = pointer.y - pointer.lastTriggerY
            const travel = Math.hypot(dx, dy)
            const threshold = Math.max(8, fontSize * 0.65)

            if (forceCellCheck || cellChanged || travel >= threshold) {
                const engine = await ensureAudio()
                if (!engine) return
                const velocity = clamp(pointer.speed / 1400, 0, 1)
                playNextNote(velocity)
                pointer.cellX = nextCellX
                pointer.cellY = nextCellY
                pointer.lastTriggerX = pointer.x
                pointer.lastTriggerY = pointer.y
                pointer.lastTriggerT = now
            }
        },
        [ensureAudio, fontSize, noteInterval, playNextNote, soundEnabled, staticRenderer]
    )

    const setupGrid = useCallback(() => {
        const { width, height } = sizesRef.current
        const cellW = Math.max(4, fontSize * 0.62)
        const cellH = Math.max(6, fontSize * 1.15)
        const gap = cellW * clamp(spacing, 1.2, 12)
        const strings = Math.max(1, Math.floor(width / gap))
        const offsetX = (width - (strings - 1) * gap) / 2
        const rows = Math.max(2, Math.ceil(height / cellH))
        const count = strings * rows

        gridRef.current = {
            strings,
            rows,
            cellW,
            cellH,
            gap,
            offsetX,
            ox: new Float32Array(count),
            vx: new Float32Array(count),
        }
    }, [fontSize, spacing])

    const drawFrame = useCallback(
        (time: number) => {
            const canvas = canvasRef.current
            if (!canvas) return
            const ctx = canvas.getContext("2d")
            if (!ctx) return

            const { width, height } = sizesRef.current
            const grid = gridRef.current
            const pointer = pointerRef.current
            const dtRaw = lastFrameRef.current === 0 ? 16 : time - lastFrameRef.current
            const dt = clamp(dtRaw, 8, 34) / 16.666
            lastFrameRef.current = time

            ctx.clearRect(0, 0, width, height)
            ctx.fillStyle = backgroundColor
            
            // Blizzard (drawn before the letters, so it falls behind the curtain)
            const flakes = snowRef.current
            const target = Math.round(clamp(snow, 0, 800))
            const flakeSize = 1.5 // every flake is the same size
            while (flakes.length < target) {
                flakes.push({
                    x: Math.random() * width,
                    y: Math.random() * height,
                    r: flakeSize,
                    s: 2 + Math.random() * 1.2, // fall speed
                    p: Math.random() * Math.PI * 2, // gust phase
                })
            }
            if (flakes.length > target) flakes.length = target
            ctx.fillStyle = snowColor
            ctx.globalAlpha = 0.75
            // Wind comes in swells, blowing the whole storm sideways
            const wind = 3 + Math.sin(time * 0.0004) * 0.9
            for (const f of flakes) {
                f.y += f.s * dt
                f.x += (wind + Math.sin(time * 0.002 + f.p) * 0.6) * dt
                if (f.y > height + 4) {
                    f.y = -4
                    f.x = Math.random() * width
                }
                if (f.x > width + 4) f.x = -4
                if (f.x < -4) f.x = width + 4
                ctx.beginPath()
                ctx.arc(f.x, f.y, flakeSize, 0, Math.PI * 2)
                ctx.fill()
            }
            ctx.globalAlpha = 1            
            const influenceRadius = Math.max(10, radius)
            const { strings, rows, cellH, gap, offsetX, ox, vx } = grid
            const interactive = pointer.active && inView && !staticRenderer
            const top = 4

            const chainK = clamp(stiffness, 0.01, 1) * 0.6 // how strongly a bead follows its neighbours on the same string
            const stringK = 0.003 // strings are almost independent; they only bump each other a little
            const homeK = clamp(gravity, 0, 1) * 0.012 // soft gravity: swings each string back to hanging straight
            const drag = clamp(damping, 0.01, 1) * 0.08
            const brushK = clamp(brush, 0, 3)
            const maxPush = influenceRadius * 0.6
            const steps = 2
            const h = dt / steps

            for (let s = 0; s < steps; s++) {
                for (let row = 1; row < rows; row++) {
                    const rowT = row / (rows - 1)
                    const by = top + row * cellH + cellH * 0.5
                    const chain = chainK * (1 - 0.35 * rowT)

                    for (let col = 0; col < strings; col++) {
                        const i = row * strings + col
                        const o = ox[i]
                        const up = ox[i - strings]
                        const down = row < rows - 1 ? ox[i + strings] : o
                        const left = col > 0 ? ox[i - 1] : o
                        const right = col < strings - 1 ? ox[i + 1] : o

                        let f = chain * (up - o + (down - o)) + stringK * (left + right - 2 * o) - homeK * o

                        // faint breeze, each string slightly out of sync
                        f += Math.sin(time * 0.0007 + col * 1.7) * 0.0025 * rowT

                        let pushed = false

                        // Part the curtain: beads inside the cursor's circle are shoved out to its left or right edge
                        if (interactive) {
                            const homeX = offsetX + col * gap
                            const dx = homeX + o - pointer.x
                            const dy = by - pointer.y
                            if (Math.abs(dy) < influenceRadius) {
                                const edge = Math.sqrt(influenceRadius * influenceRadius - dy * dy)
                                if (Math.abs(dx) < edge) {
                                    const side = Math.abs(dx) < 0.5 ? (pointer.vx >= 0 ? 1 : -1) : Math.sign(dx)
                                    // push fades to zero at the circle's edge, so beads ease aside instead of snapping
                                    f += side * (edge - Math.abs(dx)) * 0.04 * brushK
                                    pushed = true
                                }                            }
                        }

                        vx[i] = clamp((vx[i] + f * h) * (1 - drag * h), -3, 3)
                        if (pushed) vx[i] *= 0.82
                    }
                }

                for (let row = 1; row < rows; row++) {
                    const limit = Math.min(row * cellH * 0.9 + 4, maxPush + gap)
                    for (let col = 0; col < strings; col++) {
                        const i = row * strings + col
                        ox[i] = clamp(ox[i] + vx[i] * h, -limit, limit)
                    }
                }
            }
                        // Light smoothing along each string so fast brushes curve instead of wiggle
            for (let row = 1; row < rows - 1; row++) {
                for (let col = 0; col < strings; col++) {
                    const i = row * strings + col
                    ox[i] += ((ox[i - strings] + ox[i + strings]) * 0.5 - ox[i]) * 0.12
                }
            }

            ctx.font = `${fontSize}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`
            ctx.textBaseline = "top"
            ctx.textAlign = "center"

            for (let col = 0; col < strings; col++) {
                const sx = offsetX + col * gap
                const ch = letters[col % letters.length]

                for (let row = 0; row < rows; row++) {
                    const d = ox[row * strings + col]
                    const length = row * cellH
                    // Beads swing like pendulums, so they rise a little as they move sideways
                    const rise = length > 0 ? length - Math.sqrt(Math.max(0, length * length - d * d)) : 0
                    const x = sx + d
                    const y = top + row * cellH - rise
                    const tint = pointer.active ? clamp(1 - Math.hypot(x - pointer.x, y - pointer.y) / influenceRadius, 0, 1) : 0
                    ctx.fillStyle = tint > 0 ? mixColor(letterColor, highlightColor, tint * 0.95) : letterColor
                    ctx.fillText(ch, x, y)
                }
            }
            ctx.textAlign = "left"
        },
        [backgroundColor, brush, damping, fontSize, gravity, highlightColor, inView, letterColor, letters, radius, staticRenderer, stiffness, snow, snowColor]
    )

    useEffect(() => {
        if (typeof window === "undefined") return
        const root = rootRef.current
        const canvas = canvasRef.current
        if (!root || !canvas) return

        const resize = () => {
            const rect = root.getBoundingClientRect()
            const dpr = window.devicePixelRatio || 1
            sizesRef.current = {
                width: Math.max(1, Math.round(rect.width)),
                height: Math.max(1, Math.round(rect.height)),
                dpr,
            }
            canvas.width = Math.max(1, Math.round(sizesRef.current.width * dpr))
            canvas.height = Math.max(1, Math.round(sizesRef.current.height * dpr))
            canvas.style.width = `${sizesRef.current.width}px`
            canvas.style.height = `${sizesRef.current.height}px`
            const ctx = canvas.getContext("2d")
            if (ctx) {
                ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
            }
            setupGrid()
            drawFrame(performance.now())
        }

        resize()
        const observer = new ResizeObserver(() => resize())
        observer.observe(root)
        return () => observer.disconnect()
    }, [drawFrame, setupGrid])

    useEffect(() => {
        if (engineRef.current) {
            engineRef.current.master.gain.value = clamp(volume, 0, 1)
            engineRef.current.wetSend.gain.value = clamp(reverbAmount, 0, 1)
        }
    }, [reverbAmount, volume])

    useEffect(() => {
        if (staticRenderer || !inView) {
            drawFrame(performance.now())
            return
        }

        const tick = (time: number) => {
            drawFrame(time)
            rafRef.current = requestAnimationFrame(tick)
        }
        rafRef.current = requestAnimationFrame(tick)
        return () => cancelAnimationFrame(rafRef.current)
    }, [drawFrame, inView, staticRenderer])

    useEffect(() => {
        return () => {
            cancelAnimationFrame(rafRef.current)
            if (engineRef.current) {
                engineRef.current.context.close()
                engineRef.current = null
            }
        }
    }, [])

    const updatePointer = useCallback(
        async (clientX: number, clientY: number, forceTrigger: boolean) => {
            const root = rootRef.current
            if (!root) return
            const rect = root.getBoundingClientRect()
            const pointer = pointerRef.current
            const nextX = clientX - rect.left
            const nextY = clientY - rect.top
            const now = performance.now()
            const dt = Math.max(1, now - pointer.lastT)
            const dx = nextX - pointer.lastX
            const dy = nextY - pointer.lastY
            pointer.speed = Math.hypot(dx, dy) / (dt / 1000)
            const frames = dt / 16.666
            pointer.vx = clamp(pointer.vx * 0.5 + (dx / frames) * 0.5, -30, 30)
            pointer.vy = clamp(pointer.vy * 0.5 + (dy / frames) * 0.5, -30, 30)
            pointer.x = nextX
            pointer.y = nextY
            pointer.lastX = nextX
            pointer.lastY = nextY
            pointer.lastT = now
            pointer.active = true
            await triggerNoteIfNeeded(forceTrigger)
        },
        [triggerNoteIfNeeded]
    )

    const handlePointerMove = useCallback(
        async (event: ReactPointerEvent<HTMLDivElement>) => {
            await updatePointer(event.clientX, event.clientY, false)
            if (!audioActive) {
                await ensureAudio()
            }
        },
        [audioActive, ensureAudio, updatePointer]
    )

    const handlePointerDown = useCallback(
        async (event: ReactPointerEvent<HTMLDivElement>) => {
            await updatePointer(event.clientX, event.clientY, true)
            await ensureAudio()
        },
        [ensureAudio, updatePointer]
    )

    const handlePointerLeave = useCallback(() => {
        pointerRef.current.active = false
    }, [])

    return (
        <div
            ref={rootRef}
            onPointerMove={handlePointerMove}
            onPointerDown={handlePointerDown}
            onClick={ensureAudio}
            onPointerLeave={handlePointerLeave}
            role="button"
            aria-label="Interactive beaded letter curtain sound surface"
            tabIndex={0}
            style={{
                position: "relative",
                width: "100%",
                height: "100%",
                overflow: "hidden",
                background: backgroundColor,
                touchAction: "none",
                cursor: "crosshair",
                ...style,
            }}
        >
            <canvas
                ref={canvasRef}
                aria-hidden="true"
                style={{
                    position: "absolute",
                    inset: 0,
                    width: "100%",
                    height: "100%",
                    display: "block",
                }}
            />
                        {frontImage ? (
                <img
                    src={frontImage}
                    alt=""
                    aria-hidden="true"
                    draggable={false}
                    style={{
                        position: "absolute",
                        inset: 0,
                        width: "100%",
                        height: "100%",
                        objectFit: "contain",
                        pointerEvents: "none",
                        userSelect: "none",
                    }}
                />
            ) : null}
            {!audioActive && soundEnabled && !staticRenderer ? (
                <div
                    style={{
                        position: "absolute",
                        right: 10,
                        bottom: 10,
                        padding: "6px 10px",
                        borderRadius: 999,
                        background: "rgba(255,255,255,0.72)",
                        color: "#666666",
                        fontSize: 11,
                        lineHeight: "1em",
                        letterSpacing: "0.01em",
                        fontFamily:
                            'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                        pointerEvents: "none",
                        userSelect: "none",
                    }}
                >
                    Move to play · click to enable sound
                </div>
            ) : null}
        </div>
    )
}

addPropertyControls(LetterCloth, {
        snow: { type: ControlType.Number, title: "Snow", defaultValue: 80, min: 0, max: 400, step: 5 },
    snowColor: { type: ControlType.Color, title: "Snow Color", defaultValue: "#ffffff" },
    text: { type: ControlType.String, title: "Text", defaultValue: "CAROL OF THE BELLS " },
    fontSize: { type: ControlType.Number, title: "Font Size", defaultValue: 16, min: 8, max: 40, step: 1 },
    letterColor: { type: ControlType.Color, title: "Letter", defaultValue: "#1b114e" },
    highlightColor: { type: ControlType.Color, title: "Highlight", defaultValue: "#ffef89" },
    backgroundColor: { type: ControlType.Color, title: "Background", defaultValue: "#3887e2" },
    radius: { type: ControlType.Number, title: "Radius", defaultValue: 70, min: 20, max: 300, step: 1 },
    stiffness: { type: ControlType.Number, title: "Stiffness", defaultValue: 0.13, min: 0.01, max: 1, step: 0.01 },
    damping: { type: ControlType.Number, title: "Damping", defaultValue: 0.2, min: 0.01, max: 1, step: 0.01 },
    gravity: { type: ControlType.Number, title: "Gravity", defaultValue: 0.5, min: 0, max: 1, step: 0.01 },
    brush: { type: ControlType.Number, title: "Push", defaultValue: 1, min: 0, max: 3, step: 0.05 },
    spacing: { type: ControlType.Number, title: "String Gap", defaultValue: 2, min: 1.2, max: 12, step: 0.1 },
    volume: { type: ControlType.Number, title: "Volume", defaultValue: 0.3, min: 0, max: 1, step: 0.01 },
    noteInterval: { type: ControlType.Number, title: "Note ms", defaultValue: 150, min: 50, max: 1000, step: 1 },
    reverbAmount: { type: ControlType.Number, title: "Reverb", defaultValue: 0.24, min: 0, max: 1, step: 0.01 },
    soundEnabled: { type: ControlType.Boolean, title: "Sound", defaultValue: true, enabledTitle: "On", disabledTitle: "Off" },
})