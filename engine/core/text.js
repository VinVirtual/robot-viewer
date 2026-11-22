// Text from a robot file is untrusted. These keep it from steering a terminal.

/** Remove terminal control sequences and control characters (C0 except tab and newline, DEL, C1), keeping the rest. */
export function terminalSafe(text) {
  return String(text)
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '') // CSI sequences such as colours and cursor moves
    .replace(/\u001b\][^\u0007\u001b]*(\u0007|\u001b\\)/g, '') // OSC sequences such as window titles and links
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '')
}
