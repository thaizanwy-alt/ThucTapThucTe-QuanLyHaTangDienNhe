// Notify dependent panels after the server accepted a write, before any follow-up GET.
export async function saveDeviceAndNotify(action: () => Promise<unknown>, onDeviceChanged: () => void): Promise<void> {
  await action();
  onDeviceChanged();
}
