/* Synchronized view transforms stay outside vector models and exported artwork. */
(() => {
  'use strict';
  const canvases = ['light-preview', 'dark-preview'].map((id) => document.getElementById(id));
  const zoomOut = document.getElementById('preview-zoom-out');
  const zoomIn = document.getElementById('preview-zoom-in');
  const fit = document.getElementById('preview-fit');
  const output = document.getElementById('preview-zoom');
  let asset = null;
  let zoom = 1;
  let x = 0;
  let y = 0;
  let drag = null;
  let suppressClick = false;

  function render() {
    for (const canvas of canvases) {
      canvas.style.setProperty('--preview-zoom', zoom);
      canvas.style.setProperty('--preview-x', `${x}px`);
      canvas.style.setProperty('--preview-y', `${y}px`);
    }
    output.value = `${Math.round(zoom * 100)}%`;
    zoomOut.disabled = !asset || zoom <= 0.25;
    zoomIn.disabled = !asset || zoom >= 8;
    fit.disabled = !asset;
  }

  function stopDrag() {
    if (!drag) return;
    const { canvas, pointerId } = drag;
    drag = null;
    canvas.classList.remove('panning');
    if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
  }

  function reset() {
    stopDrag();
    suppressClick = false;
    zoom = 1;
    x = y = 0;
    render();
  }

  function changeZoom(delta) {
    zoom = Math.min(8, Math.max(0.25, zoom + delta));
    render();
  }

  zoomOut.addEventListener('click', () => changeZoom(-0.25));
  zoomIn.addEventListener('click', () => changeZoom(0.25));
  fit.addEventListener('click', reset);

  for (const canvas of canvases) {
    canvas.addEventListener('keydown', (event) => {
      if (!asset || event.ctrlKey || event.metaKey || event.altKey) return;
      switch (event.key) {
        case 'ArrowLeft':
          x -= 24;
          break;
        case 'ArrowRight':
          x += 24;
          break;
        case 'ArrowUp':
          y -= 24;
          break;
        case 'ArrowDown':
          y += 24;
          break;
        case '+':
        case '=':
          changeZoom(0.25);
          break;
        case '-':
          changeZoom(-0.25);
          break;
        case '0':
        case 'Home':
          reset();
          break;
        default:
          return;
      }
      event.preventDefault();
      render();
    });
    canvas.addEventListener('pointerdown', (event) => {
      if (!asset || !event.isPrimary || event.button !== 0 || drag) return;
      suppressClick = false;
      drag = {
        canvas,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        x,
        y,
        moved: false,
      };
    });
    canvas.addEventListener(
      'click',
      (event) => {
        if (!suppressClick || event.detail === 0) return;
        suppressClick = false;
        event.preventDefault();
        event.stopImmediatePropagation();
      },
      true,
    );
    canvas.addEventListener('lostpointercapture', (event) => {
      if (event.target === canvas && drag?.pointerId === event.pointerId) stopDrag();
    });
  }

  window.addEventListener('pointermove', (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    if (!drag.moved) {
      drag.moved = true;
      suppressClick = true;
      drag.canvas.setPointerCapture(event.pointerId);
      drag.canvas.classList.add('panning');
    }
    x = drag.x + dx;
    y = drag.y + dy;
    event.preventDefault();
    render();
  });
  window.addEventListener('pointerup', (event) => {
    if (drag?.pointerId !== event.pointerId) return;
    suppressClick = drag.moved;
    stopDrag();
  });
  window.addEventListener('pointercancel', (event) => {
    if (drag?.pointerId !== event.pointerId) return;
    suppressClick = false;
    stopDrag();
  });
  window.addEventListener('blur', stopDrag);

  window.previewView = {
    setAsset(next) {
      if (asset === next) return;
      asset = next;
      reset();
    },
  };
  render();
})();
