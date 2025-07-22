import { WebGLRenderer } from 'three'

export function resizeRendererToDisplaySize(renderer: WebGLRenderer) {
  const canvas = renderer.domElement
  const width = canvas.clientWidth
  const height = canvas.clientHeight
  const needResize = canvas.width !== width || canvas.height !== height
  if (needResize) {
    renderer.setSize(width, height, false)
  }
  return needResize
}

export function isMobile(): boolean {
  // Check multiple indicators for mobile device
  const userAgent = navigator.userAgent || navigator.vendor || (window as any).opera || ''
  const mobileRegex = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i
  
  // Check user agent
  const userAgentMobile = mobileRegex.test(userAgent.toLowerCase())
  
  // Check screen dimensions (typical mobile breakpoint)
  const screenMobile = window.innerWidth <= 768
  
  // Check for touch support
  const touchSupport = 'ontouchstart' in window || navigator.maxTouchPoints > 0
  
  // Combine checks - prioritize screen size and user agent
  return userAgentMobile || (screenMobile && touchSupport)
}

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

export function isTablet(): boolean {
  const viewport = getViewportDimensions()
  const userAgent = navigator.userAgent.toLowerCase()
  
  // iPad detection
  const isIPad = /ipad/.test(userAgent) || 
                (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  
  // Android tablet detection (rough heuristic)
  const isAndroidTablet = /android/.test(userAgent) && 
                          viewport.width >= 600 && 
                          !/mobile/.test(userAgent)
  
  // General tablet size detection
  const isTabletSize = viewport.width >= 600 && viewport.width <= 1024
  
  return isIPad || isAndroidTablet || (isTabletSize && 'ontouchstart' in window)
}

export function getDeviceType(): 'mobile' | 'tablet' | 'desktop' {
  if (isMobile() && !isTablet()) return 'mobile'
  if (isTablet()) return 'tablet'
  return 'desktop'
}

// Debounced resize handler for performance
export function createResizeHandler(callback: () => void, delay: number = 100) {
  let timeoutId: number | null = null
  
  return function() {
    if (timeoutId) clearTimeout(timeoutId)
    timeoutId = window.setTimeout(callback, delay)
  }
}
