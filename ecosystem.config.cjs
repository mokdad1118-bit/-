/** PM2:  pm2 start ecosystem.config.cjs --env production */
module.exports = {
  apps: [
    {
      name: "adora",
      script: "server.js",
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      max_memory_restart: "400M",
      env: {
        NODE_ENV: "development",
      },
      env_production: {
        NODE_ENV: "production",
      },
    },
  ],
};
