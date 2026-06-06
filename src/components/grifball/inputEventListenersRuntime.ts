export type GrifballInputEventHandlers = {
  handleKeyDown: (event: KeyboardEvent) => void;
  handleKeyUp: (event: KeyboardEvent) => void;
  handleCanvasMouseDown: (event: MouseEvent) => void;
  handleCanvasMouseUp: (event: MouseEvent) => void;
  handleWheel: (event: WheelEvent) => void;
  handleContextMenu: (event: MouseEvent) => void;
  handlePointerLockChange: () => void;
  handleMouseMove: (event: MouseEvent) => void;
  handleMouseDownFallback: (event: MouseEvent) => void;
  handleMouseUpFallback: () => void;
  handleTouchStart: (event: TouchEvent) => void;
  handleTouchMove: (event: TouchEvent) => void;
  handleTouchEnd: (event: TouchEvent) => void;
  handleMobileAttackPrimary: () => void;
  handleMobileAttackAlt: () => void;
  handleResize: () => void;
  handleCycleObserverMode: () => void;
  handleCycleObserverTarget: (event?: Event) => void;
};

export function registerGrifballInputEventListeners({
  canvas,
  handlers,
}: {
  canvas: HTMLCanvasElement;
  handlers: GrifballInputEventHandlers;
}): () => void {
  window.addEventListener('keydown', handlers.handleKeyDown);
  window.addEventListener('keyup', handlers.handleKeyUp);
  canvas.addEventListener('mousedown', handlers.handleCanvasMouseDown);
  window.addEventListener('mouseup', handlers.handleCanvasMouseUp);
  canvas.addEventListener('wheel', handlers.handleWheel);
  canvas.addEventListener('contextmenu', handlers.handleContextMenu);
  document.addEventListener('pointerlockchange', handlers.handlePointerLockChange);
  window.addEventListener('mousemove', handlers.handleMouseMove);
  window.addEventListener('mousedown', handlers.handleMouseDownFallback);
  window.addEventListener('mouseup', handlers.handleMouseUpFallback);
  window.addEventListener('touchstart', handlers.handleTouchStart, { passive: false });
  window.addEventListener('touchmove', handlers.handleTouchMove, { passive: false });
  window.addEventListener('touchend', handlers.handleTouchEnd);
  window.addEventListener('touchcancel', handlers.handleTouchEnd);
  window.addEventListener('mobile-attack-primary', handlers.handleMobileAttackPrimary);
  window.addEventListener('mobile-attack-alt', handlers.handleMobileAttackAlt);
  window.addEventListener('resize', handlers.handleResize);
  window.addEventListener('cycle-observer-mode', handlers.handleCycleObserverMode);
  window.addEventListener('cycle-observer-target', handlers.handleCycleObserverTarget);

  return () => {
    window.removeEventListener('keydown', handlers.handleKeyDown);
    window.removeEventListener('keyup', handlers.handleKeyUp);
    canvas.removeEventListener('mousedown', handlers.handleCanvasMouseDown);
    canvas.removeEventListener('wheel', handlers.handleWheel);
    canvas.removeEventListener('contextmenu', handlers.handleContextMenu);
    document.removeEventListener('pointerlockchange', handlers.handlePointerLockChange);
    window.removeEventListener('mousemove', handlers.handleMouseMove);
    window.removeEventListener('mousedown', handlers.handleMouseDownFallback);
    window.removeEventListener('mouseup', handlers.handleMouseUpFallback);
    window.removeEventListener('mouseup', handlers.handleCanvasMouseUp);
    window.removeEventListener('touchstart', handlers.handleTouchStart);
    window.removeEventListener('touchmove', handlers.handleTouchMove);
    window.removeEventListener('touchend', handlers.handleTouchEnd);
    window.removeEventListener('touchcancel', handlers.handleTouchEnd);
    window.removeEventListener('mobile-attack-primary', handlers.handleMobileAttackPrimary);
    window.removeEventListener('mobile-attack-alt', handlers.handleMobileAttackAlt);
    window.removeEventListener('resize', handlers.handleResize);
    window.removeEventListener('cycle-observer-mode', handlers.handleCycleObserverMode);
    window.removeEventListener('cycle-observer-target', handlers.handleCycleObserverTarget);
  };
}
