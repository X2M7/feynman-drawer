(() => {
  'use strict';

  const resizer = document.getElementById('layoutResizer');
  const mainContent = document.querySelector('.main-content');
  const sidebar = document.querySelector('.sidebar');
  const codePanel = document.querySelector('.code-panel');
  if (!resizer || !mainContent || !sidebar || !codePanel) return;

  const root = document.documentElement;
  const narrowLayout = window.matchMedia('(max-width: 900px)');
  const storageKey = 'feyndraw-code-panel-ratio';
  const minimumCodeWidth = 280;
  const minimumCanvasWidth = 340;
  const maximumCodeWidth = 720;
  const defaultCodeWidth = 350;

  let preferredRatio = null;
  let dragging = false;
  let resizeFrame = 0;

  try {
    const stored = Number.parseFloat(window.localStorage.getItem(storageKey));
    if (Number.isFinite(stored) && stored >= 0.2 && stored <= 0.75) {
      preferredRatio = stored;
    }
  } catch (_) {
    // Layout resizing remains available when storage is blocked.
  }

  function getBounds() {
    const mainRect = mainContent.getBoundingClientRect();
    const sidebarWidth = sidebar.getBoundingClientRect().width;
    const resizerWidth = resizer.getBoundingClientRect().width;
    const availableWidth = Math.max(0, mainRect.width - sidebarWidth - resizerWidth);
    const maximumWidth = Math.max(
      minimumCodeWidth,
      Math.min(maximumCodeWidth, availableWidth - minimumCanvasWidth)
    );

    return { mainRect, availableWidth, maximumWidth };
  }

  function scheduleCanvasResize() {
    if (resizeFrame) return;
    resizeFrame = window.requestAnimationFrame(() => {
      resizeFrame = 0;
      // app.js already owns canvas sizing and listens for this event.
      window.dispatchEvent(new Event('resize'));
    });
  }

  function setCodePanelWidth(requestedWidth, { persist = false, notify = true } = {}) {
    if (narrowLayout.matches) return;

    const bounds = getBounds();
    const width = Math.round(Math.min(bounds.maximumWidth, Math.max(minimumCodeWidth, requestedWidth)));
    root.style.setProperty('--code-panel-width', `${width}px`);
    resizer.setAttribute('aria-valuenow', String(width));
    resizer.setAttribute('aria-valuemax', String(Math.round(bounds.maximumWidth)));

    if (persist && bounds.availableWidth > 0) {
      preferredRatio = width / bounds.availableWidth;
      try {
        window.localStorage.setItem(storageKey, String(preferredRatio));
      } catch (_) {
        // A private or restricted session may reject localStorage writes.
      }
    }

    if (notify) scheduleCanvasResize();
  }

  function restoreForViewport() {
    if (narrowLayout.matches) {
      root.style.removeProperty('--code-panel-width');
      return;
    }

    const bounds = getBounds();
    if (preferredRatio === null && bounds.availableWidth > 0) {
      preferredRatio = defaultCodeWidth / bounds.availableWidth;
    }
    const requestedWidth = preferredRatio === null
      ? defaultCodeWidth
      : bounds.availableWidth * preferredRatio;
    setCodePanelWidth(requestedWidth, { notify: false });
  }

  function finishDrag(event) {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove('is-panel-resizing');

    if (event && resizer.hasPointerCapture(event.pointerId)) {
      resizer.releasePointerCapture(event.pointerId);
    }
    setCodePanelWidth(codePanel.getBoundingClientRect().width, { persist: true });
  }

  resizer.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || narrowLayout.matches) return;
    dragging = true;
    resizer.setPointerCapture(event.pointerId);
    document.body.classList.add('is-panel-resizing');
    event.preventDefault();
  });

  resizer.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const { mainRect } = getBounds();
    setCodePanelWidth(mainRect.right - event.clientX);
  });

  resizer.addEventListener('pointerup', finishDrag);
  resizer.addEventListener('pointercancel', finishDrag);

  resizer.addEventListener('keydown', (event) => {
    const step = event.shiftKey ? 50 : 20;
    const currentWidth = codePanel.getBoundingClientRect().width;
    let requestedWidth = null;

    if (event.key === 'ArrowLeft') requestedWidth = currentWidth + step;
    if (event.key === 'ArrowRight') requestedWidth = currentWidth - step;
    if (event.key === 'Home') requestedWidth = minimumCodeWidth;
    if (event.key === 'End') requestedWidth = getBounds().maximumWidth;
    if (requestedWidth === null) return;

    event.preventDefault();
    setCodePanelWidth(requestedWidth, { persist: true });
  });

  resizer.addEventListener('dblclick', () => {
    setCodePanelWidth(defaultCodeWidth, { persist: true });
  });

  // This listener is registered before app.js, so the CSS width is updated
  // before app.js measures and resizes the Fabric canvas.
  window.addEventListener('resize', () => {
    if (!dragging) restoreForViewport();
  });

  if (typeof narrowLayout.addEventListener === 'function') {
    narrowLayout.addEventListener('change', () => {
      restoreForViewport();
      scheduleCanvasResize();
    });
  } else {
    narrowLayout.addListener(() => {
      restoreForViewport();
      scheduleCanvasResize();
    });
  }

  restoreForViewport();
})();
