"use client"
import mermaid from 'mermaid'
import { useEffect, useRef } from 'react'
import { useIsCodeFenceIncomplete } from "streamdown"
interface MermaidProps {
    code: string
}
export function MermaidCode({ code }: MermaidProps) {
    console.log(code)
    const containerRef = useRef<HTMLDivElement>(null)
    const isIncomplete = useIsCodeFenceIncomplete()
    console.log(isIncomplete);

    useEffect(() => {
        mermaid.initialize({
            startOnLoad: false,
            theme: "default",
            securityLevel: "loose",
            fontFamily: "JetBrains Mono, sans-serif",
        })
    }, [])
    useEffect(() => {
        const renderCode = async () => {
            if (!containerRef.current || !code) return;
            if (isIncomplete) return
            containerRef.current.innerHTML = "";
            const div = document.createElement("div");
            div.className = "mermaid";
            div.textContent = code;
            containerRef.current.appendChild(div);
            try {

                await mermaid.run({
                    nodes: [div],
                    suppressErrors: true,
                });

            } catch (e) {
                console.warn("Mermaid render skipped (likely incomplete syntax):", e);
            }
        }
        renderCode()
    }, [code, isIncomplete])
    if (isIncomplete) return <pre>{code}</pre>;
    return <div ref={containerRef} className="my-4 flex justify-center overflow-auto rounded-lg border bg-card p-4" />
}