export function invalidateTraceRequest(request: { current: number }): void {
  request.current++;
}

export function visibleTrace<T>(trace: { revision: number; value: T } | null, revision: number): T | null {
  return trace?.revision === revision ? trace.value : null;
}
