/**
 * Resource loading interceptor (images, scripts, iframes)
 * Uses MutationObserver to detect new elements added to DOM
 */

import type { ClientEgressLog, Initiator } from '../types.js';

let observer: MutationObserver | null = null;
let originalImageSrc: PropertyDescriptor | null = null;

export function interceptResources(onRequest: (log: ClientEgressLog) => void): void {
  if (observer) return; // Already intercepted

  // Intercept Image() constructor src assignment
  interceptImageSrc(onRequest);

  // Use MutationObserver to catch dynamically added elements
  observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      // Check added nodes
      for (const node of mutation.addedNodes) {
        if (node instanceof HTMLElement) {
          checkElement(node, onRequest);
          // Also check children
          node.querySelectorAll('script, img, iframe').forEach((el) => {
            checkElement(el as HTMLElement, onRequest);
          });
        }
      }

      // Check attribute changes on existing elements
      if (mutation.type === 'attributes' && mutation.target instanceof HTMLElement) {
        const attr = mutation.attributeName;
        if (attr === 'src' || attr === 'href') {
          checkElement(mutation.target, onRequest);
        }
      }
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src', 'href'],
  });
}

function interceptImageSrc(onRequest: (log: ClientEgressLog) => void): void {
  // Intercept new Image().src = '...'
  originalImageSrc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');

  if (originalImageSrc && originalImageSrc.set) {
    const originalSetter = originalImageSrc.set;

    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      ...originalImageSrc,
      set(value: string) {
        if (value && !value.startsWith('data:')) {
          logResource(value, 'image', onRequest);
        }
        return originalSetter.call(this, value);
      },
    });
  }
}

function checkElement(el: HTMLElement, onRequest: (log: ClientEgressLog) => void): void {
  let url: string | null = null;
  let initiator: Initiator | null = null;

  if (el instanceof HTMLScriptElement && el.src) {
    url = el.src;
    initiator = 'script';
  } else if (el instanceof HTMLImageElement && el.src && !el.src.startsWith('data:')) {
    url = el.src;
    initiator = 'image';
  } else if (el instanceof HTMLIFrameElement && el.src) {
    url = el.src;
    initiator = 'iframe';
  }

  if (url && initiator) {
    logResource(url, initiator, onRequest);
  }
}

function logResource(url: string, initiator: Initiator, onRequest: (log: ClientEgressLog) => void): void {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url, window.location.origin);
  } catch {
    return; // Invalid URL
  }

  // Skip same-origin resources if they're likely assets
  if (parsedUrl.origin === window.location.origin) {
    return;
  }

  const log: ClientEgressLog = {
    timestamp: new Date().toISOString(),
    method: 'GET',
    url,
    host: parsedUrl.hostname,
    path: parsedUrl.pathname + parsedUrl.search,
    initiator,
    firstParty: false, // External resources are generally third-party
    stack: captureStack(),
  };

  onRequest(log);
}

export function restoreResources(): void {
  if (observer) {
    observer.disconnect();
    observer = null;
  }

  if (originalImageSrc) {
    Object.defineProperty(HTMLImageElement.prototype, 'src', originalImageSrc);
    originalImageSrc = null;
  }
}

function captureStack(): string {
  const stack = new Error().stack || '';
  return stack.split('\n').slice(3).join('\n');
}
