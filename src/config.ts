export const CFG = {
  port: Number(process.env.PORT || 3000),
  dataDir: process.env.DATA_DIR || '/data',
  // 3秒未満は強制的に3秒へ切り上げ
  minIntervalMs: Math.max(3000, Number(process.env.MIN_INTERVAL_MS || 3000)),
  tabsPerAccount: Math.max(1, Number(process.env.TABS_PER_ACCOUNT || 2)),
  pollMs: Number(process.env.POLL_MS || 700),
  maxBackoffMs: Number(process.env.MAX_BACKOFF_MS || 60000),
  headless: process.env.HEADLESS === '1',
  proxies: (process.env.PROXY_LIST || '').split(',').map(s => s.trim()).filter(Boolean),
  vncUrl: process.env.VNC_PUBLIC_URL || '/vnc/vnc.html?autoconnect=1&resize=scale',
};