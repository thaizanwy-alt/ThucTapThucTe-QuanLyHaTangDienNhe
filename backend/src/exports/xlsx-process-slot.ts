import { ServiceUnavailableException } from '@nestjs/common';

export class XlsxBusyException extends ServiceUnavailableException {
  constructor() { super('An XLSX export is already running in this backend process'); }
}

// One active XLSX preparation per Node process. There is deliberately no queue.
let occupied = false;

export function acquireXlsxProcessSlot(): () => void {
  if (occupied) throw new XlsxBusyException();
  occupied = true;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    occupied = false;
  };
}
