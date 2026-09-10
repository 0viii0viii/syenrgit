/**
 * Electron wraps every rejection from `ipcMain.handle` as
 *   Error invoking remote method 'channel:name': Error: the real message
 * before it reaches the renderer. The prefix names an implementation detail
 * the user has no use for, so it is stripped once here rather than leaking
 * into every status message.
 */
const IPC_PREFIX = /^Error invoking remote method '[^']*':\s*/
const ERROR_CLASS = /^(?:[A-Za-z_$][\w$]*Error|Error):\s*/

export function describeError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  const withoutChannel = raw.replace(IPC_PREFIX, '')
  // Git's own messages are already prefixed with "error:" or "fatal:"; only
  // the JavaScript class name is noise.
  return withoutChannel.replace(ERROR_CLASS, '').trim() || 'Something went wrong'
}
