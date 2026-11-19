import { useEffect, useState } from "react";

const MOTION_EXIT_MS = 140;
const REDUCED_MOTION_EXIT_MS = 200;

export type MotionState = "open" | "closed";

export type AnimationOrigin = { x: number; y: number };

export function triggerCenter(trigger: Element): AnimationOrigin {
    const { left, top, width, height } = trigger.getBoundingClientRect();
    return { x: left + width / 2, y: top + height / 2 };
}

export function setTriggerOrigin(
    element: HTMLElement,
    origin: AnimationOrigin | undefined,
) {
    if (!origin) {
        element.style.removeProperty("--trigger-origin");
        return;
    }

    let { left, top, width, height } = element.getBoundingClientRect();
    if (width === 0 && height === 0) {
        return;
    }
    const style = getComputedStyle(element);
    // Recover the layout position if the panel has already applied its starting transform.
    if (style.transform && style.transform !== "none") {
        const [x = 0, y = 0] = style.transformOrigin
            .split(" ")
            .map(Number.parseFloat);
        const matrix = new DOMMatrixReadOnly(style.transform);
        left -= matrix.e + x * (1 - matrix.a);
        top -= matrix.f + y * (1 - matrix.d);
    }
    element.style.setProperty(
        "--trigger-origin",
        `${origin.x - left}px ${origin.y - top}px`,
    );
}

export function interactionMotionIsInstant(): boolean {
    return document.documentElement.dataset.inputModality === "keyboard";
}

export function motionExitDuration(): number {
    if (interactionMotionIsInstant()) {
        return 0;
    }
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? REDUCED_MOTION_EXIT_MS
        : MOTION_EXIT_MS;
}

export function useMotionPresence(visible: boolean): {
    present: boolean;
    state: MotionState;
} {
    const [retained, setRetained] = useState(visible);

    useEffect(() => {
        if (visible) {
            setRetained(true);
            return;
        }
        if (!retained) {
            return;
        }

        const timer = window.setTimeout(
            () => setRetained(false),
            motionExitDuration(),
        );
        return () => window.clearTimeout(timer);
    }, [retained, visible]);

    return {
        present: visible || retained,
        state: visible ? "open" : "closed",
    };
}

// A leaving element gives its space back while it fades, so its siblings close the gap in the same
// motion instead of jumping once the fade ends.
export function collapseWhileExiting(element: HTMLElement, duration: number) {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        return;
    }
    element.animate(
        [
            {
                height: `${element.offsetHeight}px`,
                paddingBlock: getComputedStyle(element).paddingBlock,
            },
            { height: "0px", paddingBlock: "0px" },
        ],
        {
            duration,
            easing: "cubic-bezier(0.23, 1, 0.32, 1)",
            fill: "forwards",
        },
    );
}

// Share the CSS timing tokens with coordinated React transitions.
export function surfaceTransition(reduced: boolean, exiting = false) {
    const styles = window.getComputedStyle(document.documentElement);
    const token = reduced
        ? "--duration-reduced"
        : exiting
          ? "--duration-fast"
          : "--duration-surface";
    return {
        duration: interactionMotionIsInstant()
            ? 0
            : (Number.parseFloat(styles.getPropertyValue(token)) || 0) / 1000,
        ease: [0.23, 1, 0.32, 1] as const,
    };
}
