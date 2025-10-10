/**
 * Client-side only device detection utilities.
 * These functions assume browser environment and should only be called
 * from onMount, createEffect, or event handlers in client:only components.
 */

/**
 * Detects if the current device is mobile based on user agent, screen size, and touch support.
 * IMPORTANT: Call only from client-side contexts (onMount, effects, event handlers)
 */
export function isMobile(): boolean {
  const userAgent = navigator.userAgent || navigator.vendor || (window as any).opera || ''
  const mobileRegex = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i

  const userAgentMobile = mobileRegex.test(userAgent.toLowerCase())
  const screenMobile = window.innerWidth <= 768
  const touchSupport = 'ontouchstart' in window || navigator.maxTouchPoints > 0

  return userAgentMobile || (screenMobile && touchSupport)
}

/**
 * Gets current viewport dimensions and device characteristics.
 * IMPORTANT: Call only from client-side contexts (onMount, effects, event handlers)
 */
export function getViewportDimensions() {
  return {
    width: window.innerWidth,
    height: window.innerHeight,
    ratio: window.innerWidth / window.innerHeight,
    isMobile: isMobile(),
    isLandscape: window.innerWidth > window.innerHeight,
    isPortrait: window.innerHeight > window.innerWidth
  }
}

/**
 * Detects if the current device is a tablet.
 * IMPORTANT: Call only from client-side contexts (onMount, effects, event handlers)
 */
export function isTablet(): boolean {
  const viewport = getViewportDimensions()
  const userAgent = navigator.userAgent.toLowerCase()

  const isIPad = /ipad/.test(userAgent) ||
                (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

  const isAndroidTablet = /android/.test(userAgent) &&
                          viewport.width >= 600 &&
                          !/mobile/.test(userAgent)

  const isTabletSize = viewport.width >= 600 && viewport.width <= 1024

  return isIPad || isAndroidTablet || (isTabletSize && 'ontouchstart' in window)
}

/**
 * Gets the device type classification.
 * IMPORTANT: Call only from client-side contexts (onMount, effects, event handlers)
 */
export function getDeviceType(): 'mobile' | 'tablet' | 'desktop' {
  if (isMobile() && !isTablet()) return 'mobile'
  if (isTablet()) return 'tablet'
  return 'desktop'
}

/**
 * Creates a debounced resize handler for performance optimization.
 */
export function createResizeHandler(callback: () => void, delay: number = 100) {
  let timeoutId: number | null = null

  return function() {
    if (timeoutId) clearTimeout(timeoutId)
    timeoutId = window.setTimeout(callback, delay)
  }
}
