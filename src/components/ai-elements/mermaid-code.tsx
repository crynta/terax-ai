"use client"

import mermaid from "mermaid"
import { useEffect, useRef, useState } from "react"
import { useIsCodeFenceIncomplete } from "streamdown"

interface MermaidProps {
    code: string
}

export function MermaidCode({ code }: MermaidProps) {
    const containerRef = useRef<HTMLDivElement>(null)
    const isIncomplete = useIsCodeFenceIncomplete()
    const [mermaidError, setMermaidError] = useState<string | null>(null)

    useEffect(() => {
        mermaid.initialize({
            startOnLoad: false,
            theme: "default",
            securityLevel: "strict",
            fontFamily: "JetBrains Mono, sans-serif",
        })
    }, [])

    useEffect(() => {
        setMermaidError(null)

        if (!containerRef.current || !code) return
        if (isIncomplete) return

        containerRef.current.innerHTML = ""

        const div = document.createElement("div")
        div.className = "mermaid"
        div.textContent = code
        containerRef.current.appendChild(div)

        mermaid
            .run({
                nodes: [div],
                suppressErrors: false,
            })
            .catch((err) => {
                setMermaidError(err?.message || "Mermaid syntax error")
            })
    }, [code, isIncomplete])

    if (isIncomplete) {
        return <pre>{code}</pre>
    }

    if (mermaidError) {
        return (
            <pre className="overflow-x-auto rounded-lg border bg-muted p-3 text-xs text-foreground whitespace-pre-wrap">
                {code}
                {"\n\n"}
                <span className="block border-l-2 border-destructive pl-2 text-destructive bg-destructive/10">
                    {/* Mermaid Error */}
                    {mermaidError}
                </span>
            </pre>
        )
    }

    return (
        <div
            ref={containerRef}
            className="my-4 flex justify-center overflow-auto rounded-lg border bg-card p-4"
        />
    )
}