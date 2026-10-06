module.exports = {
  apps: [{
    name: 'odwyn',
    cwd: __dirname,
    script: 'server.js',
    interpreter: process.env.BUN_PATH || 'bun',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    restart_delay: 3000,
    kill_timeout: 15000,
    env: { NODE_ENV: 'production' },
  }],
};
