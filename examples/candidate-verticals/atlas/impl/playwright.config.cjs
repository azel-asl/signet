module.exports = {
  testDir: './e2e',
  timeout: 60000,
  use: {
    baseURL: process.env.ATLAS_E2E_BASE || 'http://127.0.0.1:8123',
  },
};
