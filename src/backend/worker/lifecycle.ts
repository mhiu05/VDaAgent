export function watchShutdownSignals(signals: Pick<NodeJS.Process, 'on'> = process) {
  let stopped = false;
  signals.on('SIGINT', () => {
    stopped = true;
  });
  signals.on('SIGTERM', () => {
    stopped = true;
  });
  return () => stopped;
}
