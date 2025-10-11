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
  const ua = navigator.userAgent ?? ''
  const uaLower = ua.toLowerCase()
  const mobileRegex = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i

  const navWithUAData = navigator as Navigator & {
    userAgentData?: {
      mobile?: boolean
      brands?: Array<{ brand: string }>
    }
  }

  const uaDataMobile =
    navWithUAData.userAgentData?.mobile ??
    navWithUAData.userAgentData?.brands?.some((brand) =>
      /android|iphone|ipad|ipod/.test(brand.brand.toLowerCase())
    ) ??
    false

  const userAgentMobile = mobileRegex.test(uaLower) || uaDataMobile
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
  const uaLower = navigator.userAgent.toLowerCase()
  const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 1

  const isIPad =
    /ipad/.test(uaLower) ||
    (navigator.userAgent.includes('Macintosh') && hasTouch)

  const isAndroidTablet = /android/.test(uaLower) &&
                          viewport.width >= 600 &&
                          !/mobile/.test(uaLower)

  const isTabletSize = viewport.width >= 600 && viewport.width <= 1024

  return isIPad || isAndroidTablet || (isTabletSize && hasTouch)
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
